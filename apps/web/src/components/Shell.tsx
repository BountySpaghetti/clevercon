import { useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Layers,
  Bot,
  SlidersHorizontal,
  Search,
  ShieldCheck,
  Activity as ActivityIcon,
  Vault as VaultIcon,
  Store,
  Terminal,
  Menu,
  X,
} from 'lucide-react';
import { useSession, type Role } from '../store/session';
import { useWalletAuth } from '../auth/useWalletAuth';
import { DemoBanner } from './DemoBanner';
import { config } from '../config';

type Icon = ComponentType<{ size?: number; className?: string }>;

const NETWORKS: Record<string, { label: string; dot: string; text: string; border: string }> = {
  testnet: {
    label: 'Stellar testnet',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    border: 'border-amber-500/25',
  },
  mainnet: {
    label: 'Stellar mainnet',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    border: 'border-emerald-500/25',
  },
  local: { label: 'Local', dot: 'bg-slate-400', text: 'text-slate-400', border: 'border-white/10' },
};

// The agent console is the product. Its sections are the primary rail, matching
// the money-app concept: one place for the agent, the rules, the market, the
// money, and the proof of every spend.
const PRIMARY: { to: string; label: string; icon: Icon; end?: boolean }[] = [
  { to: '/app', label: 'Agent', icon: Bot, end: true },
  { to: '/app/limits', label: 'Limits', icon: SlidersHorizontal },
  { to: '/app/services', label: 'Services', icon: Search },
  { to: '/app/disburse', label: 'Disburse', icon: ShieldCheck },
  { to: '/app/activity', label: 'Activity', icon: ActivityIcon },
  { to: '/app/vault', label: 'Vault', icon: VaultIcon },
];

// Other consoles, shown only to accounts that hold (or can self-serve) the role.
const CONSOLES: { to: string; label: string; role: Role; icon: Icon; selfServe?: boolean }[] = [
  { to: '/provider', label: 'Provider', role: 'PROVIDER', icon: Store, selfServe: true },
  { to: '/developers', label: 'Developer', role: 'DEVELOPER', icon: Terminal, selfServe: true },
  { to: '/admin', label: 'Admin', role: 'ADMIN', icon: ShieldCheck },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 shadow-lg shadow-violet-900/40">
        <Layers size={16} className="text-white" />
      </span>
      <span className="text-[15px] font-bold tracking-tight text-white">CleverCon</span>
    </Link>
  );
}

function NetworkBadge() {
  const net = NETWORKS[config.network] ?? NETWORKS.testnet;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-white/[0.03] px-2.5 py-1 text-[11px] ${net.border} ${net.text}`}
      title={`This app is operating against ${net.label}.`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${net.dot}`} /> {net.label}
    </span>
  );
}

function NonCustodialBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-1 text-[11px] text-emerald-300"
      title="Your funds stay in your own vault. CleverCon never takes custody."
    >
      <ShieldCheck size={12} /> Non-custodial
    </span>
  );
}

function WalletButton({ full = false }: { full?: boolean }) {
  const session = useSession((s) => s.session);
  const { disconnect } = useWalletAuth();
  if (session) {
    return (
      <button
        onClick={disconnect}
        className={`rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2 text-left font-mono text-xs text-slate-300 transition-colors hover:bg-white/[0.07] ${full ? 'w-full' : ''}`}
        title="Disconnect wallet"
      >
        {session.address.slice(0, 4)}…{session.address.slice(-4)}
        <span className="text-slate-500"> · Disconnect</span>
      </button>
    );
  }
  return (
    <Link
      to="/connect"
      className={`rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-indigo-500 ${full ? 'block' : ''}`}
    >
      Connect
    </Link>
  );
}

function NavRail({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession((s) => s.session);
  const loc = useLocation();
  const roles = session?.roles ?? [];
  const isActive = (to: string, end?: boolean) =>
    end ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(to + '/');
  const consoles = CONSOLES.filter((c) => roles.includes(c.role) || (c.selfServe && session));

  const Item = ({
    to,
    label,
    icon: I,
    end,
  }: {
    to: string;
    label: string;
    icon: Icon;
    end?: boolean;
  }) => {
    const active = isActive(to, end);
    return (
      <Link
        to={to}
        onClick={onNavigate}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
          active
            ? 'bg-violet-500/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(139,124,255,0.25)]'
            : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
        }`}
      >
        <I size={17} className={active ? 'text-violet-300' : ''} />
        {label}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
        Console
      </div>
      {session ? (
        PRIMARY.map((n) => <Item key={n.to} {...n} />)
      ) : (
        <p className="px-3 text-xs text-slate-600">Connect a wallet to begin.</p>
      )}

      {consoles.length > 0 && (
        <>
          <div className="px-3 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            Switch
          </div>
          {consoles.map((n) => (
            <Item key={n.to} {...n} />
          ))}
        </>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap gap-2 px-1">
          <NetworkBadge />
          <NonCustodialBadge />
        </div>
        <WalletButton full />
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The landing page is a full-bleed marketing page with its own chrome.
  if (loc.pathname === '/') return <>{children}</>;

  return (
    <div className="relative min-h-screen text-slate-100">
      <div className="app-ambient" aria-hidden />

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-black/20 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-6">
          <Brand />
        </div>
        <NavRail />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-black/50 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Brand />
        <div className="flex items-center gap-3">
          <WalletButton />
          <button
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/[0.06]"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-[#0c0e16] px-3 py-5">
            <div className="mb-6">
              <Brand />
            </div>
            <NavRail onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative z-10 lg:pl-60">
        <DemoBanner />
        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
