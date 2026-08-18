# Roadmap

## Vision

CleverCon is a protocol on Stellar for **private, policy-bounded delegation of
money to AI agents**. A user locks funds in a non-custodial Soroban vault under
a spending policy that stays private, and an orchestration layer hires services
by capability, gets them through the vault, and settles payment in USDC per task
step — where every release is bound by the user's policy.

Two properties define the project and separate it from custodial, off-chain
agent wallets:

- **Non-custodial.** Funds live in CleverVault, a contract the operator cannot
  drain. Settlement is on-chain with verifiable hashes.
- **Private and provably bounded.** The user's spending policy is committed
  on-chain as a hash and enforced by zero-knowledge proof — the agent, the
  chain, and the operator never see the rule, and no payment outside it can
  settle.

The current agent network is AI-focused, but the protocol is service-agnostic:
any HTTP service with a Stellar wallet and x402 or MPP support can register.
Future participants may include data oracles, computation services, paid APIs,
verification services, and human-in-the-loop workers.

CleverCon is scoped to orchestration, policy enforcement, and marketplace
mechanics. Identity and authorization for agents (who may act on whose behalf)
is the concern of complementary protocols such as REAPP; CleverCon integrates
with that layer rather than re-implementing it.

## Current status

The following is live and working on Stellar Testnet today:

- **CleverVault** Soroban contract: deposits, per-task budget locking, per-step
  payment release capped on-chain, refunds of unused budget, multi-asset
  support, stale-task recovery, and pause/admin controls, backed by a 100+ case
  Rust test suite.
- **Orchestrator** service: LLM-driven task planning (currently Claude Sonnet),
  feasibility checking, agent selection/scoring, and a dependency-aware
  execution engine.
- **Off-chain agent registry** (Express + JSON file) with self-registration,
  capability search, and an Elo-style reputation score updated after every job.
- **Five specialist agents** (`stellar-oracle`, `web-intel`, `web-intel-v2`,
  `analysis`, `reporter`) paid via x402 or MPP.
- **React dashboard** for connecting a wallet, funding the vault, submitting
  tasks, approving plans, and viewing vault/task history.
- One-command local dev (`scripts/start.sh`) and a 7-service Render deployment
  blueprint (`render.yaml`).

Separately, the **zero-knowledge policy vault** that Phase 1 integrates is
already deployed and demonstrated on testnet as
[CipherMit](https://github.com/Bosun-Josh121/ciphermit) — a Soroban vault that
releases funds only against a Groth16 proof (RISC Zero zkVM) of compliance with
a private policy, with verified on-chain transactions for allowance, allowlist,
and delegation. The hard cryptographic work is proven; the roadmap brings it
into CleverVault.

What's missing for production: the vault does not yet enforce private policies
(that is Phase 1), the registry and agent scaffolding are not packaged as
reusable components, the orchestrator's LLM provider is hardcoded to Anthropic,
and orchestrator keys are stored in plaintext on disk.

## Phase 1 — Private policy enforcement (zero-knowledge CleverVault)

The defining phase. Integrate the proven CipherMit ZK vault into CleverVault so
that funds are locked under a private, provably enforced spending policy.

- Commit a user's spending policy on-chain as a hash at deposit/lock time, so
  the rule never appears on-chain in the clear.
- Support the four policy types: **allowance** (rolling, time-windowed caps),
  **allowlist** (spend only to approved agents via Merkle membership proofs),
  **delegation** (private per-orchestrator sub-budgets), and **compliance**
  (deny-list / threshold enforcement).
- Gate `release_payment` on a Groth16 proof, verified on-chain through a Soroban
  verifier router, binding the proof to the specific recipient, amount, and
  owner (with nullifiers to prevent replay and image-ID pinning to fix the guest
  program identity).
- **Prove at authorization, not per micropayment.** Proving is generated
  server-side and is not free; the design proves policy compliance for a task's
  plan when the budget is locked, then allows fast per-step releases *within*
  the proven envelope. This keeps x402/MPP micropayments instant while the
  boundary stays cryptographically enforced.
- Wire the compliance policy type (deny-list + threshold), the one policy still
  in development in the standalone vault, through end to end.

## Phase 2 — Harden CleverVault

- Extend the existing contract test suite to cover the ZK verification path,
  stale-task recovery, and authorization checks end to end.
- Add storage TTL / `extend_ttl` management for persistent ledger entries.
- Expand multi-asset support beyond the current whitelisted-SAC model as needed.
- Expand inline documentation (parameters, return values, panics, authorization
  and proof requirements) to make the contract review-ready.
- Known hardening gaps: encrypt orchestrator secret keys at rest; add
  file-locking and atomic writes to the JSON-backed stores.
- **Threat model + monitoring plan** for the full system, including the trusted
  prover, as a first-class deliverable.

## Phase 3 — On-chain Agent Registry contract

- Design a Soroban contract that mirrors `packages/registry`'s data model
  (`AgentManifest`, reputation fields) for on-chain storage.
- Migrate agent registration, discovery, and feedback-driven reputation updates
  to read from and write to the contract, with the existing Express registry as
  a caching layer.
- Define the migration path for existing off-chain registry data.

## Phase 4 — Stellar MCP server + Specialist Agent SDK

- Build a Stellar MCP server that exposes agent discovery, vault balance/task
  views, and payment helpers as MCP tools, so any MCP-compatible client can
  find and pay CleverCon agents under a policy.
- Extract `@clevercon/agent-sdk`: shared scaffolding for specialist agents —
  x402/MPP server setup, manifest/health endpoints, self-registration with
  retry, and reputation feedback helpers — based on the patterns duplicated
  across the five existing agents.
- Port the existing agents to the SDK as the reference implementation.

## Phase 5 — Multi-provider + ecosystem

- Decouple the orchestrator from the Anthropic SDK behind a pluggable LLM
  provider interface (Claude, GPT, Gemini, local models, and a mock provider
  for development without API keys), configured via `LLM_PROVIDER`.
- Apply the same abstraction to the registry's quality rating service
  (currently hardcoded to Claude Haiku).
- Add retry/backoff consistently across payment clients (MPP currently lacks
  the retry logic that x402 has) and external data sources.
- Add structured logging/correlation IDs across the orchestrator and agents.
- Grow the specialist agent catalog with community-contributed agents built on
  the Agent SDK.

## Phase 6 — Audit + Mainnet

- Security review and audit of CleverVault (including the ZK verification path)
  and the Agent Registry contract.
- Decentralize proving: move from a single shared prover toward a
  local/enclave prover so users need not trust a hosted prover.
- Deploy CleverVault and the Agent Registry contract to Stellar mainnet.
- Production deployment hardening: secrets management, monitoring, rate limiting
  across the registry, orchestrator, and agents.
- Mainnet USDC and multi-asset support.

## Long-term

- **Beyond AI agents:** onboard non-AI services (oracles, computation,
  verification, human-in-the-loop) as first-class marketplace participants under
  the same private-policy custody. The agent interface is already
  service-agnostic; the work is SDK support and documentation.
- **Multi-orchestrator support:** allow third parties to run their own
  orchestrators against the shared registry, removing the single-operator
  centralization point. Users choose which orchestrator to use based on track
  record, fee, or features — and their policy binds all of them equally.
- **Community-driven reputation:** move quality rating away from any single LLM
  provider toward multi-provider consensus or user-driven ratings weighted by
  on-chain history.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
for current bounties, and [CONTRIBUTING.md](CONTRIBUTING.md) for how to get
started.
