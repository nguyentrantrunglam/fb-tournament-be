import { buildSkeleton } from './build-skeleton';
import { fillDraw } from './fill-draw';
import { resolveSeeds } from './resolve-seeds';
import type { DrawReg } from './types';

// Deterministic rng helpers
const rngZero = () => 0;       // Fisher-Yates always picks index 0 → reverses array
const rngOne = () => 0.9999;   // always picks last index → preserves order

function makeRegs(n: number, seeded = false): DrawReg[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `r${i + 1}`,
    seed: seeded ? i + 1 : null,
    name: `Player${i + 1}`,
  }));
}

// ──────────────────────────────────────────────────────────────────
// single_elim fill tests
// ──────────────────────────────────────────────────────────────────

describe('fillDraw — single_elim', () => {
  describe('T1: N=2, no seeds', () => {
    const skeleton = buildSkeleton('MS', 2, 'single_elim');
    const regs = makeRegs(2);
    const filled = fillDraw(skeleton, regs, rngZero);

    it('1 match, both sides filled', () => {
      expect(filled.matches).toHaveLength(1);
      expect(filled.matches[0]!.sideA).not.toBeNull();
      expect(filled.matches[0]!.sideB).not.toBeNull();
    });

    it('no byes', () => {
      expect(filled.matches.filter((m) => m.isBye)).toHaveLength(0);
    });
  });

  describe('T2: N=3 — top seed gets walkover advanced to final', () => {
    // bracketSize=4, seedOrder=[1,4,2,3]
    // R1-match0: slots(0,1) seeds(1,4) → seed4>3 → bye, seed1 real → winner=A
    // R1-match1: slots(2,3) seeds(2,3) → normal
    // Bye winner (seed1) auto-advances to R2-match0.sideA
    const regs: DrawReg[] = [
      { registrationId: 'A', seed: 1, name: 'TopSeed' },
      { registrationId: 'B', seed: 2, name: 'Player2' },
      { registrationId: 'C', seed: 3, name: 'Player3' },
    ];
    const skeleton = buildSkeleton('MS', 3, 'single_elim');
    const filled = fillDraw(skeleton, regs, rngZero);

    it('3 matches total', () => {
      expect(filled.matches).toHaveLength(3);
    });

    it('bye match sideA=TopSeed, sideB=null', () => {
      const byeMatch = filled.matches.find((m) => m.isBye)!;
      expect(byeMatch.sideA?.registrationId).toBe('A');
      expect(byeMatch.sideB).toBeNull();
    });

    it('TopSeed auto-advanced to final (R2) sideA', () => {
      const final = filled.matches.find((m) => m.round === 2)!;
      expect(final.sideA?.registrationId).toBe('A');
    });
  });

  describe('T4: N=8, fully seeded 1..8 — crossover pairing', () => {
    // seedOrder for rounds=3: [1,8,4,5,2,7,3,6]
    // R1 pairs by slot: (1v8), (4v5), (2v7), (3v6)
    const regs = makeRegs(8, true);
    const skeleton = buildSkeleton('MS', 8, 'single_elim');
    const filled = fillDraw(skeleton, regs, rngZero);

    it('7 matches', () => {
      expect(filled.matches).toHaveLength(7);
    });

    it('R1-match0: seed1 vs seed8', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-0')!;
      expect(m.sideA?.seed).toBe(1);
      expect(m.sideB?.seed).toBe(8);
    });

    it('R1-match1: seed4 vs seed5', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-1')!;
      expect(m.sideA?.seed).toBe(4);
      expect(m.sideB?.seed).toBe(5);
    });

    it('R1-match2: seed2 vs seed7', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-2')!;
      expect(m.sideA?.seed).toBe(2);
      expect(m.sideB?.seed).toBe(7);
    });

    it('R1-match3: seed3 vs seed6', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-3')!;
      expect(m.sideA?.seed).toBe(3);
      expect(m.sideB?.seed).toBe(6);
    });
  });

  describe('T5: N=6, partial seeds (A=1, B=2, C=3, rest unseeded)', () => {
    // bracketSize=8, seedOrder=[1,8,4,5,2,7,3,6]
    // slots: 0→seed1(A), 1→seed8(BYE), 2→seed4, 3→seed5, 4→seed2(B), 5→seed7(BYE), 6→seed3(C), 7→seed6
    // R1-match0 (slots 0,1): A vs BYE → bye, A advances to R2-match0.sideA
    // R1-match1 (slots 2,3): seed4 vs seed5 → normal
    // R1-match2 (slots 4,5): B vs BYE → bye, B advances to R2-match1.sideA (even slotIndex=2)
    // R1-match3 (slots 6,7): C vs seed6 → normal
    const regs: DrawReg[] = [
      { registrationId: 'A', seed: 1, name: 'PlayerA' },
      { registrationId: 'B', seed: 2, name: 'PlayerB' },
      { registrationId: 'C', seed: 3, name: 'PlayerC' },
      { registrationId: 'D', seed: null, name: 'PlayerD' },
      { registrationId: 'E', seed: null, name: 'PlayerE' },
      { registrationId: 'F', seed: null, name: 'PlayerF' },
    ];
    const skeleton = buildSkeleton('MS', 6, 'single_elim');
    // Use deterministic rng so free seeds [4,5,6] get assigned predictably
    const filled = fillDraw(skeleton, regs, rngZero);

    it('R1-match0 is a bye with A on sideA', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-0')!;
      expect(m.isBye).toBe(true);
      expect(m.sideA?.registrationId).toBe('A');
      expect(m.sideB).toBeNull();
    });

    it('R1-match2 is a bye with B on sideA', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R1-2')!;
      expect(m.isBye).toBe(true);
      expect(m.sideA?.registrationId).toBe('B');
      expect(m.sideB).toBeNull();
    });

    it('A auto-advanced to R2-match0 sideA', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R2-0')!;
      expect(m.sideA?.registrationId).toBe('A');
    });

    it('B auto-advanced to R2-match1 sideA', () => {
      const m = filled.matches.find((x) => x.id === 'MS-R2-1')!;
      expect(m.sideA?.registrationId).toBe('B');
    });
  });

  describe('T8: duplicate seed → INVALID_SEED', () => {
    it('throws when two regs share same seed', () => {
      const regs: DrawReg[] = [
        { registrationId: 'r1', seed: 1, name: 'A' },
        { registrationId: 'r2', seed: 1, name: 'B' }, // duplicate
        { registrationId: 'r3', seed: null, name: 'C' },
      ];
      const skeleton = buildSkeleton('MS', 3, 'single_elim');
      expect(() => fillDraw(skeleton, regs, rngZero)).toThrow('INVALID_SEED');
    });
  });

  describe('T9: seed out of range → INVALID_SEED', () => {
    it('throws when seed > N', () => {
      const regs: DrawReg[] = [
        { registrationId: 'r1', seed: 10, name: 'A' }, // seed=10 but N=6
        ...Array.from({ length: 5 }, (_, i) => ({
          registrationId: `r${i + 2}`,
          seed: null,
          name: `P${i}`,
        })),
      ];
      const skeleton = buildSkeleton('MS', 6, 'single_elim');
      expect(() => fillDraw(skeleton, regs, rngZero)).toThrow('INVALID_SEED');
    });
  });

  describe('T10a: random N=6 — all seeds 1..6 assigned', () => {
    const regs = makeRegs(6);
    const skeleton = buildSkeleton('MS', 6, 'single_elim');
    const filled = fillDraw(skeleton, regs); // real Math.random

    it('byes land on exactly 2 R1 matches', () => {
      const byeMatches = filled.matches.filter((m) => m.round === 1 && m.isBye);
      expect(byeMatches).toHaveLength(2);
    });

    it('all seeds 1..6 appear exactly once', () => {
      const r1 = filled.matches.filter((m) => m.round === 1);
      const seeds = r1.flatMap((m) => [m.sideA?.seed, m.sideB?.seed]).filter(Boolean);
      expect(seeds.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('T10b: re-fill determinism — same structure, rng does not affect match IDs', () => {
    const regs = makeRegs(6);
    const skeleton = buildSkeleton('MS', 6, 'single_elim');
    const filled1 = fillDraw(skeleton, regs, rngZero);
    const filled2 = fillDraw(skeleton, regs, rngOne);

    it('match IDs are identical across fills', () => {
      const ids1 = filled1.matches.map((m) => m.id);
      const ids2 = filled2.matches.map((m) => m.id);
      expect(ids1).toEqual(ids2);
    });

    it('isBye positions are identical across fills', () => {
      const byes1 = filled1.matches.map((m) => m.isBye);
      const byes2 = filled2.matches.map((m) => m.isBye);
      expect(byes1).toEqual(byes2);
    });

    it('original skeleton is not mutated', () => {
      // All skeleton R1 sides should remain null
      for (const m of skeleton.matches) {
        expect(m.sideA).toBeNull();
        expect(m.sideB).toBeNull();
      }
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// round_robin fill tests
// ──────────────────────────────────────────────────────────────────

describe('fillDraw — round_robin', () => {
  describe('N=4 — all C(4,2)=6 pairings filled', () => {
    const regs = makeRegs(4);
    const skeleton = buildSkeleton('MS', 4, 'round_robin');
    const filled = fillDraw(skeleton, regs, rngZero);

    it('6 matches', () => {
      expect(filled.matches).toHaveLength(6);
    });

    it('every match has both sides filled', () => {
      for (const m of filled.matches) {
        expect(m.sideA).not.toBeNull();
        expect(m.sideB).not.toBeNull();
      }
    });

    it('every unordered pair of registration IDs appears exactly once', () => {
      const pairs = filled.matches.map((m) =>
        [m.sideA!.registrationId, m.sideB!.registrationId].sort().join(':'),
      );
      const unique = new Set(pairs);
      // C(4,2) = 6 unique pairs
      expect(unique.size).toBe(6);
      expect(pairs).toHaveLength(6);
    });

    it('no match has the same player on both sides', () => {
      for (const m of filled.matches) {
        expect(m.sideA!.registrationId).not.toBe(m.sideB!.registrationId);
      }
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// group_ko fill tests
// ──────────────────────────────────────────────────────────────────

describe('fillDraw — group_ko', () => {
  describe('groupCount=4, qualifyPerGroup=2, N=16', () => {
    const regs = makeRegs(16, true);
    const skeleton = buildSkeleton('MS', 16, 'group_ko', {
      groupCount: 4,
      qualifyPerGroup: 2,
    });
    const filled = fillDraw(skeleton, regs, rngZero);

    it('group-stage matches have both sides filled', () => {
      const rrMatches = filled.matches.filter((m) => m.groupKey && !m.round);
      for (const m of rrMatches) {
        expect(m.sideA).not.toBeNull();
        expect(m.sideB).not.toBeNull();
        expect(m.sideA!.registrationId).not.toBeNull();
        expect(m.sideB!.registrationId).not.toBeNull();
      }
    });

    it('KO matches retain placeholder sides (registrationId=null)', () => {
      const koMatches = filled.matches.filter((m) => m.round !== undefined);
      for (const m of koMatches) {
        // KO R1 sides are placeholders — registrationId stays null
        if (m.round === 1) {
          expect(m.sideA?.registrationId).toBeNull();
          expect(m.sideB?.registrationId).toBeNull();
        }
      }
    });

    it('each group gets exactly 4 participants', () => {
      const groupKeys = ['A', 'B', 'C', 'D'];
      for (const gKey of groupKeys) {
        const groupMatches = filled.matches.filter(
          (m) => m.groupKey === gKey && !m.round,
        );
        // C(4,2) = 6 matches per group
        expect(groupMatches).toHaveLength(6);
      }
    });

    it('all 16 registrations appear in group matches', () => {
      const rrMatches = filled.matches.filter((m) => m.groupKey && !m.round);
      const regIds = new Set<string>();
      for (const m of rrMatches) {
        if (m.sideA?.registrationId) regIds.add(m.sideA.registrationId);
        if (m.sideB?.registrationId) regIds.add(m.sideB.registrationId);
      }
      expect(regIds.size).toBe(16);
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// resolveSeeds unit tests
// ──────────────────────────────────────────────────────────────────

describe('resolveSeeds', () => {
  it('assigns seeds 1..N when all unseeded', () => {
    const regs = makeRegs(4);
    const map = resolveSeeds(regs, rngZero);
    expect(map.size).toBe(4);
    const seeds = [...map.keys()].sort((a, b) => a - b);
    expect(seeds).toEqual([1, 2, 3, 4]);
  });

  it('preserves explicit seeds and fills the rest', () => {
    const regs: DrawReg[] = [
      { registrationId: 'A', seed: 1, name: 'TopSeed' },
      { registrationId: 'B', seed: null, name: 'Unknown' },
      { registrationId: 'C', seed: null, name: 'Unknown2' },
    ];
    const map = resolveSeeds(regs, rngZero);
    expect(map.get(1)!.registrationId).toBe('A');
    expect(map.size).toBe(3);
  });

  it('throws INVALID_SEED on duplicate seeds', () => {
    const regs: DrawReg[] = [
      { registrationId: 'r1', seed: 2, name: 'A' },
      { registrationId: 'r2', seed: 2, name: 'B' },
    ];
    expect(() => resolveSeeds(regs)).toThrow('INVALID_SEED');
  });

  it('throws INVALID_SEED when seed > N', () => {
    const regs: DrawReg[] = [
      { registrationId: 'r1', seed: 5, name: 'A' },
      { registrationId: 'r2', seed: null, name: 'B' },
    ];
    expect(() => resolveSeeds(regs)).toThrow('INVALID_SEED');
  });

  it('throws INVALID_SEED when seed < 1', () => {
    const regs: DrawReg[] = [
      { registrationId: 'r1', seed: 0, name: 'A' },
      { registrationId: 'r2', seed: null, name: 'B' },
    ];
    expect(() => resolveSeeds(regs)).toThrow('INVALID_SEED');
  });
});
