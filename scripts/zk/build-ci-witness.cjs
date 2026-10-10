// Build a satisfiable witness for policy_single.circom that exercises R1 + R3 +
// R5, using the compiled poseidon2 circuit as the hash oracle so the allowlist
// tree matches the in-circuit Poseidon exactly. Writes build/policy-input.json.
//
// The allowlist here is the minimal real membership proof: the payee is a leaf
// and every sibling on its path is 0 (a sparse tree), so the committed root is
// the fold of Poseidon up that path. This is a genuine R3 membership witness.
const fs = require('fs');
const path = require('path');

const DEPTH = 16;
const PAYEE_FIELD = 12345678901234567890n;
const PAYEE_CAP = 80n; // R5: amount (60) must be <= cap
const AMOUNT = 60n;
const CEILING = 100n; // R1: amount (60) must be <= ceiling

async function main() {
  const wcBuilder = require(path.resolve('build/poseidon2_js/witness_calculator.js'));
  const wasm = fs.readFileSync(path.resolve('build/poseidon2_js/poseidon2.wasm'));
  const wc = await wcBuilder(wasm);

  // Poseidon(2) via the oracle; the single output sits at witness index 1.
  const P2 = async (a, b) => {
    const w = await wc.calculateWitness({ a: a.toString(), b: b.toString() }, 0);
    return BigInt(w[1]);
  };

  const leaf = await P2(PAYEE_FIELD, PAYEE_CAP);
  const pathElements = [];
  const pathIndex = [];
  let cur = leaf;
  for (let i = 0; i < DEPTH; i++) {
    pathElements.push('0'); // all-zero co-path
    pathIndex.push('0'); // payee is always the left child
    cur = await P2(cur, 0n);
  }
  const r3Root = cur;

  const input = {
    payee_field: PAYEE_FIELD.toString(),
    amount: AMOUNT.toString(),
    en: ['1', '0', '1', '0', '1', '0'], // R1, R3, R5 enabled
    r1_ceiling: CEILING.toString(),
    r2_cap: '0',
    r2_window: '0',
    r2_delegate: '0',
    r3_root: r3Root.toString(),
    r3_depth: DEPTH.toString(),
    r4_entries: ['0', '0', '0', '0'],
    r4_threshold: '0',
    r6_windows_root: '0',
    category: '0',
    salt: '88442211556677',
    spend_counter: '0',
    r3_path: pathElements,
    r3_index: pathIndex,
    payee_cap: PAYEE_CAP.toString(),
  };

  fs.writeFileSync('build/policy-input.json', JSON.stringify(input, null, 2));
  console.log('r3_root =', r3Root.toString());
  console.log('wrote build/policy-input.json (R1 + R3 + R5 witness)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
