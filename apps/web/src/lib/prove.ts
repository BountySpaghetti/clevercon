import { apiPost } from './api';
import {
  createBatchProof,
  policyWitnessFromBundle,
  buildPolicyWitness,
  makePoseidon,
  newSalt,
  buildBatchReleaseRequest,
  DEFAULT_ARTIFACT_BASE_URL,
  DEFAULT_POSEIDON_ARTIFACTS,
  type BatchRelease,
  type BatchContext,
  type Allowlist,
  type PolicyWitness,
  type PolicyBundleRules,
} from '@clevercon/agent-sdk/prover';

const STROOPS = 10_000_000;
const WASM = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch.wasm`;
const ZKEY = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch_final.zkey`;

/** One Groth16 proof authorizes up to this many payouts (circuit N=4). */
export const PROOF_WIDTH = 4;
/** UI soft cap on recipients; longer lists auto-split into proofs of four. */
export const MAX_RECIPIENTS = 100;

export type ProvePhase = 'proving' | 'relaying' | 'done';
export interface ProveRecipient {
  payee: string;
  amount: number;
}
export interface ProveResult {
  jobIds: string[];
  total: number;
  legs: number;
  batches: number;
}

/**
 * Prove a private spending policy IN THE BROWSER and relay the proof for an
 * on-chain, vault-gated release. This is the single pp/2 path shared by the
 * Disburse page and the Agent tab: the owner's rule becomes a Groth16 proof here
 * (never transmitted), the server only relays it, and the chain verifies it
 * before the bounded delegate moves funds. A proof covers up to {@link PROOF_WIDTH}
 * payouts, so longer recipient lists are split into one proof per group of four.
 *
 * The ceiling (R1) is always proven; `bundleRules` adds whatever else the limit
 * carries (allowlist R3 + per-payee cap R5, rolling cap R2, velocity R7, deny R4,
 * ...). Only the allowlist/calendar/category rules need the Poseidon oracle.
 */
export async function proveAndReleaseBatch(opts: {
  ceilingUsdc: number;
  bundleRules: PolicyBundleRules | null;
  recipients: ProveRecipient[];
  onPhase?: (phase: ProvePhase, batch?: { i: number; n: number }) => void;
}): Promise<ProveResult> {
  const { ceilingUsdc, bundleRules, recipients, onPhase } = opts;
  const active = recipients.filter((r) => r.payee.trim() && r.amount > 0).slice(0, MAX_RECIPIENTS);
  if (!active.length) throw new Error('no recipients to pay');
  if (!(ceilingUsdc > 0)) throw new Error('a per-payment ceiling is required');
  const over = active.find((r) => r.amount > ceilingUsdc);
  if (over) throw new Error(`each payout must be at or under the ceiling (${ceilingUsdc} USDC)`);

  // The ceiling is Disburse/Agent's own field, so it overrides the bundle's.
  const rules: PolicyBundleRules = bundleRules
    ? { ...bundleRules, perPaymentCeilingUsdc: ceilingUsdc }
    : { perPaymentCeilingUsdc: ceilingUsdc };
  const needsFull = !!(
    rules.allowlist?.length ||
    rules.denylist?.length ||
    rules.calendarWindows?.length ||
    rules.categoryCeilingsUsdc?.length
  );
  const poseidon = needsFull ? await makePoseidon(DEFAULT_POSEIDON_ARTIFACTS) : null;

  const groups: ProveRecipient[][] = [];
  for (let i = 0; i < active.length; i += PROOF_WIDTH)
    groups.push(active.slice(i, i + PROOF_WIDTH));

  const jobIds: string[] = [];
  let sum = 0;
  for (let g = 0; g < groups.length; g++) {
    onPhase?.('proving', { i: g + 1, n: groups.length });
    const bundle = { rules, salt: newSalt() };
    let policy: PolicyWitness;
    let allowlist: Allowlist | undefined;
    if (poseidon) {
      ({ policy, allowlist } = await buildPolicyWitness(bundle, poseidon));
    } else {
      policy = policyWitnessFromBundle(bundle);
    }
    const base = Date.now();
    const releases: BatchRelease[] = groups[g].map((l, i) => {
      const payee = l.payee.trim();
      const membership = allowlist?.membership(payee);
      if (allowlist && !membership)
        throw new Error(`${payee} is not on this limit's approved-payee list`);
      return {
        payeeAddress: payee,
        amountStroops: String(BigInt(Math.round(l.amount * STROOPS))),
        spendCounter: String(base + i),
        membership,
      };
    });
    const now = Math.floor(Date.now() / 1000);
    const ctx: BatchContext = {
      validAfter: String(now - 3600),
      validBefore: String(now + 86400),
      runningSpend: '0',
      priorCount: '0',
    };
    const proof = await createBatchProof(policy, releases, ctx, { wasmPath: WASM, zkeyPath: ZKEY });
    const gsum = releases.reduce((s, r) => s + Number(BigInt(r.amountStroops)) / STROOPS, 0);
    sum += gsum;
    const request = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: gsum,
      stepId: (base + g) % 1_000_000,
    });
    onPhase?.('relaying', { i: g + 1, n: groups.length });
    const resp = await apiPost<{ jobId: string }>('/vault/batch-release-proved', request);
    jobIds.push(resp.jobId);
  }
  onPhase?.('done');
  return { jobIds, total: sum, legs: active.length, batches: groups.length };
}
