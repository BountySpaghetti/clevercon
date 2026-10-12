import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  Ban,
  Plus,
  Coins,
  ExternalLink,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import { getActivity, type ActivityItem, type ActivityKind } from '../../lib/activity';

type Tone = 'good' | 'violet' | 'warn' | 'slate';
const KIND_META: Record<ActivityKind, { icon: typeof Plus; label: string; tone: Tone }> = {
  task_created: { icon: Plus, label: 'Created', tone: 'slate' },
  task_completed: { icon: CheckCircle2, label: 'Settled', tone: 'good' },
  task_failed: { icon: XCircle, label: 'Failed', tone: 'warn' },
  task_cancelled: { icon: Ban, label: 'Cancelled', tone: 'slate' },
  payment: { icon: Coins, label: 'Payment', tone: 'violet' },
};

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Row({ item, last }: { item: ActivityItem; last: boolean }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const inner = (
    <div
      className={`flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-white/[0.02] ${last ? '' : 'border-b border-line'}`}
    >
      <span className="cc-ic" style={{ width: 36, height: 36 }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-100">{item.title}</div>
        <div className="mt-1 flex items-center gap-2.5 text-xs text-slate-500">
          <span className={`cc-pill cc-pill-${meta.tone}`}>
            <span className="cc-dot" /> {item.status ?? meta.label}
          </span>
          {item.detail && <span className="truncate">{item.detail}</span>}
          <span className="text-slate-600">{timeAgo(item.at)}</span>
        </div>
      </div>
      {item.amount != null && (
        <span className="cc-num shrink-0 font-mono text-sm font-semibold text-slate-100">
          ${item.amount.toFixed(2)}
        </span>
      )}
      {item.txHash && (
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500 hover:text-violet-300"
          onClick={(e) => e.stopPropagation()}
          title="View the on-chain receipt"
        >
          receipt <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
  return item.taskId ? (
    <Link to={`/app/tasks/${item.taskId}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function ActivityPage() {
  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['activity'],
    queryFn: getActivity,
  });

  return (
    <div className="cc-stagger space-y-6">
      <header>
        <p className="cc-eyebrow">Ledger</p>
        <h1 className="cc-title mt-2">Activity</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-400">
          <ShieldCheck size={14} className="text-violet-300" />
          Every spend your agent made, newest first, each with its on-chain receipt.
        </p>
      </header>

      <div className="cc-card overflow-hidden">
        {isLoading && (
          <div className="space-y-px">
            {[0, 1, 2].map((i) => (
              <div key={i} className="cc-shimmer h-[66px] border-b border-line last:border-0" />
            ))}
          </div>
        )}
        {error && <p className="px-4 py-6 text-sm text-amber-300">Could not load activity.</p>}
        {!isLoading && !error && items.length === 0 && (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] text-slate-500">
              <Inbox size={20} />
            </span>
            <p className="text-sm font-medium text-slate-300">No activity yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
              Fund your vault, then instruct your agent or run a disburse. Everything it does shows
              up here with a receipt.
            </p>
            <Link to="/app/vault" className="cc-btn mt-4 inline-flex">
              Fund the vault
            </Link>
          </div>
        )}
        {items.map((it, i) => (
          <Row key={it.id} item={it} last={i === items.length - 1} />
        ))}
      </div>
    </div>
  );
}
