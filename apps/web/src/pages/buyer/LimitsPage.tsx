import { SlidersHorizontal, Eye, Infinity as InfinityIcon, ListChecks } from 'lucide-react';
import { LimitsManager } from './limits';

/**
 * Spending limits get their own tab: the rules are a distinct concept from the
 * money (Vault) and the command surface (Home). Each instruction you give the
 * agent carries its own limit, enforced on-chain per task; you build reusable
 * rules here and pick one per instruction, optionally marking one as the default.
 */
export function LimitsPage() {
  return (
    <div className="cc-stagger max-w-4xl space-y-6">
      <header>
        <p className="cc-eyebrow">Rules</p>
        <h1 className="cc-title mt-2">Spending limits</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          The boundaries your agent cannot cross. Build a reusable limit here, then pick one for any
          instruction on the Agent tab. Star one to make it the default.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { ic: InfinityIcon, t: 'Per-payment cap', d: 'The most any single payout can be.' },
          { ic: ListChecks, t: 'Allowlist', d: 'Only addresses you approve can be paid.' },
          { ic: Eye, t: 'Kept private', d: 'Commit a hash; the rule itself is never published.' },
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

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-white/[0.02] p-4 text-sm leading-relaxed text-slate-400">
        <SlidersHorizontal size={16} className="mt-0.5 shrink-0 text-violet-300" />
        <span>
          Limits are enforced on-chain by the vault, bound per task, so nothing is truly global.
          Pick one per instruction on the Agent tab; the default pre-fills each new one and you can
          always override it.
        </span>
      </div>

      <LimitsManager />
    </div>
  );
}
