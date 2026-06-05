import { buildRoundRobinSkeleton } from './build-round-robin-skeleton';

const CAT = 'MS';

describe('buildRoundRobinSkeleton', () => {
  it('N=4 → 6 matches', () => {
    const plan = buildRoundRobinSkeleton(CAT, 4);
    expect(plan.matches).toHaveLength(6);
  });

  it('N=5 → 10 matches', () => {
    const plan = buildRoundRobinSkeleton(CAT, 5);
    expect(plan.matches).toHaveLength(10);
  });

  it('N=2 → 1 match', () => {
    const plan = buildRoundRobinSkeleton(CAT, 2);
    expect(plan.matches).toHaveLength(1);
  });

  it('bracketSize=null, rounds=null, byes=0', () => {
    const plan = buildRoundRobinSkeleton(CAT, 4);
    expect(plan.bracketSize).toBeNull();
    expect(plan.rounds).toBeNull();
    expect(plan.byes).toBe(0);
  });

  it('all matches have isBye=false, status=pending, nextMatchId=null', () => {
    const plan = buildRoundRobinSkeleton(CAT, 4);
    for (const m of plan.matches) {
      expect(m.isBye).toBe(false);
      expect(m.status).toBe('pending');
      expect(m.nextMatchId).toBeNull();
    }
  });

  it('all matches have null sides (skeleton)', () => {
    const plan = buildRoundRobinSkeleton(CAT, 4);
    for (const m of plan.matches) {
      expect(m.sideA).toBeNull();
      expect(m.sideB).toBeNull();
    }
  });

  it('match IDs use RR pattern with incrementing index', () => {
    const plan = buildRoundRobinSkeleton(CAT, 3);
    expect(plan.matches.map((m) => m.id)).toEqual([
      'MS-RR-0',
      'MS-RR-1',
      'MS-RR-2',
    ]);
  });

  it('matchIndex matches array position', () => {
    const plan = buildRoundRobinSkeleton(CAT, 4);
    plan.matches.forEach((m, idx) => {
      expect(m.matchIndex).toBe(idx);
    });
  });

  it('format is round_robin', () => {
    expect(buildRoundRobinSkeleton(CAT, 4).format).toBe('round_robin');
  });
});
