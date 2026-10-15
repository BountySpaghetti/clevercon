// The marketplace acceptance contract: the shared types that let a buyer, the
// worker, and a provider agree on HOW a service is called and HOW its delivery is
// judged. App-internal and camelCase, distinct from the snake_case `AgentManifest`
// in types.ts, which is the registry wire format kept for back-compat.
//
// Design: a service declares a verification `tier`, and the release path is matched
// to it. See .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5, 11.

/**
 * Verification tier, determines how delivery is judged and when funds release.
 * - T1 Verifiable: trustless check (chain/witness/hash/signature) -> instant release.
 * - T2 Attestable: schema + optimistic release behind a dispute window (+ judge/arbiter).
 * - T3 Subjective: human/milestone approval.
 */
export type Tier = 'T1' | 'T2' | 'T3';

/**
 * How a T1 result is checked without trusting the provider, or how a T2/T3 result
 * is handled.
 * - onchain: re-derive the answer from Horizon/RPC and compare.
 * - witness: the output carries a witness the client re-checks cheaply.
 * - content-hash: output bytes must hash to a requested hash.
 * - signature: output signed by the provider's declared key (provenance/accountability).
 * - attest: T2, schema check + judge, no trustless proof.
 * - manual: T3, human/milestone approval.
 */
export type VerificationMethod =
  | 'onchain'
  | 'witness'
  | 'content-hash'
  | 'signature'
  | 'attest'
  | 'manual';

export interface VerificationSpec {
  method: VerificationMethod;
  /** Method-specific parameters (e.g. the re-derivation query, the signer key). */
  spec?: Record<string, unknown>;
}

/** A content-addressed reference to a large/binary payload (never inlined). */
export interface ArtifactRef {
  url: string;
  /** e.g. "sha256:abcd..." */
  hash: string;
  contentType: string;
  size: number;
}

/** JSON Schema document (kept loose here; validated at runtime by the worker/SDK). */
export type JsonSchema = Record<string, unknown>;

/**
 * The provider's full acceptance contract. Registered once, hashed, and anchored
 * on-chain; editing bumps `version` and re-anchors (anti bait-and-switch).
 */
export interface ServiceManifest {
  id: string;
  name: string;
  category: string;
  tier: Tier;
  description: string;
  capabilities: string[];
  pricing: { model: 'direct' | 'x402' | 'mpp'; pricePerCall: number; currency: 'USDC' };
  /** Stellar address that receives payment (ownership proven at registration). */
  payout: string;
  io: { input: JsonSchema; output: JsonSchema };
  verification: VerificationSpec;
  /** Dispute window in seconds; 0 for T1 (instant). */
  dispute?: { windowSec: number };
  /** Optional slashable stake (phased). */
  bond?: { amount: number; asset: 'USDC' };
  healthCheck?: string;
  /** Max acceptable latency (ms) before the job fails and the lock refunds. */
  slaMaxLatencyMs?: number;
  /** Bumped on every manifest edit; earned trust is annotated with the version. */
  version: number;
}

/** What the worker POSTs to a provider endpoint to request a job. */
export interface JobRequestEnvelope {
  jobId: string;
  taskId: string;
  stepId: string;
  /** Must be one of the manifest's capabilities. */
  action: string;
  /** Validates against manifest.io.input. */
  input: Record<string, unknown>;
  /** Buyer-supplied inputs, by reference, never large-inline. */
  attachments?: ArtifactRef[];
  replyFormat: 'json' | 'text' | 'reference';
  /** Unix seconds; past it the job fails and the lock refunds (never hang). */
  deadline: number;
  /** A retried hire with the same key never double-charges. */
  idempotencyKey: string;
}

/** The standard envelope a provider returns, so the pipeline is uniform. */
export interface JobResultEnvelope {
  ok: boolean;
  contentType: string;
  /** Inline small result (JSON or text). */
  data?: unknown;
  /** Large/binary result, by reference. */
  artifact?: ArtifactRef;
  /** Set when ok is false. */
  error?: string;
  issuedAt: number;
  /** Optional: provider signature over jobId|hash(input)|hash(output)|issuedAt. */
  signature?: string;
}
