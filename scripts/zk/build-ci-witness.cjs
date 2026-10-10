// Build a satisfiable witness for policy_batch.circom (N = 4) that exercises
// R1 + R3 + R5 across a batch: three active releases to an allowlisted payee
// plus one null slot. Uses the compiled poseidon2 circuit as the hash oracle so
// the allowlist tree matches the in-circuit Poseidon exactly. Writes
// build/policy-input.json.
const fs = require('fs');
const path = require('path');

const DEPTH = 16;
const N = 4;
const PAYEE_FIELD = 12345678901234567890n;
const PAYEE_CAP = 80n; // R5: each release's amount must be <= cap
const CEILING = 100n; // R1: each release's amount must be <= ceiling

// Three real releases to the same allowlisted payee (distinct amounts/counters
// so nullifiers differ), then one null slot.
const ACTIVE = [1n, 1n, 1n, 0n];
const AMOUNTS = [60n, 30n, 10n, 0n];
const COUNTERS = [0n, 1n, 2n, 0n];

async function main() {
  const wcBuilder = require(path.resolve('build/poseidon2_js/witness_calculator.js'));
  const wasm = fs.readFileSync(path.resolve('build/poseidon2_js/poseidon2.wasm'));
  const wc = await wcBuilder(wasm);

  const P2 = async (a, b) => {
    const w = await wc.calculateWitness({ a: a.toString(), b: b.toString() }, 0);
    return BigInt(w[1]); // single output at witness index 1
  };

  // Build one real membership path (all-zero co-path, payee always the left
  // child) and reuse it for every active release (same payee, same leaf).
  const leaf = await P2(PAYEE_FIELD, PAYEE_CAP);
  const zeroPath = [];
  const zeroIndex = [];
  let cur = leaf;
  for (let i = 0; i < DEPTH; i++) {
    zeroPath.push('0');
    zeroIndex.push('0');
    cur = await P2(cur, 0n);
  }
  const r3Root = cur;

  const payee_field = [];
  const amount = [];
  const active = [];
  const spend_counter = [];
  const payee_cap = [];
  const r3_path = [];
  const r3_index = [];
  for (let k = 0; k < N; k++) {
    const isActive = ACTIVE[k] === 1n;
    payee_field.push(isActive ? PAYEE_FIELD.toString() : '0');
    amount.push(AMOUNTS[k].toString());
    active.push(ACTIVE[k].toString());
    spend_counter.push(COUNTERS[k].toString());
    payee_cap.push(isActive ? PAYEE_CAP.toString() : '0');
    r3_path.push([...zeroPath]);
    r3_index.push([...zeroIndex]);
  }

  const input = {
    payee_field,
    amount,
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
    active,
    spend_counter,
    r3_path,
    r3_index,
    payee_cap,
  };

  fs.writeFileSync('build/policy-input.json', JSON.stringify(input, null, 2));
  console.log('r3_root =', r3Root.toString());
  console.log(`wrote build/policy-input.json (batch N=${N}: 3 active + 1 null)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
