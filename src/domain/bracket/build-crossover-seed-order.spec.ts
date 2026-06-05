import { buildCrossoverSeedOrder } from './build-crossover-seed-order';

describe('buildCrossoverSeedOrder', () => {
  it('rounds=0 returns [1]', () => {
    expect(buildCrossoverSeedOrder(0)).toEqual([1]);
  });

  it('rounds=1 returns [1,2]', () => {
    expect(buildCrossoverSeedOrder(1)).toEqual([1, 2]);
  });

  it('rounds=2 returns [1,4,2,3]', () => {
    expect(buildCrossoverSeedOrder(2)).toEqual([1, 4, 2, 3]);
  });

  it('rounds=3 returns [1,8,4,5,2,7,3,6]', () => {
    expect(buildCrossoverSeedOrder(3)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('rounds=4 returns 16-element crossover order', () => {
    expect(buildCrossoverSeedOrder(4)).toEqual([
      1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11,
    ]);
  });

  it('output length equals 2^rounds', () => {
    for (let r = 0; r <= 4; r++) {
      expect(buildCrossoverSeedOrder(r)).toHaveLength(Math.pow(2, r));
    }
  });

  it('contains each seed exactly once for rounds=3', () => {
    const order = buildCrossoverSeedOrder(3);
    expect(order.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
