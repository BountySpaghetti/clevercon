//! Real on-chain Groth16 verification over BLS12-381, using Soroban's native
//! pairing host functions (soroban-sdk `crypto::bls12_381`). This is the
//! trustless replacement for the v1 host-accelerated binding check in
//! `verifier.rs`: the proof is checked cryptographically on-chain, not merely
//! bound to its public inputs by a hash transcript.
//!
//! Standard Groth16 identity, collapsed into a single multi-pairing check:
//!   e(A, B) * e(-alpha, beta) * e(-vk_x, gamma) * e(-C, delta) == 1,
//! where `vk_x = IC[0] + Σ public_i * IC[i+1]`.
//!
//! Curve choice: BLS12-381 is the curve Soroban accelerates natively (host
//! functions since Protocol 22); a BN-254 pairing does not fit the
//! per-transaction instruction budget. The spend-policy circuit is therefore
//! targeted to Groth16/BLS12-381 (see docs/private-policies.md). Points are
//! uncompressed: G1 = 96 bytes, G2 = 192 bytes, scalars = 32 bytes big-endian.

use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, BytesN, Env, Vec,
};

/// `-1` in the BLS12-381 scalar field (`r - 1`), big-endian. Used to negate G1
/// points by scalar multiplication (the SDK exposes no direct point negation).
const NEG_ONE_BE: [u8; 32] = [
    0x73, 0xed, 0xa7, 0x53, 0x29, 0x9d, 0x7d, 0x48, 0x33, 0x39, 0xd8, 0x08, 0x09, 0xa1, 0xd8, 0x05,
    0x53, 0xbd, 0xa4, 0x02, 0xff, 0xfe, 0x5b, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
];

/// Verify a Groth16 proof against the given verifying key and public inputs.
///
/// `ic` MUST have length `public_inputs.len() + 1`. Returns `false` on any
/// length mismatch or a failing pairing; it does not panic on proof shape.
#[allow(clippy::too_many_arguments)]
pub fn verify_groth16(
    env: &Env,
    alpha_g1: &BytesN<96>,
    beta_g2: &BytesN<192>,
    gamma_g2: &BytesN<192>,
    delta_g2: &BytesN<192>,
    ic: &Vec<BytesN<96>>,
    proof_a: &BytesN<96>,
    proof_b: &BytesN<192>,
    proof_c: &BytesN<96>,
    public_inputs: &Vec<BytesN<32>>,
) -> bool {
    if ic.len() != public_inputs.len() + 1 {
        return false;
    }
    let bls = env.crypto().bls12_381();

    // vk_x = IC[0] + Σ public_inputs[i] * IC[i+1]
    let mut vk_x = G1Affine::from_bytes(ic.get_unchecked(0));
    if !public_inputs.is_empty() {
        let mut pts: Vec<G1Affine> = vec![env];
        let mut scalars: Vec<Fr> = vec![env];
        for (i, pi) in public_inputs.iter().enumerate() {
            pts.push_back(G1Affine::from_bytes(ic.get_unchecked(i as u32 + 1)));
            scalars.push_back(Fr::from_bytes(pi));
        }
        let acc = bls.g1_msm(pts, scalars);
        vk_x = bls.g1_add(&vk_x, &acc);
    }

    // Negate alpha, vk_x, C so the identity collapses to a product == 1.
    let neg_one = Fr::from_bytes(BytesN::from_array(env, &NEG_ONE_BE));
    let neg_alpha = bls.g1_mul(&G1Affine::from_bytes(alpha_g1.clone()), &neg_one);
    let neg_vk_x = bls.g1_mul(&vk_x, &neg_one);
    let neg_c = bls.g1_mul(&G1Affine::from_bytes(proof_c.clone()), &neg_one);

    let g1s: Vec<G1Affine> = vec![
        env,
        G1Affine::from_bytes(proof_a.clone()),
        neg_alpha,
        neg_vk_x,
        neg_c,
    ];
    let g2s: Vec<G2Affine> = vec![
        env,
        G2Affine::from_bytes(proof_b.clone()),
        G2Affine::from_bytes(beta_g2.clone()),
        G2Affine::from_bytes(gamma_g2.clone()),
        G2Affine::from_bytes(delta_g2.clone()),
    ];
    bls.pairing_check(g1s, g2s)
}
