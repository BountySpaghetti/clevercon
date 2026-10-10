pragma circom 2.1.0;

// pp/2 batch spend-policy circuit: one Groth16 proof authorizes up to N releases
// (a bounty payout, a payroll run) under the same private policy. Over BLS12-381,
// verified by a real pairing on-chain. See docs/private-policies-v2.md.
//
// Public outputs: commitment, nullifier[N].
// Public inputs:  payee_field[N], amount[N].
//
// Each release is checked independently against the SHARED policy (R1 ceiling,
// R3 allowlist membership, R5 per-payee limit) and gets its own nullifier. An
// `active` flag marks real releases; a null slot (active = 0) is a provable
// no-op whose nullifier is 0, so a partially filled batch is cheap and the vault
// simply skips the zero-nullifier slots. R2/R4/R6 fields are bound into the
// commitment and enforced in later increments.
//
// Hash: circomlib Poseidon over BLS12-381 (production pins BLS12-381-native
// constants before the trusted setup; see the package README).

include "poseidon.circom";
include "comparators.circom";
include "bitify.circom";

// Recompute a Merkle root from a leaf and its authentication path. pathIndex[i]
// selects left/right at level i (0 = current node is the left child), done
// arithmetically (degree 2), no external mux.
template MerkleRoot(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndex[DEPTH];
    signal output root;

    component hashers[DEPTH];
    signal cur[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    cur[0] <== leaf;
    for (var i = 0; i < DEPTH; i++) {
        pathIndex[i] * (pathIndex[i] - 1) === 0;
        left[i] <== cur[i] + pathIndex[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndex[i] * (cur[i] - pathElements[i]);
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[DEPTH];
}

template PolicyBatch(DEPTH, N) {
    // ---- public inputs (vault-supplied, one per release) ----
    signal input payee_field[N];
    signal input amount[N];

    // ---- shared policy (private; all commitment fields, section 3) ----
    signal input en[6];
    signal input r1_ceiling;
    signal input r2_cap;
    signal input r2_window;
    signal input r2_delegate;
    signal input r3_root;
    signal input r3_depth;
    signal input r4_entries[4];
    signal input r4_threshold;
    signal input r6_windows_root;
    signal input category;
    signal input salt;

    // ---- per-release private witnesses ----
    signal input active[N];
    signal input spend_counter[N];
    signal input r3_path[N][DEPTH];
    signal input r3_index[N][DEPTH];
    signal input payee_cap[N];

    // ---- public outputs ----
    signal output commitment;
    signal output nullifier[N];

    var VERSION = 2;

    // Enabled flags boolean, at least one active rule, R5 requires R3.
    var ensum = 0;
    for (var i = 0; i < 6; i++) {
        en[i] * (en[i] - 1) === 0;
        ensum += en[i];
    }
    component notEmpty = IsZero();
    notEmpty.in <== ensum;
    notEmpty.out === 0;
    en[4] * (1 - en[2]) === 0;

    // Commitment over the full policy encoding (shared across the batch).
    component h1 = Poseidon(12);
    h1.inputs[0] <== en[0];
    h1.inputs[1] <== en[1];
    h1.inputs[2] <== en[2];
    h1.inputs[3] <== en[3];
    h1.inputs[4] <== en[4];
    h1.inputs[5] <== en[5];
    h1.inputs[6] <== r1_ceiling;
    h1.inputs[7] <== r2_cap;
    h1.inputs[8] <== r2_window;
    h1.inputs[9] <== r2_delegate;
    h1.inputs[10] <== r3_root;
    h1.inputs[11] <== r3_depth;

    component h2 = Poseidon(8);
    h2.inputs[0] <== r4_entries[0];
    h2.inputs[1] <== r4_entries[1];
    h2.inputs[2] <== r4_entries[2];
    h2.inputs[3] <== r4_entries[3];
    h2.inputs[4] <== r4_threshold;
    h2.inputs[5] <== r6_windows_root;
    h2.inputs[6] <== category;
    h2.inputs[7] <== VERSION;

    component hc = Poseidon(3);
    hc.inputs[0] <== h1.out;
    hc.inputs[1] <== h2.out;
    hc.inputs[2] <== salt;
    commitment <== hc.out;

    // Per-release checks. Gates are kept degree-2 via intermediate signals.
    component amountBits[N];
    component leafH[N];
    component mt[N];
    component le1[N];
    component le5[N];
    component hn[N];
    signal g1[N];
    signal g3[N];
    signal g5[N];

    for (var k = 0; k < N; k++) {
        active[k] * (active[k] - 1) === 0;

        amountBits[k] = Num2Bits(128);
        amountBits[k].in <== amount[k];

        // R1: active AND enabled => amount <= ceiling.
        le1[k] = LessEqThan(128);
        le1[k].in[0] <== amount[k];
        le1[k].in[1] <== r1_ceiling;
        g1[k] <== active[k] * en[0];
        g1[k] * (1 - le1[k].out) === 0;

        // R3: active AND enabled => membership. Leaf = H(payee, cap) binds R5.
        leafH[k] = Poseidon(2);
        leafH[k].inputs[0] <== payee_field[k];
        leafH[k].inputs[1] <== payee_cap[k];
        mt[k] = MerkleRoot(DEPTH);
        mt[k].leaf <== leafH[k].out;
        for (var j = 0; j < DEPTH; j++) {
            mt[k].pathElements[j] <== r3_path[k][j];
            mt[k].pathIndex[j] <== r3_index[k][j];
        }
        g3[k] <== active[k] * en[2];
        g3[k] * (mt[k].root - r3_root) === 0;

        // R5: active AND enabled => amount <= per-payee cap.
        le5[k] = LessEqThan(128);
        le5[k].in[0] <== amount[k];
        le5[k].in[1] <== payee_cap[k];
        g5[k] <== active[k] * en[4];
        g5[k] * (1 - le5[k].out) === 0;

        // Nullifier: 0 for a null slot, a distinct spend-once value otherwise.
        hn[k] = Poseidon(4);
        hn[k].inputs[0] <== commitment;
        hn[k].inputs[1] <== payee_field[k];
        hn[k].inputs[2] <== amount[k];
        hn[k].inputs[3] <== spend_counter[k];
        nullifier[k] <== active[k] * hn[k].out;
    }
}

component main {public [payee_field, amount]} = PolicyBatch(16, 4);
