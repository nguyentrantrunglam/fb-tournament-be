import { buildSingleElimSkeleton } from './build-single-elim-skeleton';
import { buildRoundRobinSkeleton } from './build-round-robin-skeleton';
import { buildGroupKoSkeleton } from './build-group-ko-skeleton';
import type { BracketFormat, SkeletonConfig, SkeletonPlan } from './types';

/**
 * Dispatches skeleton construction to the appropriate format builder.
 * Throws Error('NOT_ENOUGH_PARTICIPANTS') when N < 2 regardless of format.
 */
export function buildSkeleton(
  categoryId: string,
  N: number,
  format: BracketFormat,
  config?: SkeletonConfig,
): SkeletonPlan {
  if (N < 2) {
    throw new Error('NOT_ENOUGH_PARTICIPANTS');
  }

  switch (format) {
    case 'single_elim':
      return buildSingleElimSkeleton(categoryId, N);
    case 'round_robin':
      return buildRoundRobinSkeleton(categoryId, N);
    case 'group_ko':
      return buildGroupKoSkeleton(categoryId, N, config ?? {});
  }
}
