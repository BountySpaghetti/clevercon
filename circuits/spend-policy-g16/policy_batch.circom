pragma circom 2.1.0;

// pp/2 batch spend-policy circuit: one Groth16 proof authorizes up to N releases
// (a bounty payout, a payroll run) under the same private policy. Over BLS12-381,
// verified by a real pairing on-chain. See docs/private-policies-v2.md.
//
// Public outputs: commitment, nullifier[N].
// Public inputs:  payee_field[N], amount[N], now, running_spend, prior_count.
//                 (now / running_spend / prior_count are the vault's authenticated
//                  ledger time and accumulator state, bound by being public.)
//
// FINAL R1-R8 commitment encoding; all eight rules enforced:
//   R1 per-payment ceiling        (per release)
//   R2 rolling cap over a window  (batch: running_spend + batch_total <= cap)
//   R3 allowlist Merkle membership(per release)
//   R4 deny-list above threshold  (per release)
//   R5 per-payee cap              (per release, from the leaf)
//   R6 calendar window            (batch: now in some committed window)
//   R7 velocity (count cap)       (batch: prior_count + active <= max_count)
//   R8 per-category ceiling       (per release, category from the leaf)
// R5 cap and R8 category ride the allowlist leaf = H(payee, cap, category), so one
// membership proof binds who/limit/category privately. An `active` flag marks real
// releases; a null slot is a provable no-op whose nullifier is 0.
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

template PolicyBatch(DEPTH, N, C, W) {
    // ---- public inputs ----
    signal input payee_field[N];
    signal input amount[N];
    signal input now;             // vault-supplied ledger timestamp (R6)
    signal input running_spend;   // vault accumulator: spend in window (R2)
    signal input prior_count;     // vault accumulator: releases in window (R7)

    // ---- shared policy (private; the full R1-R8 commitment encoding) ----
    signal input en[8];
    signal input r1_ceiling;
    signal input r2_cap;
    signal input r2_window;
    signal input r2_delegate;
    signal input r3_root;
    signal input r3_depth;
    signal input r4_entries[4];
    signal input r4_threshold;
    signal input r6_windows_root;
    signal input r7_max_count;
    signal input r7_window;
    signal input r8_cat_ceiling[C];
    signal input disclosure_tag;
    signal input salt;

    // ---- R6 private witnesses: the calendar windows (bound to the root) ----
    signal input r6_win_start[W];
    signal input r6_win_end[W];

    // ---- per-release private witnesses ----
    signal input active[N];
    signal input spend_counter[N];
    signal input r3_path[N][DEPTH];
    signal input r3_index[N][DEPTH];
    signal input payee_cap[N];
    signal input payee_category[N];

    // ---- public outputs ----
    signal output commitment;
    signal output nullifier[N];

    var VERSION = 2;

    // Enabled flags boolean, at least one active; leaf-riding rules (R5, R8)
    // require R3 since their data lives in the proven leaf.
    var ensum = 0;
    for (var i = 0; i < 8; i++) {
        en[i] * (en[i] - 1) === 0;
        ensum += en[i];
    }
    component notEmpty = IsZero();
    notEmpty.in <== ensum;
    notEmpty.out === 0;
    en[4] * (1 - en[2]) === 0; // R5 => R3
    en[7] * (1 - en[2]) === 0; // R8 => R3

    // Range-bind the vault-supplied public values.
    component nowBits = Num2Bits(64);
    nowBits.in <== now;
    component rsBits = Num2Bits(128);
    rsBits.in <== running_spend;
    component pcBits = Num2Bits(64);
    pcBits.in <== prior_count;

    // Commitment over the full policy encoding (shared across the batch).
    component h1 = Poseidon(10);
    h1.inputs[0] <== en[0];
    h1.inputs[1] <== en[1];
    h1.inputs[2] <== en[2];
    h1.inputs[3] <== en[3];
    h1.inputs[4] <== en[4];
    h1.inputs[5] <== en[5];
    h1.inputs[6] <== en[6];
    h1.inputs[7] <== en[7];
    h1.inputs[8] <== r1_ceiling;
    h1.inputs[9] <== r2_cap;

    component h2 = Poseidon(9);
    h2.inputs[0] <== r2_window;
    h2.inputs[1] <== r2_delegate;
    h2.inputs[2] <== r3_root;
    h2.inputs[3] <== r3_depth;
    h2.inputs[4] <== r4_entries[0];
    h2.inputs[5] <== r4_entries[1];
    h2.inputs[6] <== r4_entries[2];
    h2.inputs[7] <== r4_entries[3];
    h2.inputs[8] <== r4_threshold;

    component h3 = Poseidon(9);
    h3.inputs[0] <== r6_windows_root;
    h3.inputs[1] <== r7_max_count;
    h3.inputs[2] <== r7_window;
    h3.inputs[3] <== r8_cat_ceiling[0];
    h3.inputs[4] <== r8_cat_ceiling[1];
    h3.inputs[5] <== r8_cat_ceiling[2];
    h3.inputs[6] <== r8_cat_ceiling[3];
    h3.inputs[7] <== disclosure_tag;
    h3.inputs[8] <== VERSION;

    component hc = Poseidon(4);
    hc.inputs[0] <== h1.out;
    hc.inputs[1] <== h2.out;
    hc.inputs[2] <== h3.out;
    hc.inputs[3] <== salt;
    commitment <== hc.out;

    // R6 (batch-level): bind the windows to the committed root, then require
    // `now` to fall inside at least one window.
    component winHash = Poseidon(2 * W);
    for (var w = 0; w < W; w++) {
        winHash.inputs[2 * w] <== r6_win_start[w];
        winHash.inputs[2 * w + 1] <== r6_win_end[w];
    }
    en[5] * (winHash.out - r6_windows_root) === 0;

    component geS[W];
    component leE[W];
    signal inWin[W];
    var inWinSum = 0;
    signal inWinAcc[W + 1];
    inWinAcc[0] <== 0;
    for (var w = 0; w < W; w++) {
        geS[w] = GreaterEqThan(64);
        geS[w].in[0] <== now;
        geS[w].in[1] <== r6_win_start[w];
        leE[w] = LessEqThan(64);
        leE[w].in[0] <== now;
        leE[w].in[1] <== r6_win_end[w];
        inWin[w] <== geS[w].out * leE[w].out;
        // OR accumulation: acc' = acc + inWin - acc*inWin (stays boolean).
        inWinAcc[w + 1] <== inWinAcc[w] + inWin[w] - inWinAcc[w] * inWin[w];
    }
    en[5] * (1 - inWinAcc[W]) === 0;

    // Per-release checks + batch accumulators.
    component amountBits[N];
    component leafH[N];
    component mt[N];
    component le1[N];
    component ge4[N];
    component deq[N][4];
    component le5[N];
    component catEq[N][C];
    component le8[N];
    component hn[N];
    signal g1[N];
    signal g3[N];
    signal g4a[N];
    signal g4[N];
    signal g5[N];
    signal g8[N];
    signal selParts[N][C];
    signal selCeil[N];
    signal catSum[N];
    signal batchAmt[N];
    var batchTotalExpr = 0;
    var activeCountExpr = 0;

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

        // R3: active AND enabled => membership. Leaf = H(payee, cap, category).
        leafH[k] = Poseidon(3);
        leafH[k].inputs[0] <== payee_field[k];
        leafH[k].inputs[1] <== payee_cap[k];
        leafH[k].inputs[2] <== payee_category[k];
        mt[k] = MerkleRoot(DEPTH);
        mt[k].leaf <== leafH[k].out;
        for (var j = 0; j < DEPTH; j++) {
            mt[k].pathElements[j] <== r3_path[k][j];
            mt[k].pathIndex[j] <== r3_index[k][j];
        }
        g3[k] <== active[k] * en[2];
        g3[k] * (mt[k].root - r3_root) === 0;

        // R4: active AND enabled AND amount >= threshold => payee not denied.
        ge4[k] = GreaterEqThan(128);
        ge4[k].in[0] <== amount[k];
        ge4[k].in[1] <== r4_threshold;
        g4a[k] <== active[k] * en[3];
        g4[k] <== g4a[k] * ge4[k].out;
        for (var m = 0; m < 4; m++) {
            deq[k][m] = IsEqual();
            deq[k][m].in[0] <== payee_field[k];
            deq[k][m].in[1] <== r4_entries[m];
            g4[k] * deq[k][m].out === 0;
        }

        // R5: active AND enabled => amount <= per-payee cap.
        le5[k] = LessEqThan(128);
        le5[k].in[0] <== amount[k];
        le5[k].in[1] <== payee_cap[k];
        g5[k] <== active[k] * en[4];
        g5[k] * (1 - le5[k].out) === 0;

        // R8: active AND enabled => amount <= ceiling for the payee's category.
        var sumParts = 0;
        var sumEq = 0;
        for (var c = 0; c < C; c++) {
            catEq[k][c] = IsEqual();
            catEq[k][c].in[0] <== payee_category[k];
            catEq[k][c].in[1] <== c;
            selParts[k][c] <== catEq[k][c].out * r8_cat_ceiling[c];
            sumParts += selParts[k][c];
            sumEq += catEq[k][c].out;
        }
        selCeil[k] <== sumParts;
        catSum[k] <== sumEq;
        g8[k] <== active[k] * en[7];
        g8[k] * (catSum[k] - 1) === 0;
        le8[k] = LessEqThan(128);
        le8[k].in[0] <== amount[k];
        le8[k].in[1] <== selCeil[k];
        g8[k] * (1 - le8[k].out) === 0;

        // Batch accumulators (null slots contribute 0).
        batchAmt[k] <== active[k] * amount[k];
        batchTotalExpr += batchAmt[k];
        activeCountExpr += active[k];

        // Nullifier: 0 for a null slot, a distinct spend-once value otherwise.
        hn[k] = Poseidon(4);
        hn[k].inputs[0] <== commitment;
        hn[k].inputs[1] <== payee_field[k];
        hn[k].inputs[2] <== amount[k];
        hn[k].inputs[3] <== spend_counter[k];
        nullifier[k] <== active[k] * hn[k].out;
    }

    signal batchTotal;
    batchTotal <== batchTotalExpr;
    signal activeCount;
    activeCount <== activeCountExpr;

    // R2 (batch-level): running_spend + batch_total <= cap.
    component le2 = LessEqThan(132);
    le2.in[0] <== running_spend + batchTotal;
    le2.in[1] <== r2_cap;
    en[1] * (1 - le2.out) === 0;

    // R7 (batch-level): prior_count + active_count <= max_count.
    component le7 = LessEqThan(70);
    le7.in[0] <== prior_count + activeCount;
    le7.in[1] <== r7_max_count;
    en[6] * (1 - le7.out) === 0;
}

component main {public [payee_field, amount, now, running_spend, prior_count]} =
    PolicyBatch(16, 4, 4, 2);
