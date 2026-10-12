import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, Plus, X, Lock } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardHeader,
  Button,
  SectionLabel,
  EmptyState,
} from '../../components/ui';
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

/**
 * pp/2 trustless disburse, entirely client-side. The owner's policy (a
 * per-payment ceiling + a fresh salt) is turned into a Groth16 proof IN THE
 * BROWSER using the hosted circuit artifacts; only the proof is sent to the
 * relay. The server never sees the policy, and the chain verifies the proof
 * before the vault moves funds. Up to four payouts ride one proof.
 */
export function DisbursePage() {
  const [ceiling, setCeiling] = useState('10');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '' }]);
  const [phase, setPhase] = useState('');

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

      setPhase(
        'Proving in your browser, your policy never leaves this device. First run downloads the circuit (~37MB).',
      );
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

      setPhase('Submitting the proof to the relay, the chain verifies it before any funds move.');
      const resp = await apiPost<{ jobId: string; status: string }>(
        '/vault/batch-release-proved',
        request,
      );
      setPhase('');
      return {
        ...resp,
        total,
        legs: releases.length,
        commitment: proof.commitment.toString('hex'),
      };
    },
    onError: () => setPhase(''),
  });

  const busy = disburse.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Private"
        title="Trustless disburse"
        subtitle="Pay up to four recipients under one zero-knowledge proof. Your policy is proven here in the browser; the server only relays the proof and the chain enforces it."
      />

      <div className="max-w-2xl">
        <Card>
          <CardHeader
            icon={ShieldCheck}
            title="Prove and disburse"
            hint="The proof is generated on this device from your private policy. Nothing about the rule leaves your browser."
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
                className="mt-1.5 w-40 rounded-xl bg-white/[0.05] px-3 py-2 text-sm text-white outline-none ring-1 ring-inset ring-white/10 focus:ring-violet-400/60"
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
                    className="min-w-0 flex-1 rounded-xl bg-white/[0.05] px-3 py-2 font-mono text-xs text-white outline-none ring-1 ring-inset ring-white/10 focus:ring-violet-400/60"
                    aria-label={`Payee ${i + 1} address`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="USDC"
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    className="w-24 rounded-xl bg-white/[0.05] px-3 py-2 text-sm text-white outline-none ring-1 ring-inset ring-white/10 focus:ring-violet-400/60"
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

            <div className="flex items-center gap-3 pt-1">
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

            {phase && <p className="text-sm text-violet-300">{phase}</p>}
            {disburse.error && (
              <p className="text-sm text-red-400">{(disburse.error as Error).message}</p>
            )}
          </form>
        </Card>

        {disburse.data && (
          <div className="mt-4">
            <Card>
              <div className="space-y-2 px-5 py-4 text-sm">
                <p className="font-semibold text-emerald-300">
                  Proof accepted, disbursing {disburse.data.total} USDC to {disburse.data.legs}{' '}
                  recipient{disburse.data.legs > 1 ? 's' : ''}.
                </p>
                <p className="text-slate-400">
                  Job <span className="font-mono text-xs">{disburse.data.jobId}</span> is queued.
                  The worker submits the proof and the vault moves funds once the chain verifies it.
                </p>
                <p className="break-all text-xs text-slate-500">
                  commitment {disburse.data.commitment}
                </p>
                <p className="text-xs text-slate-500">
                  Track it in{' '}
                  <a className="text-violet-300 hover:text-violet-200" href="/app/activity">
                    Activity
                  </a>
                  .
                </p>
              </div>
            </Card>
          </div>
        )}

        {!disburse.data && !busy && active.length === 0 && (
          <div className="mt-4">
            <EmptyState>Add a recipient and an amount, then prove and disburse.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
