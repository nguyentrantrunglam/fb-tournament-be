import { rrMatchId } from '../shared/match-id';
import type { MatchPlan, SkeletonPlan } from './types';

/**
 * Builds a pure round-robin skeleton for N participants.
 * Generates all C(N,2) unique pairings as MatchPlan objects with empty sides.
 * Simple nested-loop (i<j) ordering — stable across re-builds for same N.
 * Standings are computed at read time from completed matches, not here.
 */
export function buildRoundRobinSkeleton(
  categoryId: string,
  N: number,
): SkeletonPlan {
  const matches: MatchPlan[] = [];
  let matchIndex = 0;

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      matches.push({
        id: rrMatchId(categoryId, matchIndex),
        matchIndex,
        isBye: false,
        status: 'pending',
        nextMatchId: null,
        winnerSide: null,
        sideA: null,
        sideB: null,
      });
      matchIndex++;
    }
  }

  return {
    categoryId,
    format: 'round_robin',
    bracketSize: null,
    rounds: null,
    byes: 0,
    matches,
  };
}
