// Minimal ambient declaration for the pieces of snarkjs the batch prover uses,
// so the SDK typechecks and builds without snarkjs installed at build time. It is
// a runtime dependency (see package.json) and is loaded via dynamic import.
declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicSignals: string[];
    }>;
  };
}
