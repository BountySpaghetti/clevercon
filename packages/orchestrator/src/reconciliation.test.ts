import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('@clevercon/common', () => ({
  writeJsonSafe: vi.fn(),
}));

vi.mock('./agent-vault-client.js', () => ({
  getAccount: vi.fn(),
}));

vi.mock('./orchestrator-store.js', () => ({
  all: vi.fn(),
}));

vi.mock('./vault-ledger.js', () => ({
  getAllVaultTx: vi.fn(),
  appendVaultTx: vi.fn(),
}));

import { getAccount } from './agent-vault-client.js';
import * as orchestratorStore from './orchestrator-store.js';
import { getAllVaultTx, appendVaultTx } from './vault-ledger.js';
import {
  computeUserDrift,
  runReconciliation,
  getReconciliationSummary,
} from './reconciliation.js';

const USER = 'GABC123';

function ledgerEntry(type: 'deposit' | 'withdrawal' | 'payment' | 'budget_lock', amount: number) {
  return {
    id: 'x',
    user_address: USER,
    type,
    amount_usdc: amount,
    timestamp: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeUserDrift', () => {
  it('reports no drift when local ledger matches chain', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 20,
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
    expect(drift.diffs).toHaveLength(0);
    expect(drift.local.balance_usdc).toBeCloseTo(80);
    expect(drift.chain.balance_usdc).toBeCloseTo(80);
  });

  it('classifies balance_mismatch when local balance differs from chain', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([ledgerEntry('deposit', 100)]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 90, // chain thinks balance is 90, local computes 100
      available: 90,
      locked: 0,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(true);
    const balanceDiff = drift.diffs.find((d) => d.type === 'balance_mismatch');
    expect(balanceDiff).toBeDefined();
    expect(balanceDiff!.local_value).toBeCloseTo(100);
    expect(balanceDiff!.chain_value).toBeCloseTo(90);
    expect(balanceDiff!.delta_usdc).toBeCloseTo(-10);
  });

  it('classifies spent_mismatch when local spend differs from chain total_spent', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 25, // chain shows more spend than local ledger has (a missed payment)
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(true);
    const spentDiff = drift.diffs.find((d) => d.type === 'spent_mismatch');
    expect(spentDiff).toBeDefined();
    expect(spentDiff!.local_value).toBeCloseTo(20);
    expect(spentDiff!.chain_value).toBeCloseTo(25);
  });

  it('treats budget_lock entries as informational (no balance/spend effect)', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('budget_lock', 30),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 100,
      available: 70,
      locked: 30,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 1,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
  });

  it('treats a user with no on-chain account as zero balance/spend', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([]);
    vi.mocked(getAccount).mockResolvedValue(null);

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
    expect(drift.chain.balance_usdc).toBe(0);
  });
});

describe('runReconciliation', () => {
  it('dry-run mode reports drift but never calls appendVaultTx', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([
      {
        user_address: USER,
        orchestrator_name: 'test',
        orchestrator_pubkey: 'pk',
        orchestrator_secret: 'sk',
        registered_on_chain: true,
        created_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(getAllVaultTx).mockReturnValue([ledgerEntry('deposit', 100)]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 50,
      available: 50,
      locked: 0,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 0,
    });

    const report = await runReconciliation();

    expect(report.mode).toBe('dry-run');
    expect(report.users_with_drift).toBe(1);
    expect(report.repaired_count).toBe(0);
    expect(appendVaultTx).not.toHaveBeenCalled();
  });

  it('repair mode applies fixes and updates the metrics summary', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([
      {
        user_address: USER,
        orchestrator_name: 'test',
        orchestrator_pubkey: 'pk',
        orchestrator_secret: 'sk',
        registered_on_chain: true,
        created_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(getAllVaultTx).mockReturnValue([ledgerEntry('deposit', 100)]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 50,
      available: 50,
      locked: 0,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 0,
    });

    const report = await runReconciliation({ repair: true });

    expect(report.mode).toBe('repair');
    expect(report.repaired_count).toBeGreaterThan(0);
    expect(appendVaultTx).toHaveBeenCalledWith(
      expect.objectContaining({ user_address: USER, type: 'adjustment' }),
    );

    const summary = getReconciliationSummary();
    expect(summary.last_mode).toBe('repair');
    expect(summary.drift_count).toBe(1);
  });

  it('is idempotent: a clean second run makes no changes', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([
      {
        user_address: USER,
        orchestrator_name: 'test',
        orchestrator_pubkey: 'pk',
        orchestrator_secret: 'sk',
        registered_on_chain: true,
        created_at: new Date().toISOString(),
      },
    ]);
    // Local already matches chain -- nothing to repair.
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 20,
      active_tasks_count: 0,
    });

    const first = await runReconciliation({ repair: true });
    const second = await runReconciliation({ repair: true });

    expect(first.users_with_drift).toBe(0);
    expect(second.users_with_drift).toBe(0);
    expect(appendVaultTx).not.toHaveBeenCalled();
  });
});