import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, Plus, X, Lock, Check, ExternalLink } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, SectionLabel, Pill } from '../../components/ui';
import { apiPost } from '../../lib/api';
import {
  createBatchProof,
  policyWitnessFromBundle,
  newSalt,
  buildBatchReleaseRequest,
  DEFAULT_ARTIFACT_BASE_URL,
  type BatchRelease,
  type BatchContext,
} from '@clevercon/agent-sdk/prover';

const STROOPS = 10_000_000;
const WASM = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch.wasm`;
const ZKEY = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch_final.zkey`;
const MAX_LINES = 4; // one proof authorizes up to N=4 payouts

type Line = { payee: string; amount: string };
type Result = { jobId: string; status: string; total: number; legs: number; commitment: string };
// Where we are in the prove -> relay -> verify pipeline (drives the step panel).
type Phase = 'idle' | 'proving' | 'relaying' | 'done';

/**
 * pp/2 trustless disburse, entirely client-side. The owner's policy (a per-payment
 * ceiling + a fresh salt) becomes a Groth16 proof IN THE BROWSER using the hosted
 * circuit artifacts; only the proof is sent to the relay. The server never sees
 * the policy, and the chain verifies the proof before the vault moves funds.
 */
export function DisbursePage() {
  const [ceiling, setCeiling] = useState('10');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '' }]);
  const [phase, setPhase] = useState<Phase>('idle');

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => (ls.length < MAX_LINES ? [...ls, { payee: '', amount: '' }] : ls));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  const active = lines.filter((l) => l.payee.trim() && Number(l.amount) > 0).slice(0, MAX_LINES);
  const canSubmit = Number(ceiling) > 0 && active.length > 0;

  const disburse = useMutation<Result>({
    mutationFn: async () => {
      const over = active.find((l) => Number(l.amount) > Number(ceiling));
      if (over) throw new Error(`each payout must be <= the per-payment ceiling (${ceiling} USDC)`);

      setPhase('proving');
      const policy = policyWitnessFromBundle({
        rules: { perPaymentCeilingUsdc: Number(ceiling) },
        salt: newSalt(),
      });
      const base = Date.now();
      const releases: BatchRelease[] = active.map((l, i) => ({
        payeeAddress: l.payee.trim(),
        amountStroops: String(BigInt(Math.round(Number(l.amount) * STROOPS))),
        spendCounter: String(base + i),
      }));
      const now = Math.floor(Date.now() / 1000);
      const ctx: BatchContext = {
        validAfter: String(now - 3600),
        validBefore: String(now + 86400),
        runningSpend: '0',
        priorCount: '0',
      };
      const proof = await createBatchProof(policy, releases, ctx, {
        wasmPath: WASM,
        zkeyPath: ZKEY,
      });
      const total = releases.reduce((s, r) => s + Number(BigInt(r.amountStroops)) / STROOPS, 0);
      const request = buildBatchReleaseRequest(proof, releases, ctx, {
        vaultTaskId: null,
        planCostUsdc: total,
        stepId: base % 1_000_000,
      });

      setPhase('relaying');
      const resp = await apiPost<{ jobId: string; status: string }>(
        '/vault/batch-release-proved',
        request,
      );
      setPhase('done');
      return {
        ...resp,
        total,
        legs: releases.length,
        commitment: proof.commitment.toString('hex'),
      };
    },
    onError: () => setPhase('idle'),
  });

  const busy = disburse.isPending;
  const done = phase === 'done' && !!disburse.data;
  // step state: 0 = witness, 1 = proof, 2 = on-chain verify
  const stepDone = [phase !== 'idle', phase === 'relaying' || done, done];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Private"
        title="Trustless disburse"
        subtitle="Pay up to four recipients under one zero-knowledge proof. Your policy is proven here in the browser; the server only relays the proof and the chain enforces it."
      />

      <div className="grid max-w-4xl gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Compose */}
        <Card>
          <CardHeader
            icon={ShieldCheck}
            title="Prove and disburse"
            hint="Generated on this device from your private policy. Nothing about the rule leaves your browser."
          />
          <form
            className="space-y-5 px-5 pb-5 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !busy) disburse.mutate();
            }}
          >
            <div>
              <SectionLabel>Per-payment ceiling (USDC)</SectionLabel>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                className="mt-1.5 w-40 rounded-xl border border-line-strong bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                aria-label="Per-payment ceiling in USDC"
              />
              <p className="mt-1 text-xs text-slate-500">
                The private rule enforced in the proof: every payout must be at or under this.
              </p>
            </div>

            <div className="space-y-2">
              <SectionLabel>Recipients (up to {MAX_LINES})</SectionLabel>
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    placeholder="Payee address (G...)"
                    value={l.payee}
                    onChange={(e) => setLine(i, { payee: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-line-strong bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                    aria-label={`Payee ${i + 1} address`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="USDC"
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    className="w-24 rounded-xl border border-line-strong bg-black/30 px-3 py-2 text-sm tabular-nums text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                    aria-label={`Payee ${i + 1} amount in USDC`}
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.06] hover:text-white"
                      aria-label={`Remove recipient ${i + 1}`}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              {lines.length < MAX_LINES && (
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200"
                >
                  <Plus size={14} /> Add recipient
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-line pt-4">
              <Button type="submit" disabled={!canSubmit || busy}>
                <Lock size={15} />
                {busy ? 'Proving…' : 'Prove in browser and disburse'}
              </Button>
              {active.length > 0 && (
                <span className="text-xs text-slate-500">
                  {active.length} payout{active.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {disburse.error && (
              <p className="text-sm text-red-400">{(disburse.error as Error).message}</p>
            )}
          </form>
        </Card>

        {/* Proof panel */}
        <Card className="overflow-hidden">
          <div className="relative border-b border-line bg-gradient-to-br from-violet-500/[0.1] to-transparent px-5 py-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-300">
              Groth16 · BLS12-381
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Verified on-chain by Soroban&apos;s native pairing. No trusted prover.
            </p>
          </div>
          <div className="px-5 py-4">
            <ProofStep
              n={1}
              done={stepDone[0]}
              active={phase === 'proving'}
              title="Witness built in your browser"
              desc="your policy + a fresh salt, never transmitted"
            />
            <ProofStep
              n={2}
              done={stepDone[1]}
              active={phase === 'proving'}
              title="Zero-knowledge proof generated"
              desc="snarkjs over the deployed circuit (~10s)"
            />
            <ProofStep
              n={3}
              done={stepDone[2]}
              active={phase === 'relaying'}
              title="Verified on-chain, funds released"
              desc="the vault checks the proof before moving a cent"
              last
            />

            {done && disburse.data && (
              <div className="mt-4 rounded-xl bg-emerald-500/[0.07] p-3">
                <div className="flex items-center justify-between">
                  <Pill tone="good">Accepted</Pill>
                  <span className="font-mono text-sm font-semibold tabular-nums text-white">
                    {disburse.data.total.toFixed(2)} USDC
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Disbursing to {disburse.data.legs} recipient{disburse.data.legs > 1 ? 's' : ''}.
                  Job <span className="font-mono">{disburse.data.jobId.slice(0, 18)}…</span>
                </p>
                <div className="mt-2 text-[11px] text-slate-500">
                  <div className="mb-0.5 uppercase tracking-wider">Commitment</div>
                  <div className="break-all font-mono text-slate-400">
                    {disburse.data.commitment}
                  </div>
                </div>
                <a
                  href="/app/activity"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                >
                  Track in Activity <ExternalLink size={11} />
                </a>
              </div>
            )}
            {!done && (
              <p className="mt-3 text-[11px] text-slate-500">
                Add recipients and prove. The first run fetches the circuit (~37MB, cached after).
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProofStep({
  n,
  title,
  desc,
  done,
  active,
  last = false,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  active: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${
            done
              ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
              : active
                ? 'animate-pulse bg-violet-500/20 text-violet-200 ring-violet-500/40'
                : 'bg-white/[0.04] text-slate-500 ring-white/10'
          }`}
        >
          {done ? <Check size={13} /> : n}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-line-strong" />}
      </div>
      <div className={`pb-4 ${last ? 'pb-0' : ''}`}>
        <div
          className={`text-[13.5px] font-semibold ${done || active ? 'text-white' : 'text-slate-400'}`}
        >
          {title}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
      </div>
    </div>
  );
}
