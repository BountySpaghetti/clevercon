// Build a satisfiable witness for policy_batch.circom (N = 4, C = 4) exercising
// R1 + R3 + R5 + R8 across a batch: three active releases to an allowlisted payee
// plus one null slot. Uses the compiled poseidon2/poseidon3 circuits as hash
// oracles so the allowlist tree (leaf = H(payee, cap, category)) matches the
// in-circuit Poseidon exactly. Writes build/policy-input.json.
const fs = require('fs');
const path = require('path');

const DEPTH = 16;
const N = 4;
const C = 4;
const PAYEE_FIELD = 12345678901234567890n;
const PAYEE_CAP = 80n; // R5: amount <= cap
const PAYEE_CATEGORY = 0n; // R8: category index 0
const CEILING = 100n; // R1: amount <= ceiling
const CAT_CEILING = [1000n, 0n, 0n, 0n]; // R8: category-0 ceiling (amount 60 <= 1000)

const ACTIVE = [1n, 1n, 1n, 0n];
const AMOUNTS = [60n, 30n, 10n, 0n];
const COUNTERS = [0n, 1n, 2n, 0n];

async function loadOracle(name) {
  const builder = require(path.resolve(`build/${name}_js/witness_calculator.js`));
  const wasm = fs.readFileSync(path.resolve(`build/${name}_js/${name}.wasm`));
  return builder(wasm);
}

async function main() {
  const wc2 = await loadOracle('poseidon2');
  const wc3 = await loadOracle('poseidon3');
  const P2 = async (a, b) => BigInt((await wc2.calculateWitness({ a: a.toString(), b: b.toString() }, 0))[1]);
  const P3 = async (a, b, c) =>
    BigInt((await wc3.calculateWitness({ a: a.toString(), b: b.toString(), c: c.toString() }, 0))[1]);

  // One real membership path (all-zero co-path, payee always the left child),
  // reused for every active release (same payee leaf).
  const leaf = await P3(PAYEE_FIELD, PAYEE_CAP, PAYEE_CATEGORY);
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
  const payee_category = [];
  const r3_path = [];
  const r3_index = [];
  for (let k = 0; k < N; k++) {
    const isActive = ACTIVE[k] === 1n;
    payee_field.push(isActive ? PAYEE_FIELD.toString() : '0');
    amount.push(AMOUNTS[k].toString());
    active.push(ACTIVE[k].toString());
    spend_counter.push(COUNTERS[k].toString());
    payee_cap.push(isActive ? PAYEE_CAP.toString() : '0');
    payee_category.push(PAYEE_CATEGORY.toString());
    r3_path.push([...zeroPath]);
    r3_index.push([...zeroIndex]);
  }

  const input = {
    payee_field,
    amount,
    en: ['1', '0', '1', '1', '1', '0', '0', '1'], // R1, R3, R4, R5, R8 enabled
    r1_ceiling: CEILING.toString(),
    r2_cap: '0',
    r2_window: '0',
    r2_delegate: '0',
    r3_root: r3Root.toString(),
    r3_depth: DEPTH.toString(),
    r4_entries: ['111', '222', '333', '444'], // deny-list, none == payee
    r4_threshold: '50', // amount 60 >= 50, so the deny-list applies
    r6_windows_root: '0',
    r7_max_count: '0',
    r7_window: '0',
    r8_cat_ceiling: CAT_CEILING.map((x) => x.toString()),
    disclosure_tag: '0',
    salt: '88442211556677',
    active,
    spend_counter,
    r3_path,
    r3_index,
    payee_cap,
    payee_category,
  };

  fs.writeFileSync('build/policy-input.json', JSON.stringify(input, null, 2));
  console.log('r3_root =', r3Root.toString());
  console.log(`wrote build/policy-input.json (batch N=${N}: R1+R3+R4+R5+R8, 3 active + 1 null)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
