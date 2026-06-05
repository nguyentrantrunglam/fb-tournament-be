import { buildSingleElimSkeleton } from './build-single-elim-skeleton';

const CAT = 'MS';

describe('buildSingleElimSkeleton', () => {
  describe('T1: N=2 — minimum bracket', () => {
    const plan = buildSingleElimSkeleton(CAT, 2);

    it('bracketSize=2, rounds=1, byes=0', () => {
      expect(plan.bracketSize).toBe(2);
      expect(plan.rounds).toBe(1);
      expect(plan.byes).toBe(0);
    });

    it('has exactly 1 match', () => {
      expect(plan.matches).toHaveLength(1);
    });

    it('match has no nextMatchId (final)', () => {
      expect(plan.matches[0]!.nextMatchId).toBeNull();
    });

    it('match is not a bye', () => {
      expect(plan.matches[0]!.isBye).toBe(false);
    });

    it('match sides are null (skeleton)', () => {
      expect(plan.matches[0]!.sideA).toBeNull();
      expect(plan.matches[0]!.sideB).toBeNull();
    });
  });

  describe('T2: N=3 — one bye', () => {
    const plan = buildSingleElimSkeleton(CAT, 3);

    it('bracketSize=4, rounds=2, byes=1', () => {
      expect(plan.bracketSize).toBe(4);
      expect(plan.rounds).toBe(2);
      expect(plan.byes).toBe(1);
    });

    it('has 3 matches total (2 R1 + 1 final)', () => {
      expect(plan.matches).toHaveLength(3);
    });

    it('exactly 1 R1 match is a bye', () => {
      const r1 = plan.matches.filter((m) => m.round === 1);
      expect(r1).toHaveLength(2);
      expect(r1.filter((m) => m.isBye)).toHaveLength(1);
    });

    it('R2 match is not a bye', () => {
      const r2 = plan.matches.filter((m) => m.round === 2);
      expect(r2).toHaveLength(1);
      expect(r2[0]!.isBye).toBe(false);
    });

    it('bye match winnerSide is set structurally', () => {
      const byeMatch = plan.matches.find((m) => m.isBye)!;
      expect(byeMatch.winnerSide).not.toBeNull();
    });
  });

  describe('T3: N=4', () => {
    const plan = buildSingleElimSkeleton(CAT, 4);

    it('bracketSize=4, rounds=2, byes=0', () => {
      expect(plan.bracketSize).toBe(4);
      expect(plan.rounds).toBe(2);
      expect(plan.byes).toBe(0);
    });

    it('has 3 matches (2 R1 + 1 final)', () => {
      expect(plan.matches).toHaveLength(3);
    });

    it('no bye matches', () => {
      expect(plan.matches.filter((m) => m.isBye)).toHaveLength(0);
    });
  });

  describe('T4: N=8', () => {
    const plan = buildSingleElimSkeleton(CAT, 8);

    it('bracketSize=8, rounds=3, byes=0', () => {
      expect(plan.bracketSize).toBe(8);
      expect(plan.rounds).toBe(3);
      expect(plan.byes).toBe(0);
    });

    it('has 7 matches total', () => {
      expect(plan.matches).toHaveLength(7);
    });

    it('R1=4, R2=2, R3=1 matches', () => {
      expect(plan.matches.filter((m) => m.round === 1)).toHaveLength(4);
      expect(plan.matches.filter((m) => m.round === 2)).toHaveLength(2);
      expect(plan.matches.filter((m) => m.round === 3)).toHaveLength(1);
    });

    it('no byes', () => {
      expect(plan.matches.filter((m) => m.isBye)).toHaveLength(0);
    });
  });

  describe('T6: N=16', () => {
    const plan = buildSingleElimSkeleton(CAT, 16);

    it('bracketSize=16, rounds=4, byes=0', () => {
      expect(plan.bracketSize).toBe(16);
      expect(plan.rounds).toBe(4);
      expect(plan.byes).toBe(0);
    });

    it('has 15 matches', () => {
      expect(plan.matches).toHaveLength(15);
    });
  });

  describe('T11: N=64', () => {
    const plan = buildSingleElimSkeleton(CAT, 64);

    it('bracketSize=64, rounds=6, byes=0', () => {
      expect(plan.bracketSize).toBe(64);
      expect(plan.rounds).toBe(6);
      expect(plan.byes).toBe(0);
    });

    it('has 63 matches', () => {
      expect(plan.matches).toHaveLength(63);
    });
  });

  describe('T12: N=128', () => {
    const plan = buildSingleElimSkeleton(CAT, 128);

    it('bracketSize=128, rounds=7, byes=0', () => {
      expect(plan.bracketSize).toBe(128);
      expect(plan.rounds).toBe(7);
      expect(plan.byes).toBe(0);
    });

    it('has 127 matches', () => {
      expect(plan.matches).toHaveLength(127);
    });
  });

  describe('nextMatchId links', () => {
    it('R1 match i links to R2 floor(i/2)', () => {
      const plan = buildSingleElimSkeleton(CAT, 8);
      const r1 = plan.matches.filter((m) => m.round === 1);
      for (const m of r1) {
        const expectedNext = `${CAT}-R2-${Math.floor(m.slotIndex! / 2)}`;
        expect(m.nextMatchId).toBe(expectedNext);
      }
    });

    it('final match has no nextMatchId', () => {
      const plan = buildSingleElimSkeleton(CAT, 8);
      const final = plan.matches.find((m) => m.round === 3)!;
      expect(final.nextMatchId).toBeNull();
    });
  });

  describe('bye slot positions for N=6', () => {
    // seedOrder for rounds=3: [1,8,4,5,2,7,3,6]
    // R1 match0: slots(0,1) seeds(1,8) → 8>6 → bye, winnerSide='A'
    // R1 match1: slots(2,3) seeds(4,5) → both <=6 → normal
    // R1 match2: slots(4,5) seeds(2,7) → 7>6 → bye, winnerSide='A'
    // R1 match3: slots(6,7) seeds(3,6) → both <=6 → normal
    const plan = buildSingleElimSkeleton(CAT, 6);

    it('bracketSize=8, byes=2', () => {
      expect(plan.bracketSize).toBe(8);
      expect(plan.byes).toBe(2);
    });

    it('R1 match0 (seeds 1 vs 8) is a bye with winnerSide=A', () => {
      const m = plan.matches.find((m) => m.round === 1 && m.slotIndex === 0)!;
      expect(m.isBye).toBe(true);
      expect(m.winnerSide).toBe('A');
    });

    it('R1 match1 (seeds 4 vs 5) is NOT a bye', () => {
      const m = plan.matches.find((m) => m.round === 1 && m.slotIndex === 1)!;
      expect(m.isBye).toBe(false);
    });

    it('R1 match2 (seeds 2 vs 7) is a bye with winnerSide=A', () => {
      const m = plan.matches.find((m) => m.round === 1 && m.slotIndex === 2)!;
      expect(m.isBye).toBe(true);
      expect(m.winnerSide).toBe('A');
    });

    it('R1 match3 (seeds 3 vs 6) is NOT a bye', () => {
      const m = plan.matches.find((m) => m.round === 1 && m.slotIndex === 3)!;
      expect(m.isBye).toBe(false);
    });
  });

  describe('match IDs', () => {
    it('IDs follow {cat}-R{round}-{slotIndex} pattern', () => {
      const plan = buildSingleElimSkeleton(CAT, 4);
      expect(plan.matches.find((m) => m.id === 'MS-R1-0')).toBeDefined();
      expect(plan.matches.find((m) => m.id === 'MS-R1-1')).toBeDefined();
      expect(plan.matches.find((m) => m.id === 'MS-R2-0')).toBeDefined();
    });
  });
});
