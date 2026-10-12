/**
 * A Poseidon hash oracle over BLS12-381, backed by the circuit's OWN compiled
 * poseidon2/3/4 wasm. The spend-policy circuit hashes with circomlib Poseidon
 * over BLS12-381; a pure-JS Poseidon (e.g. circomlibjs, which is BN254) would
 * silently mismatch and make proofs fail. So we hash the JS side with the same
 * wasm the circuit uses: snarkjs computes the tiny poseidon circuit's witness and
 * the hash is its single output signal (index 1, after the constant 1).
 *
 * Node-capable today (the SDK/MCP prove server-side); the artifact args are wasm
 * file paths or URLs. Browser proving fetches the same wasm from the hosted
 * bundle. Node builtins are loaded lazily so importing this module stays safe in
 * a browser bundle.
 */
export interface PoseidonArtifacts {
  /** poseidon2.wasm (2 inputs), poseidon3.wasm (3), poseidon4.wasm (4). */
  p2: string;
  p3: string;
  p4: string;
}

export interface Poseidon {
  p2(a: bigint, b: bigint): Promise<bigint>;
  p3(a: bigint, b: bigint, c: bigint): Promise<bigint>;
  p4(a: bigint, b: bigint, c: bigint, d: bigint): Promise<bigint>;
}

/** Build a Poseidon oracle from the three compiled poseidon wasm (paths/URLs). */
export async function makePoseidon(art: PoseidonArtifacts): Promise<Poseidon> {
  const snarkjs = await import('snarkjs');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-poseidon-'));
  let seq = 0;

  async function hash(wasm: string, inputs: bigint[]): Promise<bigint> {
    const names = ['a', 'b', 'c', 'd'];
    const input: Record<string, string> = {};
    inputs.forEach((v, i) => (input[names[i]] = v.toString()));
    const wtns = path.join(dir, `w${seq++}.wtns`);
    await snarkjs.wtns.calculate(input, wasm, wtns);
    const arr = (await snarkjs.wtns.exportJson(wtns)) as Array<string | bigint>;
    return BigInt(arr[1]);
  }

  return {
    p2: (a, b) => hash(art.p2, [a, b]),
    p3: (a, b, c) => hash(art.p3, [a, b, c]),
    p4: (a, b, c, d) => hash(art.p4, [a, b, c, d]),
  };
}
