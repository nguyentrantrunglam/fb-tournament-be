/**
 * Builds the standard crossover seeding order for single-elimination brackets.
 *
 * The crossover pattern ensures that:
 * - Seeds 1 and 2 can only meet in the final
 * - Seeds 1-2 can only meet seeds 3-4 in the semis
 * - etc. (top seeds are kept on opposite sides of the draw)
 *
 * Algorithm: recursive interleaving where each seed s is paired with (n+1-s),
 * producing a bracket where every adjacent pair sums to bracketSize+1.
 */
export function buildCrossoverSeedOrder(rounds: number): number[] {
  if (rounds === 0) return [1];
  const prev = buildCrossoverSeedOrder(rounds - 1);
  const n = prev.length * 2 + 1;
  const result: number[] = [];
  for (const s of prev) {
    result.push(s);
    result.push(n - s);
  }
  return result;
}
