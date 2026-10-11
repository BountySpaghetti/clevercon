import { describe, it, expect } from 'vitest';
import {
  amountScalar,
  extractBatchOutputs,
  feScalar,
  g2ToSoroban,
  payeeField,
  proofToSoroban,
} from './policy-codec.js';
import {
  ALLOWLIST_DEPTH,
  BATCH_N,
  buildBatchWitness,
  type BatchContext,
  type BatchRelease,
  type PolicyWitness,
} from './batch-prover.js';

const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('policy-codec (SDK, mirrors @clevercon/common)', () => {
  it('payeeField masks the top 3 bits of SHA-256(ScVal XDR)', () => {
    expect(payeeField(PAYEE).toString('hex')).toBe(
      '1f8dde2a43b0e39285c73fa275da29bd739ac0a93049a60e98de0ac7f92faa2c',
    );
    expect(payeeField(PAYEE)[0] & 0xe0).toBe(0);
  });

  it('amountScalar and feScalar are 32-byte big-endian', () => {
    expect(amountScalar(1_500_000n).toString('hex').endsWith('16e360')).toBe(true);
    expect(feScalar(0n).toString('hex')).toBe('00'.repeat(32));
    expect(feScalar(1500n).toString('hex').endsWith('05dc')).toBe(true);
  });

  it('g2ToSoroban reverses each Fp2 to c1||c0 and is 192 bytes', () => {
    const g2 = g2ToSoroban([
      ['1', '2'],
      ['3', '4'],
      ['1', '0'],
    ]);
    expect(g2.length).toBe(192);
    expect(g2.subarray(47, 48).toString('hex')).toBe('02');
    expect(g2.subarray(95, 96).toString('hex')).toBe('01');
  });

  it('proofToSoroban yields 96/192/96 byte components', () => {
    const p = proofToSoroban({
      pi_a: ['1', '2', '1'],
      pi_b: [
        ['1', '2'],
        ['3', '4'],
        ['1', '0'],
      ],
      pi_c: ['5', '6', '1'],
    });
    expect(p.a.length).toBe(96);
    expect(p.b.length).toBe(192);
    expect(p.c.length).toBe(96);
  });

  it('extractBatchOutputs splits commitment and active nullifiers', () => {
    const signals = ['7', '11', '22', '0', '0', '99'];
    const { commitment, nullifiers, activeNullifiers } = extractBatchOutputs(signals, 4);
    expect(commitment.toString('hex').endsWith('07')).toBe(true);
    expect(nullifiers).toHaveLength(4);
    expect(activeNullifiers).toHaveLength(2);
  });
});

function samplePolicy(): PolicyWitness {
  return {
    enabled: [true, true, true, true, true, true, true, true],
    salt: '123',
    r1Ceiling: '100',
    r2Cap: '200',
    r2WindowSecs: '86400',
    r2Delegate: '0',
    r3Root: '555',
    r3Depth: '16',
    r4Entries: ['1', '2', '3', '4'],
    r4Threshold: '50',
    r6WindowsRoot: '777',
    r6Windows: [
      { start: '1000', end: '2000' },
      { start: '5000', end: '6000' },
    ],
    r7MaxCount: '10',
    r7WindowSecs: '86400',
    r8CatCeilings: ['1000', '0', '0', '0'],
    disclosureTag: '0',
  };
}

describe('buildBatchWitness', () => {
  const ctx: BatchContext = {
    validAfter: '1200',
    validBefore: '1800',
    runningSpend: '0',
    priorCount: '0',
  };

  it('pads to BATCH_N with null slots and shapes every array', () => {
    const releases: BatchRelease[] = [
      { payeeAddress: PAYEE, amountStroops: '60', spendCounter: '0' },
      { payeeAddress: PAYEE, amountStroops: '30', spendCounter: '1' },
    ];
    const w = buildBatchWitness(samplePolicy(), releases, ctx) as Record<string, unknown>;

    expect((w.payee_field as string[]).length).toBe(BATCH_N);
    expect(w.active as string[]).toEqual(['1', '1', '0', '0']);
    expect(w.amount as string[]).toEqual(['60', '30', '0', '0']);
    // Active payee_field is the decimal of payeeField(addr); null slots are 0.
    expect((w.payee_field as string[])[0]).toBe(
      BigInt('0x' + payeeField(PAYEE).toString('hex')).toString(),
    );
    expect((w.payee_field as string[])[2]).toBe('0');
    // Each release carries a full-depth path.
    expect((w.r3_path as string[][]).length).toBe(BATCH_N);
    expect((w.r3_path as string[][])[0].length).toBe(ALLOWLIST_DEPTH);
    // Public context + flags are carried through.
    expect(w.valid_after).toBe('1200');
    expect(w.valid_before).toBe('1800');
    expect(w.en as string[]).toEqual(['1', '1', '1', '1', '1', '1', '1', '1']);
    expect(w.r6_win_start as string[]).toEqual(['1000', '5000']);
  });

  it('rejects an empty or oversized batch', () => {
    expect(() => buildBatchWitness(samplePolicy(), [], ctx)).toThrow();
    const five: BatchRelease[] = Array.from({ length: 5 }, (_, i) => ({
      payeeAddress: PAYEE,
      amountStroops: '1',
      spendCounter: String(i),
    }));
    expect(() => buildBatchWitness(samplePolicy(), five, ctx)).toThrow();
  });
});
