export { createAgent } from './agent.js';
export { withX402, createPayingFetch } from './payments/x402.js';
export { withMpp } from './payments/mpp.js';
export {
  buildBatchWitness,
  proveBatch,
  createBatchProof,
  buildBatchReleaseRequest,
  submitBatchRelease,
  BATCH_RELEASE_PATH,
  BATCH_N,
  ALLOWLIST_DEPTH,
  CATEGORY_COUNT,
  CALENDAR_WINDOWS,
} from './payments/batch-prover.js';
export type {
  PolicyWitness,
  BatchRelease,
  BatchContext,
  BatchProof,
  BatchReleaseRequest,
  AllowlistMembership,
} from './payments/batch-prover.js';
export {
  payeeField,
  amountScalar,
  feScalar,
  proofToSoroban,
  extractBatchOutputs,
  type SorobanProof,
} from './payments/policy-codec.js';
export { createRegistryClient } from './registry.js';
export { AgentConfigError } from './config.js';
export { createProvider, MAX_OUTPUT_CHARS } from './provider.js';
export { createSpender, CleverConError } from './spender.js';
export { createAgentWallet } from './agent-wallet.js';
export type {
  SpenderOptions,
  CleverConClient,
  PaymentLine,
  SpendLimit,
  Budget,
  Spend,
  SavedLimit,
} from './spender.js';
export type { AgentWalletOptions, AgentWallet } from './agent-wallet.js';
export type {
  Provider,
  ProviderOptions,
  FulfillmentRequest,
  FulfillmentResult,
  FulfillmentHandler,
} from './provider.js';

export type {
  AgentConfig,
  AgentServer,
  AgentManifestConfig,
  AgentHandler,
  AgentTask,
  AgentContext,
  AgentResult,
  FeedbackOutcome,
  PaymentInfo,
  PaymentModel,
  RegistrationPayload,
  Logger,
  SdkDeps,
} from './types.js';
export type { WithX402Options, PayingFetchOptions } from './payments/x402.js';
export type { WithMppOptions } from './payments/mpp.js';
export type { RegistryClient, RegistryClientOptions } from './registry.js';
export type { ResolvedConfig } from './config.js';
