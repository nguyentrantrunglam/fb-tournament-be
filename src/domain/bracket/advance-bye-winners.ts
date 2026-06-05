import type { MatchPlan, SidePlan } from './types';

/**
 * After R1 sides are filled, propagates bye winners into R2 slots.
 *
 * For each R1 bye match: the non-null side is the automatic winner.
 * That winner's SidePlan is copied into the next match's sideA (if origin
 * slotIndex is even) or sideB (if odd), matching the standard bracket
 * convention where pairs (0,1)→R2-slot-0, (2,3)→R2-slot-1, etc.
 *
 * matchMap is keyed by match id for O(1) lookup. Mutates matches in place
 * on the cloned match array provided by fillDraw — caller owns the clone.
 */
export function advanceByeWinners(
  r1Matches: MatchPlan[],
  matchMap: Map<string, MatchPlan>,
): void {
  for (const m of r1Matches) {
    if (!m.isBye || m.nextMatchId === null) continue;

    const nextMatch = matchMap.get(m.nextMatchId);
    if (!nextMatch) continue;

    // Determine which side advances
    const winner: SidePlan | null =
      m.winnerSide === 'A' ? m.sideA : m.sideB;
    if (!winner) continue;

    // Even slotIndex → this match feeds sideA of next; odd → sideB
    if ((m.slotIndex ?? 0) % 2 === 0) {
      nextMatch.sideA = winner;
    } else {
      nextMatch.sideB = winner;
    }
  }
}
