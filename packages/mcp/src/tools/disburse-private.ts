/**
 * disburse_private: the pp/2 TRUSTLESS disburse for agents. Unlike `disburse`
 * (which posts to /payments and lets the server orchestrate a binding release),
 * this proves the owner's PRIVATE policy locally with a Groth16 proof and sends
 * only the proof to the API relay. The server never sees the policy plaintext and
 * cannot forge the proof; the chain verifies it and moves funds. One proof
 * authorizes up to 4 payouts.
 *
 * The private policy is provisioned to the agent out-of-band (never by the model):
 *   - CLEVERCON_POLICY_JSON   inline bundle JSON `{ "rules": {...}, "salt": "..." }`
 *   - CLEVERCON_POLICY_FILE   path to that JSON
 * and the circuit artifacts via CLEVERCON_PP2_WASM / _ZKEY (paths) or _URL (urls).
 */
import { readFileSync } from 'node:fs';
import {
  createBatchProof,
  buildBatchReleaseRequest,
  policyWitnessFromBundle,
  resolveArtifacts,
  type PolicyBundle,
  type BatchRelease,
  type BatchContext,
} from '@clevercon/agent-sdk';
import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

const STROOPS_PER_USDC = 10_000_000;

export const disbursePrivateSchema = {
  name: 'disburse_private',
  description:
    'Trustlessly disburse USDC to up to 4 addresses under your PRIVATE policy, proven on-chain with zero-knowledge (the server never sees the policy, only the proof). Use when the policy must stay private and enforcement must be trustless. Requires the owner to have provisioned a policy bundle + proving artifacts to this agent. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'Up to 4 recipients to pay in one proof',
        items: {
          type: 'object',
          properties: {
            payee: { type: 'string', description: 'Recipient Stellar address (G...)' },
            amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in USDC' },
          },
          required: ['payee', 'amount'],
        },
        minItems: 1,
        maxItems: 4,
      },
    },
    required: ['lines'],
  },
};

function loadPolicyBundle(): PolicyBundle {
  const json = process.env.CLEVERCON_POLICY_JSON;
  const file = process.env.CLEVERCON_POLICY_FILE;
  const raw = json ?? (file ? readFileSync(file, 'utf-8') : '');
  if (!raw) {
    throw new Error(
      'no private policy: set CLEVERCON_POLICY_JSON or CLEVERCON_POLICY_FILE to {"rules":{...},"salt":"..."}',
    );
  }
  const bundle = JSON.parse(raw) as PolicyBundle;
  if (!bundle.rules || !bundle.salt) throw new Error('policy bundle needs { rules, salt }');
  return bundle;
}

export async function disbursePrivateHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const lines = args.lines;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 4) {
      throw new Error('lines must be an array of 1..4 {payee, amount}');
    }

    const bundle = loadPolicyBundle();
    const policy = policyWitnessFromBundle(bundle);
    const artifacts = await resolveArtifacts();

    // Fresh task context: a new task locks budget and starts its accumulators at
    // zero, and the vault checks its ledger time falls inside [validAfter, before].
    const now = Math.floor(Date.now() / 1000);
    const ctx: BatchContext = {
      validAfter: String(now - 3600),
      validBefore: String(now + 86400),
      runningSpend: '0',
      priorCount: '0',
    };

    // Distinct spend_counter per leg (ms base + index) so repeated identical
    // releases across calls still derive unique nullifiers.
    const base = Date.now();
    const releases: BatchRelease[] = lines.map((l, i) => {
      const line = l as { payee?: unknown; amount?: unknown };
      if (typeof line.payee !== 'string' || line.payee.trim() === '')
        throw new Error('each line needs a payee address');
      if (typeof line.amount !== 'number' || line.amount <= 0)
        throw new Error('each line needs amount > 0');
      return {
        payeeAddress: line.payee.trim(),
        amountStroops: String(BigInt(Math.round(line.amount * STROOPS_PER_USDC))),
        spendCounter: String(base + i),
      };
    });

    const totalUsdc = releases.reduce(
      (s, r) => s + Number(BigInt(r.amountStroops)) / STROOPS_PER_USDC,
      0,
    );

    const proof = await createBatchProof(policy, releases, ctx, artifacts);
    const request = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: totalUsdc,
      stepId: base % 1_000_000,
    });

    const client = createApiClient(config);
    const resp = await client.post('/vault/batch-release-proved', request);
    return toolJson({
      submitted: resp,
      legs: releases.length,
      totalUsdc,
      commitment: proof.commitment.toString('hex'),
      note: 'Trustless pp/2 release: proof verified on-chain by the vault; funds move once the worker submits it.',
    });
  } catch (error) {
    return toolError('disburse_private failed', error);
  }
}
