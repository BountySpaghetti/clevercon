/**
 * Client-side prover for the pp/2 batch spend-policy circuit
 * (`circuits/spend-policy-g16/policy_batch.circom`). It assembles the circuit
 * witness, generates the Groth16 proof with snarkjs, and converts the result
 * into the exact arguments the vault's `release_payment_proved_batch` takes.
 *
 * Proving runs on the owner's/agent's machine, so the plaintext policy never
 * leaves their control. It needs the circuit's `wasm` and `zkey` artifacts (built
 * by the zk-artifacts CI job); pass their paths to {@link proveBatch}.
 *
 * The circuit shape (N=4 releases, depth-16 allowlist, 4 categories, 2 calendar
 * windows) is pinned here to match the deployed verifying key.
 */
import {
  amountScalar,
  extractBatchOutputs,
  feScalar,
  payeeField,
  proofToSoroban,
} from './policy-codec.js';
import type { SorobanProof } from './policy-codec.js';

export const BATCH_N = 4;
export const ALLOWLIST_DEPTH = 16;
export const CATEGORY_COUNT = 4;
export const CALENDAR_WINDOWS = 2;

/** An allowlist membership proof for one payee (produced from the owner's tree). */
export interface AllowlistMembership {
  /** `ALLOWLIST_DEPTH` sibling hashes, bottom to top (decimal strings). */
  pathElements: string[];
  /** `ALLOWLIST_DEPTH` left/right selectors (0 = node is the left child). */
  pathIndices: number[];
  /** Per-payee cap in stroops (R5), the second leaf field. Use '0' when unused. */
  cap: string;
  /** Payee category 0..CATEGORY_COUNT-1 (R8), the third leaf field. */
  category: number;
}

/** One active release in the batch. */
export interface BatchRelease {
  /** Stellar address of the recipient (G...). */
  payeeAddress: string;
  /** Release amount in stroops. */
  amountStroops: string;
  /** Per-policy monotonic nonce, so repeated identical releases get distinct nullifiers. */
  spendCounter: string;
  /** Required when R3 (allowlist) is enabled; omit for non-allowlist policies. */
  membership?: AllowlistMembership;
}

/** The private policy, exactly as committed. Flags are R1..R8 in order. */
export interface PolicyWitness {
  enabled: boolean[]; // length 8
  salt: string;
  r1Ceiling: string;
  r2Cap: string;
  r2WindowSecs: string;
  r2Delegate: string;
  r3Root: string;
  r3Depth: string;
  r4Entries: string[]; // length 4
  r4Threshold: string;
  r6WindowsRoot: string;
  r6Windows: { start: string; end: string }[]; // length CALENDAR_WINDOWS
  r7MaxCount: string;
  r7WindowSecs: string;
  r8CatCeilings: string[]; // length CATEGORY_COUNT
  disclosureTag: string;
}

/** Vault-authenticated context the proof is bound to. */
export interface BatchContext {
  /** Validity window the vault's ledger time must fall within (R6). */
  validAfter: string;
  validBefore: string;
  /** The vault's running spend (R2) and release count (R7) BEFORE this batch. */
  runningSpend: string;
  priorCount: string;
}

/** The ready-to-submit result of proving a batch. */
export interface BatchProof {
  /** The Groth16 proof as the vault's `Groth16Proof` (a/b/c byte buffers). */
  proof: SorobanProof;
  /** Policy commitment (circuit output), matches the task's stored commitment. */
  commitment: Buffer;
  /** Spend-once nullifiers for the active releases, in order. */
  nullifiers: Buffer[];
  /** All public signals (decimal strings) as returned by snarkjs. */
  publicSignals: string[];
}

const zeros = (n: number): string[] => Array.from({ length: n }, () => '0');
const toDecimal = (buf: Buffer): string => BigInt('0x' + buf.toString('hex')).toString();

/**
 * Assemble the flat circuit input. Active releases fill the leading slots; the
 * remaining slots are canonical null releases the circuit proves are no-ops.
 */
export function buildBatchWitness(
  policy: PolicyWitness,
  releases: BatchRelease[],
  ctx: BatchContext,
): Record<string, unknown> {
  if (releases.length === 0 || releases.length > BATCH_N) {
    throw new Error(`batch must have 1..${BATCH_N} releases, got ${releases.length}`);
  }
  if (policy.enabled.length !== 8) throw new Error('policy.enabled must have 8 flags (R1..R8)');

  const payee_field: string[] = [];
  const amount: string[] = [];
  const active: string[] = [];
  const spend_counter: string[] = [];
  const payee_cap: string[] = [];
  const payee_category: string[] = [];
  const r3_path: string[][] = [];
  const r3_index: string[][] = [];

  for (let k = 0; k < BATCH_N; k++) {
    const r = releases[k];
    if (r) {
      payee_field.push(toDecimal(payeeField(r.payeeAddress)));
      amount.push(r.amountStroops);
      active.push('1');
      spend_counter.push(r.spendCounter);
      payee_cap.push(r.membership?.cap ?? '0');
      payee_category.push(String(r.membership?.category ?? 0));
      r3_path.push(r.membership ? [...r.membership.pathElements] : zeros(ALLOWLIST_DEPTH));
      r3_index.push(r.membership ? r.membership.pathIndices.map(String) : zeros(ALLOWLIST_DEPTH));
    } else {
      payee_field.push('0');
      amount.push('0');
      active.push('0');
      spend_counter.push('0');
      payee_cap.push('0');
      payee_category.push('0');
      r3_path.push(zeros(ALLOWLIST_DEPTH));
      r3_index.push(zeros(ALLOWLIST_DEPTH));
    }
  }

  return {
    payee_field,
    amount,
    valid_after: ctx.validAfter,
    valid_before: ctx.validBefore,
    running_spend: ctx.runningSpend,
    prior_count: ctx.priorCount,
    en: policy.enabled.map((b) => (b ? '1' : '0')),
    r1_ceiling: policy.r1Ceiling,
    r2_cap: policy.r2Cap,
    r2_window: policy.r2WindowSecs,
    r2_delegate: policy.r2Delegate,
    r3_root: policy.r3Root,
    r3_depth: policy.r3Depth,
    r4_entries: policy.r4Entries,
    r4_threshold: policy.r4Threshold,
    r6_windows_root: policy.r6WindowsRoot,
    r7_max_count: policy.r7MaxCount,
    r7_window: policy.r7WindowSecs,
    r8_cat_ceiling: policy.r8CatCeilings,
    disclosure_tag: policy.disclosureTag,
    salt: policy.salt,
    r6_win_start: policy.r6Windows.map((w) => w.start),
    r6_win_end: policy.r6Windows.map((w) => w.end),
    active,
    spend_counter,
    r3_path,
    r3_index,
    payee_cap,
    payee_category,
  };
}

/**
 * Generate the Groth16 proof for an assembled witness and convert it to the
 * vault's wire format. `artifacts` are the circuit's compiled `wasm` and proving
 * `zkey` (from the zk-artifacts CI job). snarkjs is loaded lazily.
 */
export async function proveBatch(
  witness: Record<string, unknown>,
  artifacts: { wasmPath: string; zkeyPath: string },
): Promise<BatchProof> {
  const snarkjs = await import('snarkjs');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );
  const { commitment, activeNullifiers } = extractBatchOutputs(publicSignals, BATCH_N);
  return {
    proof: proofToSoroban(proof),
    commitment,
    nullifiers: activeNullifiers,
    publicSignals,
  };
}

/** Assemble the witness and prove it in one call. */
export async function createBatchProof(
  policy: PolicyWitness,
  releases: BatchRelease[],
  ctx: BatchContext,
  artifacts: { wasmPath: string; zkeyPath: string },
): Promise<BatchProof> {
  return proveBatch(buildBatchWitness(policy, releases, ctx), artifacts);
}

/** On-chain task context the relayer needs to lazily lock + settle the batch. */
export interface BatchReleaseMeta {
  /** On-chain vault task id if the task is already locked; null to lock it. */
  vaultTaskId: string | null;
  /** Task budget (USDC) to lock if not already locked. */
  planCostUsdc: number;
  /** On-chain step id (the vault is idempotent by (task_id, step_id)). */
  stepId: number;
}

/** The JSON body the API relay (and in turn the vault) consumes for a pp/2 batch. */
export interface BatchReleaseRequest extends BatchReleaseMeta {
  /** Active payees (G...), in order. */
  payees: string[];
  /** Active amounts in stroops, in order. */
  amounts: string[];
  /** Active nullifiers as hex, in order (from the proof). */
  nullifiers: string[];
  validAfter: string;
  validBefore: string;
  /** Policy commitment as hex (circuit output). */
  commitment: string;
  /** Groth16 proof components as hex. */
  proof: { a: string; b: string; c: string };
}

/**
 * Convert a {@link BatchProof} + its release set into the request the API relay
 * accepts. Pure: the client proves locally, then POSTs this; the API never sees
 * the plaintext policy and cannot forge the proof.
 */
export function buildBatchReleaseRequest(
  proof: BatchProof,
  releases: BatchRelease[],
  ctx: BatchContext,
  meta: BatchReleaseMeta,
): BatchReleaseRequest {
  if (releases.length !== proof.nullifiers.length) {
    throw new Error('releases and active nullifiers must match in length');
  }
  return {
    vaultTaskId: meta.vaultTaskId,
    planCostUsdc: meta.planCostUsdc,
    stepId: meta.stepId,
    payees: releases.map((r) => r.payeeAddress),
    amounts: releases.map((r) => r.amountStroops),
    nullifiers: proof.nullifiers.map((n) => n.toString('hex')),
    validAfter: ctx.validAfter,
    validBefore: ctx.validBefore,
    commitment: proof.commitment.toString('hex'),
    proof: {
      a: proof.proof.a.toString('hex'),
      b: proof.proof.b.toString('hex'),
      c: proof.proof.c.toString('hex'),
    },
  };
}

/** The API relay path for a pp/2 batch release. */
export const BATCH_RELEASE_PATH = '/vault/batch-release-proved';

/**
 * POST a built batch-release request to the API relay (x-api-key auth, matching
 * the rest of the SDK). The relay validates and enqueues the worker submission.
 */
export async function submitBatchRelease(opts: {
  apiUrl: string;
  apiKey: string;
  request: BatchReleaseRequest;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(opts.apiUrl.replace(/\/+$/, '') + BATCH_RELEASE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey },
    body: JSON.stringify(opts.request),
  });
  if (!res.ok) {
    throw new Error(`batch release failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

/** The amount of a single release as its 32-byte public-input scalar (for checks). */
export function releaseAmountScalar(amountStroops: bigint): Buffer {
  return amountScalar(amountStroops);
}

/** A validity-window bound as a 32-byte scalar (for checks). */
export function windowScalar(value: bigint): Buffer {
  return feScalar(value);
}
