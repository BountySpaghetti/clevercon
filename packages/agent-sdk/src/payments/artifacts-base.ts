/**
 * The default public host for the pp/2 circuit artifacts (testnet). Kept in its
 * own Node-free module so both the Node resolver (`artifacts.ts`) and the
 * browser prover entry (`prover.ts`) can share it without pulling Node builtins
 * into a browser bundle. Swap for a custom domain in production.
 */
export const DEFAULT_ARTIFACT_BASE_URL = 'https://pub-e758f36ef6b048099ecc75f84a702f7a.r2.dev';
