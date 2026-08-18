<div align="center">

# CleverCon

**Private, policy-bounded delegation of money to AI agents on Stellar.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE)

[Live Demo](https://clevercon-orchestrator.onrender.com) · [Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## Overview

CleverCon lets a user hand a budget to an AI agent under a spending policy that
is enforced on-chain and kept private.

You describe a task in plain English and deposit USDC into **CleverVault** — a
non-custodial Soroban contract. An orchestrator breaks the task into steps,
hires specialist agents from an open registry, and pays each one in real USDC
as the steps complete. The operator never custodies your funds, and unused
budget is refunded automatically.

The direction that defines the project: the funds you lock are governed by a
**private spending policy** — a rolling allowance, an allowlist of approved
agents, or a per-task delegation cap — committed on-chain as a cryptographic
hash. Every payment the orchestrator releases must carry a **zero-knowledge
proof** that it complies with that policy. The agent never sees your rule, the
chain never sees your rule, and the operator cannot spend outside it.

This is the difference between CleverCon and custodial, backend-enforced agent
wallets. Where those hold your key on a server and check your limits off-chain,
CleverCon keeps custody in a contract the operator cannot drain and moves policy
enforcement **on-chain and private**. The zero-knowledge vault design is not
speculative — we have already built and deployed it on Stellar testnet
([CipherMit](https://github.com/Bosun-Josh121/ciphermit), live at
[ciphermit.vercel.app](https://ciphermit.vercel.app), with verified proofs for
allowance, allowlist, and delegation policies). The near-term roadmap integrates
that engine into CleverVault as its enforcement core.

The current agent network is AI-focused — specialists handle data lookup,
analysis, and reporting — but the protocol is service-agnostic. Any HTTP service
with a Stellar wallet and x402 or MPP support can register and earn USDC.

## Status at a glance

### Live today (Stellar Testnet)

- **CleverVault** — non-custodial Soroban treasury: deposits, per-task budget
  locking, per-step payment release capped on-chain, automatic refunds,
  multi-asset support, stale-task recovery, and pause/admin controls. Backed by
  a 100+ case Rust test suite.
- **Orchestrator** — LLM-driven task planning (currently Claude Sonnet),
  feasibility checking, agent selection/scoring, and a dependency-aware
  execution engine.
- **Open agent registry** — self-registration, capability search, and an
  Elo-style reputation score updated after every job.
- **Five specialist agents** paid via x402 or MPP.
- **React dashboard** for connecting a wallet, funding the vault, approving
  plans, and viewing history.
- 2nd place, Stellar Agents (x402 / MPP) hackathon.

### Grant scope (in progress)

- **Zero-knowledge policy enforcement** in CleverVault — a user locks funds
  under a private policy (allowance / allowlist / delegation / compliance),
  and each release is gated by a Groth16 proof (RISC Zero zkVM) verified
  on-chain, integrating our proven testnet ZK vault.
- **Security audit** of CleverVault and the verifier.
- **Mainnet deployment** with mainnet USDC and multi-asset support.
- **On-chain agent registry**, a **Stellar MCP server**, and a **specialist
  Agent SDK**.

See [ROADMAP.md](ROADMAP.md) for the phased plan and
[docs/architecture.md](docs/architecture.md) for the system diagram, fund-flow
sequence, and trust model.

## Project structure

```
clevercon/
├── contracts/
│   ├── agent-vault/           CleverVault - on-chain USDC treasury (Soroban/Rust)
│   └── budget-guardian/       earlier budget-tracking contract (legacy, unused)
├── packages/
│   ├── common/                shared TypeScript types, constants, wallet helpers
│   ├── registry/              agent discovery + reputation API
│   ├── orchestrator/          planner, executor, vault client, WebSocket hub
│   ├── dashboard/             React 19 + Vite + Tailwind frontend
│   └── agents/
│       ├── stellar-oracle/    live Stellar/Horizon data (x402)
│       ├── web-intel/         news scraping v1 (x402)
│       ├── web-intel-v2/      news scraping v2, cheaper (x402)
│       ├── analysis/          LLM-powered analysis, streaming (MPP)
│       └── reporter/          report formatting (x402)
├── scripts/                   setup, wallet, and lifecycle scripts
├── docs/                      architecture and development docs
└── render.yaml                Render deployment blueprint (7 services)
```

The zero-knowledge policy engine (RISC Zero guest programs, Groth16 verifier
router, prover service) lives in [CipherMit](https://github.com/Bosun-Josh121/ciphermit)
today and is being integrated into `contracts/agent-vault` per
[ROADMAP.md](ROADMAP.md); it is not yet part of this repository.

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Rust / Soroban — CleverVault |
| Zero-knowledge (grant scope) | RISC Zero zkVM + Groth16 proofs, verified on-chain via a Soroban verifier router |
| Backend | Node.js 20, Express, TypeScript (npm workspaces) |
| Frontend | React 19, Vite, Tailwind CSS |
| LLM (current) | Claude Sonnet (planning) + Claude Haiku (rating) — pluggable provider planned |
| Payment protocols | `@x402/express`, `@x402/stellar`, `@stellar/mpp` |
| Wallet integration | `@creit.tech/stellar-wallets-kit` (Freighter, xBull, Albedo, LOBSTR, Rabet) |
| Blockchain data | Stellar Horizon API |
| Deployment | Render.com |

## Quick start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- An Anthropic API key
- Freighter browser extension, set to testnet

### 1. Clone and install

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY
```

### 3. Set up wallets (first time only)

```bash
npx tsx scripts/setup-wallets.ts         # generates keypairs, prints *_SECRET_KEY lines
# copy the printed *_SECRET_KEY=S... lines into .env before continuing
npx tsx scripts/add-usdc-trustlines.ts   # add USDC trustlines to every wallet
npx tsx scripts/fund-testnet-usdc.ts     # swap XLM -> USDC via testnet DEX (no browser needed)
npx tsx scripts/distribute-usdc.ts       # send USDC from orchestrator to each agent wallet
```

### 4. Start all services

```bash
./scripts/start.sh
```

Builds the dashboard, starts the registry, all five agents, and the orchestrator,
and health-checks each one. Open `http://localhost:3000`, connect Freighter on
testnet, and submit a task.

### 5. Stop

```bash
./scripts/stop.sh
```

### Optional: seed reputation data

```bash
npx tsx scripts/bootstrap.ts --auto-approve
# runs 25 varied tasks to build agent reputation history
```

## Deploying the CleverVault contract

Requires Rust and `stellar-cli` 25+:

```bash
cd contracts/agent-vault && ./deploy.sh
# builds to WASM, deploys, initializes, runs a smoke test,
# and writes AGENT_VAULT_CONTRACT_ID to .env
```

## Deploying to Render

`render.yaml` defines all 7 services (registry, orchestrator + dashboard, and 5 agents).
Push to GitHub, create a Blueprint from this repo in Render. After the first deploy,
update `*_SELF_URL` and `REGISTRY_URL` to the assigned `.onrender.com` URLs and
redeploy — agents re-register on startup.

## Environment variables

See [.env.example](.env.example) for the full list. The essentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # required (current LLM provider)
ORCHESTRATOR_SECRET_KEY=S...        # generated by setup-wallets.ts
AGENT_VAULT_CONTRACT_ID=C...        # written by deploy.sh
STELLAR_NETWORK=stellar:testnet
HORIZON_URL=https://horizon-testnet.stellar.org
ORACLE_PRICE_CACHE_TTL_MS=10000       # stellar-oracle price cache TTL (10s)
ORACLE_ASSET_CACHE_TTL_MS=60000       # stellar-oracle asset metadata cache TTL (60s)
ORACLE_ACCOUNT_CACHE_TTL_MS=30000     # stellar-oracle account cache TTL (30s)
```

## Reference agents (testnet)

| Agent | Protocol | Price | Description |
|---|---|---|---|
| StellarOracle | x402 | $0.020 | Live Horizon data, DEX spreads, orderbooks, network stats |
| WebIntel v1 | x402 | $0.020 | Web scraping with LLM-powered summarization |
| WebIntel v2 | x402 | $0.015 | Cheaper alternative, returns raw JSON |
| AnalysisBot | MPP | $0.050 | Deep analysis via streaming payment channel |
| ReporterBot | x402 | $0.030 | Formats data streams into clean executive reports |

These five are reference implementations deployed by the maintainer to demonstrate
the marketplace. The registry is open: any HTTP service with x402 or MPP support
can register and begin earning USDC. See [docs/development.md](docs/development.md)
for the agent interface contract.

## Deployments

| Component | Network | Address |
|---|---|---|
| CleverVault contract | Stellar Testnet | [`CDFLEJ2H...D4LRTE`](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE) |
| USDC (SAC) | Stellar Testnet | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| ZK policy vault (CipherMit, prior work) | Stellar Testnet | [`CBHDNNIN...Q4NDW7C`](https://stellar.expert/explorer/testnet/contract/CBHDNNIN76GWDVH3IGV43J2RM3DJSLN2VTTBOU3O5WITKIOSBQ4NDW7C) |
| Orchestrator + Dashboard | Render | https://clevercon-orchestrator.onrender.com |

## Documentation

- [Architecture](docs/architecture.md) - system overview, fund flow, private policy layer, trust model, protocols
- [Development guide](docs/development.md) - setup, common tasks, debugging
- [Roadmap](ROADMAP.md) - where the project is headed
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Related Projects

[CipherMit](https://github.com/Bosun-Josh121/ciphermit) is the maintainer's
zero-knowledge vault for private, provable spending rules on Stellar — the
engine being integrated as CleverVault's policy-enforcement core.

[Conductor](https://github.com/Bosun-Josh121/conductor) is a sister project that
integrates AI agents into Trustless Work escrow milestone verification. Different
architectural layer (escrow verification vs. marketplace orchestration), but shares
infrastructure patterns and Stellar payment primitives.

## License

MIT — see [LICENSE](LICENSE).
