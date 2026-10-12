import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Plus,
  X,
  Lock,
  Check,
  ExternalLink,
  Fingerprint,
  Cpu,
  ShieldCheck,
  Layers,
} from 'lucide-react';
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
const PROOF_WIDTH = 4; // one Groth16 proof authorizes up to 4 payouts (circuit N=4)
const MAX_RECIPIENTS = 100; // UI soft cap; larger lists auto-split into proofs of 4

type Line = { payee: string; amount: string };
type Result = { jobIds: string[]; total: number; legs: number; batches: number };
type Phase = 'idle' | 'proving' | 'relaying' | 'done';

/**
 * pp/2 trustless disburse. The owner's private policy becomes a Groth16 proof IN
 * THE BROWSER; only the proof is relayed and the chain verifies it before the
 * vault releases. A proof covers up to {@link PROOF_WIDTH} payouts, so longer
 * recipient lists are split automatically into one proof per group of four.
 */
export function DisbursePage() {
  const [ceiling, setCeiling] = useState('10');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '' }]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => (ls.length < MAX_RECIPIENTS ? [...ls, { payee: '', amount: '' }] : ls));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  const active = lines
    .filter((l) => l.payee.trim() && Number(l.amount) > 0)
    .slice(0, MAX_RECIPIENTS);
  const total = active.reduce((s, l) => s + Number(l.amount), 0);
  const batches = Math.max(1, Math.ceil(active.length / PROOF_WIDTH));
  const canSubmit = Number(ceiling) > 0 && active.length > 0;

  const disburse = useMutation<Result>({
    mutationFn: async () => {
      const over = active.find((l) => Number(l.amount) > Number(ceiling));
      if (over) throw new Error(`each payout must be at or under the ceiling (${ceiling} USDC)`);

      const groups: Line[][] = [];
      for (let i = 0; i < active.length; i += PROOF_WIDTH)
        groups.push(active.slice(i, i + PROOF_WIDTH));

      const jobIds: string[] = [];
      let sum = 0;
      for (let g = 0; g < groups.length; g++) {
        setProgress({ i: g + 1, n: groups.length });
        setPhase('proving');
        const policy = policyWitnessFromBundle({
          rules: { perPaymentCeilingUsdc: Number(ceiling) },
          salt: newSalt(),
        });
        const base = Date.now();
        const releases: BatchRelease[] = groups[g].map((l, i) => ({
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
        const gsum = releases.reduce((s, r) => s + Number(BigInt(r.amountStroops)) / STROOPS, 0);
        sum += gsum;
        const request = buildBatchReleaseRequest(proof, releases, ctx, {
          vaultTaskId: null,
          planCostUsdc: gsum,
          stepId: (base + g) % 1_000_000,
        });
        setPhase('relaying');
        const resp = await apiPost<{ jobId: string }>('/vault/batch-release-proved', request);
        jobIds.push(resp.jobId);
      }
      setPhase('done');
      setProgress(null);
      return { jobIds, total: sum, legs: active.length, batches: groups.length };
    },
    onError: () => {
      setPhase('idle');
      setProgress(null);
    },
  });

  const busy = disburse.isPending;
  const done = phase === 'done' && !!disburse.data;
  const stepState = (i: number): 'done' | 'active' | 'todo' => {
    if (i === 0) return phase !== 'idle' ? 'done' : 'todo';
    if (i === 1)
      return done || phase === 'relaying' ? 'done' : phase === 'proving' ? 'active' : 'todo';
    return done ? 'done' : phase === 'relaying' ? 'active' : 'todo';
  };
  const batchNote = progress && progress.n > 1 ? ` · batch ${progress.i} of ${progress.n}` : '';

  return (
    <div className="cc-stagger space-y-7">
      <header>
        <p className="cc-eyebrow">Private payments</p>
        <h1 className="cc-title mt-2">Trustless disburse</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Pay many recipients under one private spending rule, proven in your browser with
          zero-knowledge and enforced on-chain. The server only relays the proof; it never sees your
          rule and cannot forge it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            ic: ShieldCheck,
            t: 'Set a private rule',
            d: 'A per-payment ceiling only you can see.',
          },
          {
            ic: Fingerprint,
            t: 'Prove in your browser',
            d: 'Groth16; the rule never leaves this device.',
          },
          {
            ic: Cpu,
            t: 'The chain verifies & pays',
            d: 'The vault checks the proof, then releases.',
          },
        ].map((s, i) => (
          <div key={i} className="cc-card flex items-start gap-3 p-4">
            <span className="cc-ic">
              <s.ic size={17} />
            </span>
            <div>
              <div className="text-[13.5px] font-semibold text-white">{s.t}</div>
              <div className="mt-0.5 text-xs text-slate-500">{s.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Compose */}
        <div className="cc-card p-5">
          <div className="flex items-center gap-3">
            <span className="cc-ic">
              <ShieldCheck size={17} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-white">Compose the disbursement</h2>
              <p className="text-xs text-slate-500">Nothing about the rule leaves your browser.</p>
            </div>
          </div>

          <form
            className="mt-5 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !busy) disburse.mutate();
            }}
          >
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                Per-payment ceiling (USDC) · the private rule
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                className="cc-input cc-num mt-1.5 w-44"
                aria-label="Per-payment ceiling in USDC"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Every payout is checked at or under this, inside the proof.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                Recipients
              </label>
              {lines.map((l, i) => {
                const overLimit = Number(l.amount) > Number(ceiling) && Number(l.amount) > 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      placeholder="Payee address (G...)"
                      value={l.payee}
                      onChange={(e) => setLine(i, { payee: e.target.value })}
                      className="cc-input min-w-0 flex-1 font-mono text-xs"
                      aria-label={`Payee ${i + 1} address`}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="USDC"
                      value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                      className={`cc-input cc-num w-24 ${overLimit ? '!border-amber-500/60' : ''}`}
                      aria-label={`Payee ${i + 1} amount`}
                    />
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                        aria-label={`Remove recipient ${i + 1}`}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
              {lines.length < MAX_RECIPIENTS && (
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 transition-colors hover:text-violet-200"
                >
                  <Plus size={14} /> Add recipient
                </button>
              )}
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                <Layers size={12} className="text-violet-300" />
                One proof covers {PROOF_WIDTH} payouts; longer lists are proven in {PROOF_WIDTH}
                -at-a-time batches automatically.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <div className="text-sm text-slate-400">
                Total{' '}
                <span className="cc-num ml-1 font-semibold text-white">
                  {total.toFixed(2)} USDC
                </span>
                {active.length > 0 && (
                  <span className="ml-2 text-xs text-slate-600">
                    · {active.length} payout{active.length > 1 ? 's' : ''} · {batches} proof
                    {batches > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button type="submit" className="cc-btn" disabled={!canSubmit || busy}>
                <Lock size={15} />
                {busy ? `Proving…` : 'Prove & disburse'}
              </button>
            </div>
            {disburse.error && (
              <p className="text-sm text-amber-300">{(disburse.error as Error).message}</p>
            )}
          </form>
        </div>

        {/* Proof panel */}
        <div className="cc-card cc-card-lg overflow-hidden">
          <div className="cc-glow relative border-b border-line px-5 py-4">
            <svg
              className="cc-seal pointer-events-none absolute -right-6 -top-6 h-32 w-32 opacity-40"
              viewBox="0 0 100 100"
              fill="none"
              stroke="var(--violet)"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="50" cy="50" r="28" />
              <circle cx="50" cy="50" r="37" strokeDasharray="3 6" />
              <path d="M38 50l8 8 18-18" strokeWidth="2.4" />
            </svg>
            <div className="cc-eyebrow">Groth16 · BLS12-381</div>
            <p className="mt-1 text-xs text-slate-400">
              Verified on-chain by Soroban&apos;s native pairing. No trusted prover.
            </p>
          </div>
          <div className="px-5 py-4">
            {[
              {
                t: `Witness built in your browser${busy ? batchNote : ''}`,
                d: 'your policy + a fresh salt, never transmitted',
              },
              { t: 'Zero-knowledge proof generated', d: 'snarkjs over the deployed circuit' },
              {
                t: 'Verified on-chain, funds released',
                d: 'the vault checks it before moving funds',
              },
            ].map((s, i, arr) => {
              const st = stepState(i);
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${
                        st === 'done'
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                          : st === 'active'
                            ? 'cc-breathe bg-violet-500/20 text-violet-200 ring-violet-500/40'
                            : 'bg-white/[0.04] text-slate-500 ring-white/10'
                      }`}
                    >
                      {st === 'done' ? <Check size={13} /> : i + 1}
                    </span>
                    {i < arr.length - 1 && <span className="my-1 w-px flex-1 bg-line-strong" />}
                  </div>
                  <div className="pb-4">
                    <div
                      className={`text-[13.5px] font-semibold ${st === 'todo' ? 'text-slate-400' : 'text-white'}`}
                    >
                      {s.t}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{s.d}</div>
                  </div>
                </div>
              );
            })}

            {done && disburse.data ? (
              <div className="cc-pop mt-1 rounded-xl bg-emerald-500/[0.07] p-3">
                <div className="flex items-center justify-between">
                  <span className="cc-pill cc-pill-good">
                    <span className="cc-dot" /> Accepted
                  </span>
                  <span className="cc-num text-sm font-semibold text-white">
                    {disburse.data.total.toFixed(2)} USDC
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Disbursing to {disburse.data.legs} recipient{disburse.data.legs > 1 ? 's' : ''}{' '}
                  across {disburse.data.batches} proof{disburse.data.batches > 1 ? 's' : ''}.
                </p>
                <a
                  href="/app/activity"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                >
                  Track in Activity <ExternalLink size={11} />
                </a>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                First proof fetches the circuit (~37MB, cached after). Each proof takes a few
                seconds.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
