import { buildGroupKoSkeleton } from './build-group-ko-skeleton';

const CAT = 'MS';

describe('buildGroupKoSkeleton', () => {
  describe('canonical case: groupCount=4, qualifyPerGroup=2, N=16', () => {
    // 4 groups of 4 → C(4,2)=6 RR matches each = 24 RR total
    // 8 qualifiers → koSize=8 → 7 KO matches
    const plan = buildGroupKoSkeleton(CAT, 16, {
      groupCount: 4,
      qualifyPerGroup: 2,
    });

    it('total matches = 24 RR + 7 KO = 31', () => {
      expect(plan.matches).toHaveLength(31);
    });

    it('24 group-stage matches', () => {
      const rr = plan.matches.filter((m) => m.groupKey && !m.round);
      expect(rr).toHaveLength(24);
    });

    it('7 KO matches', () => {
      const ko = plan.matches.filter((m) => m.round !== undefined);
      expect(ko).toHaveLength(7);
    });

    it('bracketSize=8 (KO size), rounds=3, byes=0', () => {
      expect(plan.bracketSize).toBe(8);
      expect(plan.rounds).toBe(3);
      expect(plan.byes).toBe(0);
    });

    it('groupCount and qualifyPerGroup stored on plan', () => {
      expect(plan.groupCount).toBe(4);
      expect(plan.qualifyPerGroup).toBe(2);
    });

    it('format is group_ko', () => {
      expect(plan.format).toBe('group_ko');
    });

    it('all group matches have null sides', () => {
      const rr = plan.matches.filter((m) => m.groupKey && !m.round);
      for (const m of rr) {
        expect(m.sideA).toBeNull();
        expect(m.sideB).toBeNull();
      }
    });

    it('KO R1 matches have placeholder side names (not null)', () => {
      const koR1 = plan.matches.filter((m) => m.round === 1);
      expect(koR1).toHaveLength(4);
      for (const m of koR1) {
        // sideA and sideB are placeholders — name field is set, registrationId null
        expect(m.sideA?.registrationId).toBeNull();
        expect(m.sideB?.registrationId).toBeNull();
        expect(m.sideA?.name).toBeTruthy();
        expect(m.sideB?.name).toBeTruthy();
      }
    });
  });

  describe('odd distribution: groupCount=3, qualifyPerGroup=1, N=10', () => {
    // Groups: 4, 3, 3. Qualifiers=3 → koSize=4, koByes=1
    const plan = buildGroupKoSkeleton(CAT, 10, {
      groupCount: 3,
      qualifyPerGroup: 1,
    });

    it('byes=1 in KO (koSize=4, qualifiers=3)', () => {
      expect(plan.byes).toBe(1);
      expect(plan.bracketSize).toBe(4);
    });

    it('groups have sizes 4, 3, 3 → RR: 6+3+3=12 matches', () => {
      const rr = plan.matches.filter((m) => m.groupKey && !m.round);
      expect(rr).toHaveLength(12);
    });

    it('exactly 1 KO R1 match is a bye', () => {
      const koR1 = plan.matches.filter((m) => m.round === 1);
      expect(koR1.filter((m) => m.isBye)).toHaveLength(1);
    });
  });

  describe('config validation', () => {
    it('throws INVALID_GROUP_CONFIG when groupCount < 2', () => {
      expect(() =>
        buildGroupKoSkeleton(CAT, 8, { groupCount: 1, qualifyPerGroup: 1 }),
      ).toThrow('INVALID_GROUP_CONFIG');
    });

    it('throws INVALID_GROUP_CONFIG when qualifyPerGroup < 1', () => {
      expect(() =>
        buildGroupKoSkeleton(CAT, 8, { groupCount: 2, qualifyPerGroup: 0 }),
      ).toThrow('INVALID_GROUP_CONFIG');
    });

    it('throws INVALID_GROUP_CONFIG when groupCount*qualifyPerGroup > N', () => {
      expect(() =>
        buildGroupKoSkeleton(CAT, 4, { groupCount: 3, qualifyPerGroup: 2 }),
      ).toThrow('INVALID_GROUP_CONFIG');
    });
  });

  describe('group match IDs', () => {
    it('group A matches use GA pattern', () => {
      const plan = buildGroupKoSkeleton(CAT, 4, {
        groupCount: 2,
        qualifyPerGroup: 1,
      });
      const groupA = plan.matches.filter((m) => m.groupKey === 'A');
      expect(groupA[0]!.id).toMatch(/GA-M0$/);
    });
  });
});
