import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  CheckCircle2,
  XCircle,
  Ban,
  Plus,
  Coins,
  ExternalLink,
} from 'lucide-react';
import { getActivity, type ActivityItem, type ActivityKind } from '../../lib/activity';
import { Card, CardHeader, EmptyState, Pill } from '../../components/ui';

type PillTone = 'good' | 'violet' | 'warn' | 'slate';
const KIND_META: Record<
  ActivityKind,
  { icon: typeof Plus; tint: string; label: string; tone: PillTone }
> = {
  task_created: { icon: Plus, tint: 'text-sky-300', label: 'Created', tone: 'slate' },
  task_completed: { icon: CheckCircle2, tint: 'text-emerald-300', label: 'Settled', tone: 'good' },
  task_failed: { icon: XCircle, tint: 'text-red-400', label: 'Failed', tone: 'warn' },
  task_cancelled: { icon: Ban, tint: 'text-slate-400', label: 'Cancelled', tone: 'slate' },
  payment: { icon: Coins, tint: 'text-violet-300', label: 'Payment', tone: 'violet' },
};

/** Human-friendly relative time (e.g. "3m ago", "2h ago", "5d ago"). */
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Row({ item }: { item: ActivityItem }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const inner = (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06]">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] ${meta.tint}`}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-slate-100">{item.title}</span>
          <span className="shrink-0 text-xs text-slate-500">{timeAgo(item.at)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-xs text-slate-500">
          <Pill tone={meta.tone}>{item.status ?? meta.label}</Pill>
          {item.detail && <span className="truncate">{item.detail}</span>}
          {item.txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
              onClick={(e) => e.stopPropagation()}
            >
              receipt <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
      {item.amount != null && (
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-slate-200">
          ${item.amount.toFixed(2)}
        </span>
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
    <Card className="p-0">
      <CardHeader
        icon={ActivityIcon}
        title="Activity"
        hint="Your jobs and payments, most recent first"
      />
      <div className="p-5 pt-4">
        {isLoading && <p className="text-sm text-slate-500">Loading activity…</p>}
        {error && <p className="text-sm text-red-400">Could not load activity.</p>}
        {!isLoading && !error && items.length === 0 && (
          <EmptyState>
            No activity yet. Fund your vault and hire a service to get started.
          </EmptyState>
        )}
        <div className="space-y-2">
          {items.map((it) => (
            <Row key={it.id} item={it} />
          ))}
        </div>
      </div>
    </Card>
  );
}
