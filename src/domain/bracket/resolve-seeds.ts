import { shuffle } from '../shared/shuffle';
import type { DrawReg, SeedMap } from './types';

/**
 * Resolves seed assignments for all registrations before a draw.
 *
 * Mode selection:
 * - If ANY registration carries an explicit seed, we are in "seeded mode":
 *   validate those seeds, then randomly assign free seeds to unseeded entries.
 * - If NO registrations carry seeds, every slot is randomly assigned.
 *
 * Validation (seeded mode):
 * - All explicit seeds must be in range [1, N].
 * - No two registrations may share the same seed.
 * Violations throw Error('INVALID_SEED').
 *
 * Returns a Map<seed, DrawReg> where every entry from 1..N is covered.
 */
export function resolveSeeds(
  regs: DrawReg[],
  rng: () => number = Math.random,
): SeedMap {
  const N = regs.length;
  const seeded = regs.filter((r) => r.seed !== null && r.seed !== undefined);
  const unseeded = regs.filter((r) => r.seed === null || r.seed === undefined);

  if (seeded.length > 0) {
    // Validate: each seed in [1,N] and no duplicates
    const seen = new Set<number>();
    for (const r of seeded) {
      const s = r.seed as number;
      if (s < 1 || s > N || !Number.isInteger(s)) {
        throw new Error('INVALID_SEED');
      }
      if (seen.has(s)) {
        throw new Error('INVALID_SEED');
      }
      seen.add(s);
    }
  }

  // Compute free seed slots not claimed by seeded entries
  const usedSeeds = new Set(seeded.map((r) => r.seed as number));
  const freeSeeds: number[] = [];
  for (let i = 1; i <= N; i++) {
    if (!usedSeeds.has(i)) freeSeeds.push(i);
  }

  // Shuffle free seeds and assign to unseeded registrations in order
  const shuffledFree = shuffle(freeSeeds, rng);
  const seedMap: SeedMap = new Map();

  for (const r of seeded) {
    seedMap.set(r.seed as number, r);
  }
  for (let i = 0; i < unseeded.length; i++) {
    const assignedSeed = shuffledFree[i] as number;
    // Attach the resolved seed to the DrawReg so fill-draw can look it up
    const reg: DrawReg = { ...unseeded[i]!, seed: assignedSeed };
    seedMap.set(assignedSeed, reg);
  }

  return seedMap;
}
