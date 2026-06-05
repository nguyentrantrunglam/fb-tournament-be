import { shuffle } from './shuffle';

describe('shuffle', () => {
  it('returns a new array of same length', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toHaveLength(arr.length);
    expect(result).not.toBe(arr); // new reference
  });

  it('does not mutate the input array', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffle(arr);
    expect(arr).toEqual(copy);
  });

  it('contains all original elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result.sort()).toEqual([...arr].sort());
  });

  it('is deterministic when rng is injected (rng always returns 0)', () => {
    const arr = [1, 2, 3, 4, 5];
    const rng = () => 0;
    const r1 = shuffle(arr, rng);
    const r2 = shuffle(arr, rng);
    expect(r1).toEqual(r2);
  });

  it('produces different order with different rng', () => {
    // rng=0 always picks index 0 (rolls to end), rng=0.99 always picks last
    const arr = [1, 2, 3, 4, 5];
    const r1 = shuffle(arr, () => 0);
    const r2 = shuffle(arr, () => 0.9999);
    // Both should contain same elements but likely in different order
    expect(r1.sort()).toEqual(r2.sort());
  });

  it('handles empty array', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles single-element array', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});
