/**
 * Vault Reconciliation Worker.
 *
 * Treats the on-chain AgentVault contract as the source of truth for a user's
 * balance and total spend, diffs it against the local off-chain ledger
 * (vault-ledger.ts), reports drift, and -- only when explicitly requested --
 * repairs the local view by appending a corrective ledger entry.
 *
 * Scope note: this pass reconciles account-level state (getAccount vs the
 * summed vault-ledger). Task-level reconciliation against BudgetGuardian's
 * getTask is out of scope for this pass -- BudgetGuardian is not currently
 * wired into the live task pipeline in server.ts (only agent-vault-client.ts
 * is used for createTask/releasePayment/completeTask), so there is no live
 * vault_task_id -> BudgetGuardian task mapping to reconcile against yet. See
 * PR discussion on #105 for the two-pass diff model.
 *
 * Never writes on-chain. Repair only ever appends to the local ledger.
 */

import fs from 'fs';
import path from 'path';
import { writeJsonSafe } from '@clevercon/common';
import { getAccount } from './agent-vault-client.js';
import { getAllVaultTx, appendVaultTx, type VaultLedgerEntry } from './vault-ledger.js';
import * as orchestratorStore from './orchestrator-store.js';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const AUDIT_PATH = path.join(DATA_DIR, 'reconciliation-audit.json');

const STROOPS_PER_USDC = 10_000_000;

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

// -- Audit trail (append-only) --

export interface ReconciliationAuditEntry {
  id: string;
  user_address: string;
  drift_type: DriftType;
  field: string;
  old_value: number; // USDC
  new_value: number; // USDC
  on_chain_reference: {
    balance_usdc: number;
    total_spent_usdc: number;
  };
  timestamp: string;
}

type AuditLog = ReconciliationAuditEntry[];

let auditCache: AuditLog | null = null;

function loadAudit(): AuditLog {
  if (auditCache) return auditCache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(AUDIT_PATH)) fs.writeFileSync(AUDIT_PATH, '[]', 'utf8');
    auditCache = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8')) as AuditLog;
  } catch {
    auditCache = [];
  }
  return auditCache;
}

function saveAudit(log: AuditLog): void {
  writeJsonSafe(AUDIT_PATH, log);
  auditCache = log;
}

let _seq = 0;
function nextAuditId(): string {
  return `rcl_${Date.now()}_${++_seq}`;
}

function appendAudit(entry: Omit<ReconciliationAuditEntry, 'id' | 'timestamp'>): void {
  const log = loadAudit();
  log.push({ ...entry, id: nextAuditId(), timestamp: new Date().toISOString() });
  saveAudit(log);
}

/** Every persisted audit entry, oldest first. */
export function getAuditLog(userAddress?: string): ReconciliationAuditEntry[] {
  const log = loadAudit();
  return userAddress ? log.filter((e) => e.user_address === userAddress) : log;
}

// -- Drift model --

export type DriftType = 'balance_mismatch' | 'spent_mismatch';

export interface UserDrift {
  user_address: string;
  drift: boolean;
  local: { balance_usdc: number; spent_usdc: number };
  chain: { balance_usdc: number; spent_usdc: number };
  diffs: Array<{
    type: DriftType;
    field: string;
    local_value: number;
    chain_value: number;
    delta_usdc: number;
  }>;
}

export interface ReconciliationReport {
  ran_at: string;
  mode: 'dry-run' | 'repair';
  users_checked: number;
  users_with_drift: number;
  repaired_count: number;
  results: UserDrift[];
}

/**
 * Sum local ledger entries into a derived balance and total spend, in stroops
 * for exact comparison against on-chain amounts.
 *
 * balance = deposits - withdrawals - payments (budget_lock entries are
 * informational locks, not settled movements, so they're excluded from the
 * balance/spend totals -- mirrors how the chain's `balance` only reflects
 * settled deposit/withdraw/payment activity).
 */
function summarizeLocalLedger(entries: VaultLedgerEntry[]): {
  balanceStroops: bigint;
  spentStroops: bigint;
} {
  let balance = 0n;
  let spent = 0n;
  for (const e of entries) {
    const amt = usdcToStroops(e.amount_usdc);
    if (e.type === 'deposit') balance += amt;
    else if (e.type === 'withdrawal') balance -= amt;
    else if (e.type === 'payment') {
      balance -= amt;
      spent += amt;
    }
    // 'budget_lock' entries: informational only, no balance/spend effect.
  }
  return { balanceStroops: balance, spentStroops: spent };
}

/** Compute drift for a single user. Never mutates anything. */
export async function computeUserDrift(userAddress: string): Promise<UserDrift> {
  const chainAccount = await getAccount(userAddress);
  const localEntries = getAllVaultTx(userAddress);
  const { balanceStroops, spentStroops } = summarizeLocalLedger(localEntries);

  const localBalanceUsdc = Number(balanceStroops) / STROOPS_PER_USDC;
  const localSpentUsdc = Number(spentStroops) / STROOPS_PER_USDC;

  const chainBalanceUsdc = chainAccount?.balance ?? 0;
  const chainSpentUsdc = chainAccount?.total_spent ?? 0;

  const chainBalanceStroops = usdcToStroops(chainBalanceUsdc);
  const chainSpentStroops = usdcToStroops(chainSpentUsdc);

  const diffs: UserDrift['diffs'] = [];

  if (balanceStroops !== chainBalanceStroops) {
    diffs.push({
      type: 'balance_mismatch',
      field: 'balance',
      local_value: localBalanceUsdc,
      chain_value: chainBalanceUsdc,
      delta_usdc: chainBalanceUsdc - localBalanceUsdc,
    });
  }

  if (spentStroops !== chainSpentStroops) {
    diffs.push({
      type: 'spent_mismatch',
      field: 'total_spent',
      local_value: localSpentUsdc,
      chain_value: chainSpentUsdc,
      delta_usdc: chainSpentUsdc - localSpentUsdc,
    });
  }

  return {
    user_address: userAddress,
    drift: diffs.length > 0,
    local: { balance_usdc: localBalanceUsdc, spent_usdc: localSpentUsdc },
    chain: { balance_usdc: chainBalanceUsdc, spent_usdc: chainSpentUsdc },
    diffs,
  };
}

/**
 * Repair a single user's local ledger to match chain, by appending a
 * corrective 'adjustment' entry (never mutating existing entries) and
 * writing an audit record for every field changed. No-op if there's no
 * drift (idempotent).
 */
async function repairUser(userDrift: UserDrift): Promise<number> {
  if (!userDrift.drift) return 0;

  let repaired = 0;
  for (const d of userDrift.diffs) {
    if (d.type === 'balance_mismatch' && Math.abs(d.delta_usdc) > 0) {
      appendVaultTx({
        user_address: userDrift.user_address,
        type: 'adjustment',
        amount_usdc: Math.abs(d.delta_usdc),
        task_id: d.delta_usdc >= 0 ? 'reconciliation:credit' : 'reconciliation:debit',
      });
    }

    appendAudit({
      user_address: userDrift.user_address,
      drift_type: d.type,
      field: d.field,
      old_value: d.local_value,
      new_value: d.chain_value,
      on_chain_reference: {
        balance_usdc: userDrift.chain.balance_usdc,
        total_spent_usdc: userDrift.chain.spent_usdc,
      },
    });
    repaired++;
  }
  return repaired;
}

// -- In-memory summary for the metrics/health surface --

interface ReconciliationSummary {
  last_run: string | null;
  last_mode: 'dry-run' | 'repair' | null;
  drift_count: number;
  repaired_count: number;
}

let summary: ReconciliationSummary = {
  last_run: null,
  last_mode: null,
  drift_count: 0,
  repaired_count: 0,
};

export function getReconciliationSummary(): ReconciliationSummary {
  return { ...summary };
}

// -- Entry point --

/**
 * Run reconciliation across every known user (from orchestrator-store).
 * Dry-run (default) computes and returns the drift report only. Pass
 * `{ repair: true }` to also apply fixes and write audit entries.
 */
export async function runReconciliation(
  opts: { repair?: boolean } = {},
): Promise<ReconciliationReport> {
  const mode: 'dry-run' | 'repair' = opts.repair ? 'repair' : 'dry-run';
  const users = orchestratorStore.all().map((r) => r.user_address);

  const results: UserDrift[] = [];
  let repairedCount = 0;

  for (const userAddress of users) {
    const drift = await computeUserDrift(userAddress);
    results.push(drift);
    if (mode === 'repair' && drift.drift) {
      repairedCount += await repairUser(drift);
    }
  }

  const usersWithDrift = results.filter((r) => r.drift).length;

  const ranAt = new Date().toISOString();
  summary = {
    last_run: ranAt,
    last_mode: mode,
    drift_count: usersWithDrift,
    repaired_count: mode === 'repair' ? repairedCount : summary.repaired_count,
  };

  return {
    ran_at: ranAt,
    mode,
    users_checked: users.length,
    users_with_drift: usersWithDrift,
    repaired_count: mode === 'repair' ? repairedCount : 0,
    results,
  };
}