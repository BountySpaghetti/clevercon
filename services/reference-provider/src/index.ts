import { createProvider } from '@clevercon/agent-sdk/provider';
import { SERVICE_BY_ACTION, SERVICES } from './services.js';

/**
 * The reference provider: several real, hireable services on one process, built on
 * the SDK's createProvider. The CleverCon worker POSTs a job (with its `action`)
 * to this endpoint; we dispatch to the matching service and return the standard
 * result envelope, which the worker verifies against the service's declared tier
 * before the vault pays. One endpoint, many services (see services.ts).
 */
// Railway assigns the public port via PORT; fall back to PROVIDER_PORT/4200 locally.
const PORT = Number(process.env.PORT ?? process.env.PROVIDER_PORT ?? 4200);
const NAME = process.env.PROVIDER_NAME ?? 'clevercon-reference-provider';

const provider = createProvider({
  name: NAME,
  port: PORT,
  async fulfill({ action, body }) {
    const svc = SERVICE_BY_ACTION.get(action);
    const input = ((body as { input?: Record<string, unknown> }).input ?? {}) as Record<
      string,
      unknown
    >;
    // Unknown action: fall back to the market snapshot so a bare hire still works.
    const handler = svc?.handler ?? SERVICES.find((s) => s.action === 'market.snapshot')!.handler;
    return handler(input);
  },
});

provider.listen(PORT);
console.log(`[${NAME}] serving ${SERVICES.length} services: ${SERVICES.map((s) => s.action).join(', ')}`);
