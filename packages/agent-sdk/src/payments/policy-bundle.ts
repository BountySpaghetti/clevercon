/**
 * A "policy bundle" is the owner's private spending policy in product terms
 * (plain rules + a secret salt). It is the client-side secret that pp/2 proving
 * needs: the salt pins the on-chain commitment, and the rules become the circuit
 * witness. It never leaves the owner/agent, which is what keeps the policy private
 * (the server only ever sees the commitment).
 *
 * This maps the product rule shape (the same `perPaymentCeilingUsdc` /
 * `rollingCapUsdc` / ... the console and `set_limit` use) onto the batch circuit's
 * {@link PolicyWitness}. v1 covers R1 (per-payment ceiling), R2 (rolling cap), and
 * R7 (velocity); allowlist/deny/calendar/category (R3-R6, R8) are follow-ons that
 * need a Merkle/commitment input and are left disabled here.
 */
import type { PolicyWitness } from './batch-prover.js';

const STROOPS_PER_USDC = 10_000_000;
const usdcToStroops = (usdc: number): string => String(BigInt(Math.round(usdc * STROOPS_PER_USDC)));

/** The owner's rules, in product (USDC/seconds) terms. R1 is required. */
export interface PolicyBundleRules {
  /** R1: per-payment ceiling in USDC (required; every release must be <=). */
  perPaymentCeilingUsdc: number;
  /** R2: rolling cap in USDC over `rollingWindowSecs` (both or neither). */
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  /** R7: max number of releases over `velocityWindowSecs` (both or neither). */
  maxReleasesPerWindow?: number;
  velocityWindowSecs?: number;
}

/** The owner's private policy: rules + the secret salt that pins the commitment. */
export interface PolicyBundle {
  rules: PolicyBundleRules;
  /** Decimal field element (< r). Keep private; losing it loses the ability to prove. */
  salt: string;
}

/**
 * A fresh random salt as a decimal field element (< 2^253 < r). Works in Node 20+
 * and browsers (both expose `globalThis.crypto.getRandomValues`). Generate once
 * per policy and store it with the rules as the {@link PolicyBundle}.
 */
export function newSalt(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  b[0] &= 0x1f; // clear the top 3 bits so the value is < 2^253 < r
  let hex = '';
  for (const x of b) hex += x.toString(16).padStart(2, '0');
  return BigInt('0x' + hex).toString();
}

/**
 * Build the circuit {@link PolicyWitness} from a {@link PolicyBundle}. Enables a
 * rule only when its fields are present, so a bare per-payment ceiling yields an
 * R1-only policy (the shape proven live). Amounts are converted USDC -> stroops.
 */
export function policyWitnessFromBundle(bundle: PolicyBundle): PolicyWitness {
  const r = bundle.rules;
  if (!(r.perPaymentCeilingUsdc > 0)) {
    throw new Error('policy bundle requires perPaymentCeilingUsdc > 0 (R1)');
  }
  const r2 = r.rollingCapUsdc != null && r.rollingWindowSecs != null;
  const r7 = r.maxReleasesPerWindow != null && r.velocityWindowSecs != null;
  if ((r.rollingCapUsdc != null) !== (r.rollingWindowSecs != null)) {
    throw new Error('R2 needs both rollingCapUsdc and rollingWindowSecs, or neither');
  }
  if ((r.maxReleasesPerWindow != null) !== (r.velocityWindowSecs != null)) {
    throw new Error('R7 needs both maxReleasesPerWindow and velocityWindowSecs, or neither');
  }
  return {
    enabled: [true, r2, false, false, false, false, r7, false],
    salt: bundle.salt,
    r1Ceiling: usdcToStroops(r.perPaymentCeilingUsdc),
    r2Cap: r2 ? usdcToStroops(r.rollingCapUsdc as number) : '0',
    r2WindowSecs: r2 ? String(r.rollingWindowSecs) : '0',
    r2Delegate: '0',
    r3Root: '0',
    r3Depth: '16',
    r4Entries: ['0', '0', '0', '0'],
    r4Threshold: '0',
    r6WindowsRoot: '0',
    r6Windows: [
      { start: '0', end: '0' },
      { start: '0', end: '0' },
    ],
    r7MaxCount: r7 ? String(r.maxReleasesPerWindow) : '0',
    r7WindowSecs: r7 ? String(r.velocityWindowSecs) : '0',
    r8CatCeilings: ['0', '0', '0', '0'],
    disclosureTag: '0',
  };
}
