import { Keypair } from '@stellar/stellar-sdk';
import { SERVICES } from './services.js';

/**
 * Register this provider's catalog on CleverCon. Run once after the provider is
 * deployed and reachable. Each service is registered with its acceptance contract
 * (tier + io schemas + verifier), and the payout address is proven by signing a
 * server challenge with its key.
 *
 * Env:
 *   CLEVERCON_API_URL        the API base, e.g. https://<api>.up.railway.app
 *   CLEVERCON_JWT            a provider access token (log in as the provider in the
 *                            app, copy the bearer token)
 *   PROVIDER_PAYOUT_SECRET   Stellar secret of the payout address (S...)
 *   PROVIDER_ENDPOINT        the deployed provider URL the worker will POST to
 */
function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Required: CLEVERCON_API_URL, CLEVERCON_JWT, PROVIDER_PAYOUT_SECRET, PROVIDER_ENDPOINT`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const API = env('CLEVERCON_API_URL').replace(/\/+$/, '');
  const JWT = env('CLEVERCON_JWT');
  const kp = Keypair.fromSecret(env('PROVIDER_PAYOUT_SECRET'));
  const endpoint = env('PROVIDER_ENDPOINT');
  const payout = kp.publicKey();
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${JWT}` };

  console.log(`Registering ${SERVICES.length} services, payout ${payout}, endpoint ${endpoint}`);
  for (const s of SERVICES) {
    const chRes = await fetch(`${API}/provider/payout-challenge`, { headers });
    if (!chRes.ok) {
      console.error(`challenge failed (${chRes.status}); is CLEVERCON_JWT valid?`);
      process.exit(1);
    }
    const { challenge } = (await chRes.json()) as { challenge: string };
    const signature = kp.sign(Buffer.from(challenge)).toString('base64');

    const res = await fetch(`${API}/provider/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: s.name,
        description: s.description,
        category: s.category,
        capabilities: [s.action],
        pricingModel: 'X402',
        pricePerCall: s.pricePerCall,
        endpoint,
        stellarAddress: payout,
        tier: s.tier,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
        verification: s.verification,
        payoutProof: { challenge, signature },
      }),
    });
    if (!res.ok) {
      console.error(`  x ${s.name}: ${res.status} ${await res.text()}`);
      continue;
    }
    const out = (await res.json()) as { agentId?: string };
    console.log(`  ok ${s.name} (tier ${s.tier}, agentId ${out.agentId ?? '?'})`);
  }
  console.log('Done. Set VERIFIED_AGENT_IDS on the API to an agentId to show the verified badge.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
