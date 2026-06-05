import { fillSingleElim, fillRoundRobin, fillGroupKo } from './fill-draw-helpers';
import type { DrawReg, MatchPlan, SkeletonPlan } from './types';

/**
 * Fills an existing SkeletonPlan with real team assignments.
 * Returns a new SkeletonPlan (deep-clones matches) — does not mutate input.
 * Safe to call multiple times on the same skeleton (idempotent re-draw).
 *
 * single_elim: resolves seeds → places via crossover order → fills R1 sides
 *   → auto-advances bye winners into R2.
 * round_robin: assigns seeds 1..N, fills both sides of every C(N,2) match
 *   in the same nested-loop order used by buildRoundRobinSkeleton.
 * group_ko: wrap-distributes seeded participants across groups, fills
 *   within-group RR match sides; KO match sides remain placeholder labels
 *   (real KO assignment happens after group play — out of scope here).
 */
export function fillDraw(
  skeleton: SkeletonPlan,
  regs: DrawReg[],
  rng: () => number = Math.random,
): SkeletonPlan {
  // Deep-clone matches so input skeleton is never mutated
  const matches: MatchPlan[] = skeleton.matches.map((m) => ({ ...m }));

  switch (skeleton.format) {
    case 'single_elim':
      return fillSingleElim(skeleton, matches, regs, rng);
    case 'round_robin':
      return fillRoundRobin(skeleton, matches, regs, rng);
    case 'group_ko':
      return fillGroupKo(skeleton, matches, regs, rng);
  }
}
