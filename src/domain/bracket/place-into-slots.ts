import { buildCrossoverSeedOrder } from './build-crossover-seed-order';
import type { DrawReg, SeedMap } from './types';

/**
 * Maps each bracket slot (0..bracketSize-1) to either a DrawReg or 'BYE'.
 *
 * The crossover seed order is recomputed from bracketSize (deterministic),
 * so this function does not require storing seedOrder in the skeleton.
 * Slots whose crossover seed exceeds N (participant count) are bye slots.
 */
export function placeIntoSlots(
  bracketSize: number,
  N: number,
  seedMap: SeedMap,
): (DrawReg | 'BYE')[] {
  const rounds = Math.log2(bracketSize);
  const seedOrder = buildCrossoverSeedOrder(rounds);

  return seedOrder.map((seed) => {
    if (seed > N) return 'BYE';
    const reg = seedMap.get(seed);
    if (!reg) return 'BYE'; // defensive: should not happen after resolveSeeds
    return reg;
  });
}
