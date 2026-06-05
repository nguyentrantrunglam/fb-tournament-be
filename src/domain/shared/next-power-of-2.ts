/**
 * Returns the smallest power of 2 that is >= n.
 * Used to determine bracket sizes for elimination tournaments.
 * e.g. nextPowerOf2(3) = 4, nextPowerOf2(8) = 8, nextPowerOf2(9) = 16.
 */
export function nextPowerOf2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}
