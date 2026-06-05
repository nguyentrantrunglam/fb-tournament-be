import { nextPowerOf2 } from '../shared/next-power-of-2';
import { groupMatchId, matchId } from '../shared/match-id';
import { buildCrossoverSeedOrder } from './build-crossover-seed-order';
import type { MatchPlan, SkeletonPlan, SkeletonConfig } from './types';

/**
 * Builds a group-stage + knockout bracket skeleton.
 *
 * Structure:
 * 1. N participants are distributed into groupCount groups (ceil/floor split).
 *    Groups are labeled 'A', 'B', 'C', ...
 * 2. Within each group: all C(groupSize, 2) round-robin matches, sides null.
 * 3. KO tree: groupCount * qualifyPerGroup qualifier slots → padded to next
 *    power-of-2 → standard crossover KO match tree. KO match sides are
 *    placeholder labels ("Top1-A", "Top2-B", etc.) — KO slots stay as
 *    placeholders until group-stage results are known and real teams can
 *    be assigned. Bye slots in the KO tree also get placeholder labels.
 *
 * Qualifier cross-seeding convention (keeps top seeds separated):
 * - All qualifiers sorted as: 1st-A, 1st-B, 1st-C, ..., 2nd-A, 2nd-B, ...
 * - Numbered 1..qualifiers in that order, then placed via crossover seed order.
 * - This ensures group winners are spread across the KO bracket halves.
 */
export function buildGroupKoSkeleton(
  categoryId: string,
  N: number,
  config: SkeletonConfig,
): SkeletonPlan {
  const { groupCount = 2, qualifyPerGroup = 1 } = config;

  if (
    groupCount < 2 ||
    qualifyPerGroup < 1 ||
    groupCount * qualifyPerGroup > N
  ) {
    throw new Error('INVALID_GROUP_CONFIG');
  }

  // Distribute N into groupCount groups: first (N % groupCount) groups get
  // one extra participant (ceil), remaining groups get floor(N/groupCount).
  const base = Math.floor(N / groupCount);
  const remainder = N % groupCount;
  const groupSizes: number[] = Array.from({ length: groupCount }, (_, i) =>
    i < remainder ? base + 1 : base,
  );

  const groupKeys = Array.from({ length: groupCount }, (_, i) =>
    String.fromCharCode(65 + i),
  ); // 'A', 'B', 'C', ...

  const matches: MatchPlan[] = [];

  // --- Group-stage round-robin matches ---
  for (let g = 0; g < groupCount; g++) {
    const gKey = groupKeys[g] as string;
    const gSize = groupSizes[g] as number;
    let matchIndex = 0;
    for (let i = 0; i < gSize; i++) {
      for (let j = i + 1; j < gSize; j++) {
        matches.push({
          id: groupMatchId(categoryId, gKey, matchIndex),
          groupKey: gKey,
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
  }

  // --- KO tree ---
  const qualifiers = groupCount * qualifyPerGroup;
  const koSize = nextPowerOf2(qualifiers);
  const koByes = koSize - qualifiers;
  const koRounds = Math.log2(koSize);

  // Build qualifier label array in cross-seeded order:
  // rank 1 from each group first, then rank 2, etc.
  // e.g. qualifyPerGroup=2, groups A-D → [1A,1B,1C,1D, 2A,2B,2C,2D]
  const qualifierLabels: string[] = [];
  for (let rank = 1; rank <= qualifyPerGroup; rank++) {
    for (let g = 0; g < groupCount; g++) {
      qualifierLabels.push(`Top${rank}-${groupKeys[g]}`);
    }
  }

  // seedOrder for the KO bracket (length === koSize)
  const koSeedOrder = buildCrossoverSeedOrder(koRounds);

  // Prefix to distinguish KO matches from group matches in the same category
  const koPrefix = `${categoryId}-KO`;

  // R1 of KO
  const koR1Count = koSize / 2;
  for (let i = 0; i < koR1Count; i++) {
    const seedA = koSeedOrder[2 * i] as number;
    const seedB = koSeedOrder[2 * i + 1] as number;
    const isBye = seedA > qualifiers || seedB > qualifiers;

    // Placeholder label: "Top1-A" for qualifier slot, "BYE" for padding slot
    const labelA =
      seedA <= qualifiers ? (qualifierLabels[seedA - 1] ?? 'BYE') : 'BYE';
    const labelB =
      seedB <= qualifiers ? (qualifierLabels[seedB - 1] ?? 'BYE') : 'BYE';

    let winnerSide: 'A' | 'B' | null = null;
    if (isBye) {
      winnerSide = seedA <= qualifiers ? 'A' : 'B';
    }

    const nextMid =
      koRounds > 1
        ? `${koPrefix}-R${2}-${Math.floor(i / 2)}`
        : null;

    matches.push({
      id: `${koPrefix}-R${1}-${i}`,
      round: 1,
      slotIndex: i,
      isBye,
      status: isBye ? 'completed' : 'pending',
      nextMatchId: nextMid,
      winnerSide,
      // Placeholder sides — registrationId stays null until group play finishes
      sideA: { seed: null, registrationId: null, name: labelA, score: null },
      sideB: { seed: null, registrationId: null, name: labelB, score: null },
    });
  }

  // Rounds 2..koRounds
  for (let r = 2; r <= koRounds; r++) {
    const matchCount = koSize / Math.pow(2, r);
    for (let i = 0; i < matchCount; i++) {
      const nextMid =
        r < koRounds ? `${koPrefix}-R${r + 1}-${Math.floor(i / 2)}` : null;

      matches.push({
        id: `${koPrefix}-R${r}-${i}`,
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
    format: 'group_ko',
    bracketSize: koSize,
    rounds: koRounds,
    byes: koByes,
    groupCount,
    qualifyPerGroup,
    matches,
  };
}
