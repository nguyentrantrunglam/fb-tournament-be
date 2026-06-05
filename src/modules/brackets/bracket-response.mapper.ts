import type { BracketDocument } from '../../schemas/bracket.schema';
import type { MatchDocument } from '../../schemas/match.schema';
import {
  buildKnockout,
  buildRoundRobinView,
  buildGroupKoView,
  roundKey,
  roundLabel,
  type KnockoutRound,
  type RoundRobinView,
  type GroupKoView,
} from './bracket-view-builders';

/**
 * Maps a persisted Bracket + its Match docs to the FE CategoryBracket shape.
 * Names are already denormalized on match sides — no User join at read time.
 * Format dispatch: single_elim → knockout, round_robin → roundRobin, group_ko → groupKo.
 */

// ---------------------------------------------------------------------------
// FE meta type (mirrors fb-tournament-fe/lib/types/bracket.ts BracketMeta)
// ---------------------------------------------------------------------------

type BracketMeta = {
  mode: string;
  bracketSize: number | null;
  byes: number;
  roundsLabel: string;
  activeVersion: string;
  isLive: boolean;
  versionsCount: number;
};

export type CategoryBracket = {
  id: string;
  categoryId: string;
  code: string;
  name: string;
  countLabel: string;
  format: string;
  status: 'skeleton' | 'drawn';
  drawVersion: number;
  meta: BracketMeta;
  knockout?: KnockoutRound[];
  roundRobin?: RoundRobinView;
  groupKo?: GroupKoView;
};

// ---------------------------------------------------------------------------
// Rounds label
// ---------------------------------------------------------------------------

function buildRoundsLabel(rounds: number | null): string {
  if (!rounds) return '';
  if (rounds === 1) return '1 · F';
  const firstKey = roundKey(1, rounds);
  return `${rounds} · ${firstKey} → F`;
}

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

export function mapBracketToResponse(
  bracket: BracketDocument,
  matches: MatchDocument[],
  category: { _id: { toHexString(): string }; code: string; name: string },
): CategoryBracket {
  const drawVersion = bracket.drawVersion;
  const format = bracket.format;

  const hasSeeds = matches.some((m) => m.sideA?.seed != null || m.sideB?.seed != null);
  const mode = hasSeeds ? 'Seeded · crossover' : 'Random';

  // Count unique participants from filled sides; fall back to bracketSize for skeleton
  const regIds = new Set<string>();
  for (const m of matches) {
    if (m.sideA?.registrationId) regIds.add(m.sideA.registrationId);
    if (m.sideB?.registrationId) regIds.add(m.sideB.registrationId);
  }
  const participantCount = regIds.size || (bracket.bracketSize ?? 0);

  const meta: BracketMeta = {
    mode,
    bracketSize: bracket.bracketSize,
    byes: bracket.byes,
    roundsLabel: buildRoundsLabel(bracket.rounds),
    activeVersion: `v${drawVersion}`,
    isLive: false,
    versionsCount: drawVersion,
  };

  const result: CategoryBracket = {
    id: bracket._id.toHexString(),
    categoryId: category._id.toHexString(),
    code: category.code,
    name: category.name,
    countLabel: `${participantCount}`,
    format,
    status: bracket.status,
    drawVersion,
    meta,
  };

  if (format === 'single_elim') {
    result.knockout = buildKnockout(matches, bracket.rounds ?? 1);
  } else if (format === 'round_robin') {
    result.roundRobin = buildRoundRobinView(matches);
  } else if (format === 'group_ko') {
    const qualifyPerGroup = bracket.formatConfig?.qualifyPerGroup ?? 1;
    const groupCount = bracket.formatConfig?.groupCount ?? 1;
    const totalQualifiers = groupCount * qualifyPerGroup;
    const koRounds = totalQualifiers > 1 ? Math.log2(totalQualifiers) : 1;
    result.groupKo = buildGroupKoView(matches, qualifyPerGroup, koRounds);
  }

  return result;
}
