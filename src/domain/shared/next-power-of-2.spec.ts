import { nextPowerOf2 } from './next-power-of-2';

describe('nextPowerOf2', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [6, 8],
    [7, 8],
    [8, 8],
    [9, 16],
    [16, 16],
    [17, 32],
    [32, 32],
    [33, 64],
    [64, 64],
    [65, 128],
    [128, 128],
  ])('nextPowerOf2(%i) = %i', (input, expected) => {
    expect(nextPowerOf2(input)).toBe(expected);
  });
});
