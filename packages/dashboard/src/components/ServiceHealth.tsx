import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fetchOrchestratorHealth, fetchRegistryHealth } from '../lib/api';

// ── Config ──────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 4_000;
// A single failed check doesn't flip a service to "down" — only two
// consecutive failures do. This absorbs one-off network blips without
// painting the whole bar red.
const FAILURE_THRESHOLD = 2;

type Health = 'checking' | 'up' | 'down';

interface ServiceState {
  name: string;
  health: Health;
  consecutiveFailures: number;
}

/**
 * Combine multiple AbortSignals into one, so a single fetch can be
 * cancelled by either a timeout or a component-unmount signal.
 * (Avoids relying on AbortSignal.any, which isn't available in every
 * runtime this dashboard may be built for.)
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

const DOT_CLASSES: Record<Health, string> = {
  up: 'bg-emerald-400',
  down: 'bg-red-500',
  checking: 'bg-gray-500 animate-pulse',
};

const TEXT_CLASSES: Record<Health, string> = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  checking: 'text-gray-500',
};

function aggregate(services: ServiceState[]): Health {
  if (services.some((s) => s.health === 'down')) return 'down';
  if (services.some((s) => s.health === 'checking')) return 'checking';
  return 'up';
}

/**
 * ServiceHealth
 *
 * Compact, collapsible status bar showing whether the orchestrator, the
 * registry, and the registered agents are reachable. Polls on an interval;
 * every check is timeout-bounded and flapping is debounced.
 *
 * Agent health is derived from the registry's agent list (`status` field)
 * rather than fanning out a direct `/health` request per agent. This is
 * the cheaper option — one request covers every agent — at the cost of
 * being only as fresh as the registry's last known status, rather than a
 * live per-agent check.
 */
export default function ServiceHealth() {
  const [orchestrator, setOrchestrator] = useState<ServiceState>({
    name: 'Orchestrator',
    health: 'checking',
    consecutiveFailures: 0,
  });
  const [registry, setRegistry] = useState<ServiceState>({
    name: 'Registry',
    health: 'checking',
    consecutiveFailures: 0,
  });
  const [agents, setAgents] = useState<ServiceState[]>([]);
  const [expanded, setExpanded] = useState(false);

  const mountedRef = useRef(true);
  const unmountControllerRef = useRef<AbortController>(new AbortController());

  const applyResult = useCallback(
    (prev: ServiceState, ok: boolean): ServiceState => {
      if (ok) {
        return { ...prev, health: 'up', consecutiveFailures: 0 };
      }
      const consecutiveFailures = prev.consecutiveFailures + 1;
      const health: Health = consecutiveFailures >= FAILURE_THRESHOLD ? 'down' : prev.health;
      return { ...prev, health: health === 'checking' ? 'checking' : health, consecutiveFailures };
    },
    [],
  );

  const poll = useCallback(async () => {
    const signal = combineSignals([
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      unmountControllerRef.current.signal,
    ]);

    const [orchestratorOk, registryResult] = await Promise.all([
      fetchOrchestratorHealth(signal).catch(() => false),
      fetchRegistryHealth(signal).catch(() => ({ ok: false, agents: [] as any[] })),
    ]);

    if (!mountedRef.current) return;

    setOrchestrator((prev) => applyResult(prev, orchestratorOk));
    setRegistry((prev) => applyResult(prev, registryResult.ok));

    if (registryResult.ok) {
      setAgents(
        registryResult.agents.map((a: any) => ({
          name: a.name ?? a.agent_id ?? 'agent',
          health: a.status === 'active' ? 'up' : 'down',
          consecutiveFailures: 0,
        })),
      );
    }
    // When the registry itself is unreachable, leave the last-known agent
    // list in place rather than clearing it — a registry blip shouldn't
    // make every agent row disappear.
  }, [applyResult]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = unmountControllerRef.current;

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allServices = [orchestrator, registry, ...agents];
  const overall = aggregate(allServices);

  return (
    <div className="hidden sm:flex items-center">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800/60 text-xs hover:bg-gray-900 transition-colors"
        title="Service health"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${DOT_CLASSES[overall]}`} />
        <span className={TEXT_CLASSES[overall]}>Services</span>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>

      {expanded && (
        <div className="absolute top-12 mt-1 z-30 bg-gray-950/98 border border-gray-800 rounded-lg shadow-xl p-2 min-w-[180px] text-xs">
          {allServices.map((s, i) => (
            <div key={`${s.name}-${i}`} className="flex items-center gap-2 px-2 py-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[s.health]}`} />
              <span className="text-gray-300 truncate">{s.name}</span>
              <span className={`ml-auto ${TEXT_CLASSES[s.health]}`}>{s.health}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
