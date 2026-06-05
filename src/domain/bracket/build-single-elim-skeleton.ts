import { nextPowerOf2 } from '../shared/next-power-of-2';
import { matchId } from '../shared/match-id';
import { buildCrossoverSeedOrder } from './build-crossover-seed-order';
import type { MatchPlan, SkeletonPlan } from './types';

/**
 * Builds the STRUCTURE-ONLY single-elimination bracket for N participants.
 * Sides are all null — no team assignment happens here.
 *
 * The skeleton encodes:
 * - bracketSize (next power of 2 >= N)
 * - bye slot positions (R1 matches where crossover seed > N)
 * - nextMatchId links for winner advancement
 * - winnerSide for bye matches (structurally determined from seed position)
 *
 * fillDraw() reads this skeleton and places real teams into the slots.
 */
export function buildSingleElimSkeleton(
  categoryId: string,
  N: number,
): SkeletonPlan {
  const bracketSize = nextPowerOf2(N);
  const rounds = Math.log2(bracketSize);
  const byes = bracketSize - N;

  // Crossover seed order: slot i gets seed seedOrder[i]
  const seedOrder = buildCrossoverSeedOrder(rounds);

  const matches: MatchPlan[] = [];

  // Round 1: bracketSize/2 matches, paired slots (2i, 2i+1)
  const r1Count = bracketSize / 2;
  for (let i = 0; i < r1Count; i++) {
    // seedOrder is exactly bracketSize long; 2*i and 2*i+1 are always in range
    const seedA = seedOrder[2 * i] as number;
    const seedB = seedOrder[2 * i + 1] as number;
    const isBye = seedA > N || seedB > N;

    // Structural winner side: whichever seed is within range wins the bye
    let winnerSide: 'A' | 'B' | null = null;
    if (isBye) {
      winnerSide = seedA <= N ? 'A' : 'B';
    }

    const nextMatchId =
      rounds > 1 ? matchId(categoryId, 2, Math.floor(i / 2)) : null;

    matches.push({
      id: matchId(categoryId, 1, i),
      round: 1,
      slotIndex: i,
      isBye,
      status: isBye ? 'completed' : 'pending',
      nextMatchId,
      winnerSide,
      sideA: null,
      sideB: null,
    });
  }

  // Rounds 2..rounds: winner-advancement matches (empty, no byes)
  for (let r = 2; r <= rounds; r++) {
    const matchCount = bracketSize / Math.pow(2, r);
    for (let i = 0; i < matchCount; i++) {
      const nextMid =
        r < rounds ? matchId(categoryId, r + 1, Math.floor(i / 2)) : null;

      matches.push({
        id: matchId(categoryId, r, i),
        round: r,
        slotIndex: i,
        isBye: false,
        status: 'pending',
        nextMatchId: nextMid,
        winnerSide: null,
        sideA: null,
        sideB: null,
      });
    }
  }

  return {
    categoryId,
    format: 'single_elim',
    bracketSize,
    rounds,
    byes,
    matches,
  };
}
