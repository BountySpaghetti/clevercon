// Marketplace acceptance-contract types for the SDK. These are a pure,
// dependency-free wire contract, mirrored here so the published SDK stays
// self-contained (it must not depend on @clevercon/common, which pulls server
// deps like ioredis). KEEP IN SYNC with packages/common/src/service-manifest.ts,
// the server-side copy. See .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5, 11.

export type Tier = 'T1' | 'T2' | 'T3';

export type VerificationMethod =
  | 'onchain'
  | 'witness'
  | 'content-hash'
  | 'signature'
  | 'attest'
  | 'manual';

export interface VerificationSpec {
  method: VerificationMethod;
  spec?: Record<string, unknown>;
}

export interface ArtifactRef {
  url: string;
  hash: string;
  contentType: string;
  size: number;
}

export type JsonSchema = Record<string, unknown>;

export interface ServiceManifest {
  id: string;
  name: string;
  category: string;
  tier: Tier;
  description: string;
  capabilities: string[];
  pricing: { model: 'direct' | 'x402' | 'mpp'; pricePerCall: number; currency: 'USDC' };
  payout: string;
  io: { input: JsonSchema; output: JsonSchema };
  verification: VerificationSpec;
  dispute?: { windowSec: number };
  bond?: { amount: number; asset: 'USDC' };
  healthCheck?: string;
  slaMaxLatencyMs?: number;
  version: number;
}

export interface JobRequestEnvelope {
  jobId: string;
  taskId: string;
  stepId: string;
  action: string;
  input: Record<string, unknown>;
  attachments?: ArtifactRef[];
  replyFormat: 'json' | 'text' | 'reference';
  deadline: number;
  idempotencyKey: string;
}

export interface JobResultEnvelope {
  ok: boolean;
  contentType: string;
  data?: unknown;
  artifact?: ArtifactRef;
  error?: string;
  issuedAt: number;
  signature?: string;
}
