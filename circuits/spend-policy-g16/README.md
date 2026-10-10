# spend-policy-g16

The pp/2 spend-policy circuit: circom over **BLS12-381**, Groth16, so the proof is
verified by a real pairing on-chain (`contracts/policy-verifier` `verify_groth16`,
proven in the `zk-fixture` CI). Spec: [docs/private-policies-v2.md](../../docs/private-policies-v2.md).

This supersedes the pp/1 Noir circuit in `../spend-policy` (BN-254 / binding check),
which stays for the deployed testnet path.

## Public interface (`policy_single.circom`, increment g16-single)

- Public **outputs** (circuit-computed): `commitment`, `nullifier`.
- Public **inputs** (vault-supplied): `payee_field`, `amount`.

snarkjs orders public signals as outputs then inputs, so the public-signal vector
is `[commitment, nullifier, payee_field, amount]`. The on-chain verifier is
agnostic to the meaning of each signal (the pairing binds them positionally), and
the vault maps them by this order.

## Increments

1. **g16-single** (this file): R1 (per-payment ceiling); binds the full policy
   encoding into the commitment, so the commitment format is final. R3/R5 fields
   are hashed in but not yet constrained.
2. **g16-batch**: R3 (deep allowlist, depth 16) + R5 (per-payee limit) + batched
   releases.
3. **g16-extras**: R4 deny-list, R6 calendar windows, selective disclosure.

## How CI proves it

The `zk-fixture` workflow compiles this circuit with `--prime bls12381`, runs a
throwaway Groth16 setup, proves a satisfiable witness (`ci-input.json`), converts
the VK/proof/public signals to Soroban bytes (`scripts/zk/gen-fixture.mjs`), and
runs the Rust test (`contracts/policy-verifier/tests/groth16_fixture.rs`), which
asserts the on-chain verifier accepts the proof and rejects a tampered public
input. The setup here is for tests only; the production VK comes from an auditable
multi-contributor ceremony.

## Known caveats (pre-production)

- **Poseidon constants.** This increment compiles circomlib's Poseidon over the
  BLS12-381 field. The in-circuit hash and the witness generator are consistent by
  construction (both from the same compile), which is what the proof needs, but
  before the production trusted setup we pin BLS12-381-native Poseidon round
  constants.
