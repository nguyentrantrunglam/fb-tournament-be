/**
 * Format-specific view builders for bracket-response.mapper.ts.
 * Split out to keep mapper under 200 LOC.
 */
import type { MatchDocument } from '../../schemas/match.schema';

// ---------------------------------------------------------------------------
// Shared FE types (mirrors fb-tournament-fe/lib/types/bracket.ts)
// ---------------------------------------------------------------------------

export type MatchState = 'pending' | 'live' | 'completed' | 'bye';

export type FEMatchSide = {
  seed: number | null;
  name: string | null;
  placeholder: string | null;
  score: number | null;
  isWinner: boolean;
};

export type BracketMatch = {
  id: string;
  code: string;
  state: MatchState;
  liveCourt: string | null;
  sideA: FEMatchSide;
  sideB: FEMatchSide | null;
};

export type KnockoutRound = {
  key: string;
  label: string;
  countLabel: string;
  matches: BracketMatch[];
};

export type StandingRow = {
  rank: number;
  name: string;
  seed: number | null;
  played: number;
  won: number;
  lost: number;
  gameDiff: number;
  points: number;
  qualified: boolean;
};

export type RoundRobinView = {
  standings: StandingRow[];
  matches: BracketMatch[];
};

export type Group = {
  name: string;
  standings: StandingRow[];
};

export type GroupKoView = {
  qualifyPerGroup: number;
  groups: Group[];
  knockout: KnockoutRound[];
};

// ---------------------------------------------------------------------------
// Internal side type for MatchDocument sideA/sideB
// ---------------------------------------------------------------------------

type DocSide = {
  seed: number | null;
  registrationId: string | null;
  name: string | null;
  partnerName?: string | null;
  score: number | null;
} | null;

// ---------------------------------------------------------------------------
// Round key / label helpers
// ---------------------------------------------------------------------------

const ROUND_LABELS: Record<string, string> = {
  F: 'CHUNG KẾT',
  SF: 'BÁN KẾT',
  QF: 'TỨ KẾT',
};

export function roundKey(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round + 1;
  if (fromEnd === 1) return 'F';
  if (fromEnd === 2) return 'SF';
  if (fromEnd === 3) return 'QF';
  return `R${round}`;
}

export function roundLabel(key: string): string {
  return ROUND_LABELS[key] ?? key;
}

// ---------------------------------------------------------------------------
// Side mapper
// ---------------------------------------------------------------------------

/**
 * Derives a human-readable placeholder for a KO slot that has no team yet.
 * feederRoundKey: the round key of the match that feeds into this slot.
 * feederSlotIndex: the 0-based slot within that round.
 * Produces labels like "winner QF1", "winner SF2" consistent with FE mock style.
 */
export function koPlaceholderLabel(feederRoundKey: string, feederSlotIndex: number): string {
  return `winner ${feederRoundKey}${feederSlotIndex + 1}`;
}

export function mapDocSide(
  side: DocSide,
  winnerSide: 'A' | 'B' | null,
  thisSide: 'A' | 'B',
  matchCode: string,
  feederLabel: string | null,
): FEMatchSide {
  if (!side || !('registrationId' in side) || side.registrationId === null) {
    const placeholder = feederLabel ?? 'TBD';
    return { seed: null, name: null, placeholder, score: null, isWinner: false };
  }
  return {
    seed: side.seed,
    name: side.name,
    placeholder: null,
    score: side.score,
    isWinner: winnerSide === thisSide,
  };
}

function matchState(m: MatchDocument): MatchState {
  if (m.isBye) return 'bye';
  if (m.status === 'completed') return 'completed';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Knockout builder
// ---------------------------------------------------------------------------

export function buildKnockout(matches: MatchDocument[], totalRounds: number): KnockoutRound[] {
  const byRound = new Map<number, MatchDocument[]>();
  for (const m of matches) {
    if (m.round === undefined) continue;
    const arr = byRound.get(m.round) ?? [];
    arr.push(m);
    byRound.set(m.round, arr);
  }

  return [...byRound.keys()].sort((a, b) => a - b).map((r) => {
    const rMatches = (byRound.get(r) ?? []).sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    const key = roundKey(r, totalRounds);
    const bracketMatches: BracketMatch[] = rMatches.map((m) => {
      const slotIdx = m.slotIndex ?? 0;
      const code = `${key}·M${String(slotIdx + 1).padStart(2, '0')}`;

      // Derive feeder round labels for placeholder sides.
      // Each slot in round r was fed from round (r-1): sideA feeder = slot 2*i, sideB = 2*i+1.
      let feederLabelA: string | null = null;
      let feederLabelB: string | null = null;
      if (r > 1) {
        const feederRoundKey = roundKey(r - 1, totalRounds);
        feederLabelA = koPlaceholderLabel(feederRoundKey, 2 * slotIdx);
        feederLabelB = koPlaceholderLabel(feederRoundKey, 2 * slotIdx + 1);
      }

      return {
        id: m._id.toHexString(),
        code,
        state: matchState(m),
        liveCourt: null,
        sideA: mapDocSide(m.sideA as DocSide, m.winnerSide, 'A', code, feederLabelA),
        sideB: m.isBye
          ? null
          : mapDocSide(m.sideB as DocSide, m.winnerSide, 'B', code, feederLabelB),
      };
    });
    return { key, label: roundLabel(key), countLabel: `${rMatches.length}`, matches: bracketMatches };
  });
}

// ---------------------------------------------------------------------------
// Round-robin builder
// ---------------------------------------------------------------------------

export function buildRoundRobinView(matches: MatchDocument[]): RoundRobinView {
  const participants = new Map<string, { name: string; seed: number | null }>();
  for (const m of matches) {
    if (m.sideA?.registrationId)
      participants.set(m.sideA.registrationId, { name: m.sideA.name ?? 'Unknown', seed: m.sideA.seed });
    if (m.sideB?.registrationId)
      participants.set(m.sideB.registrationId, { name: m.sideB.name ?? 'Unknown', seed: m.sideB.seed });
  }
  // Sort by seed ascending (unseeded participants go last, sorted by name for stability).
  const sorted = [...participants.values()].sort((a, b) => {
    if (a.seed != null && b.seed != null) return a.seed - b.seed;
    if (a.seed != null) return -1;
    if (b.seed != null) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
  const standings: StandingRow[] = sorted.map((p, idx) => ({
    rank: idx + 1, name: p.name, seed: p.seed,
    played: 0, won: 0, lost: 0, gameDiff: 0, points: 0, qualified: false,
  }));
  const bracketMatches: BracketMatch[] = matches.map((m, i) => {
    const code = `M${String(i + 1).padStart(2, '0')}`;
    return {
      id: m._id.toHexString(), code, state: matchState(m), liveCourt: null,
      sideA: mapDocSide(m.sideA as DocSide, m.winnerSide, 'A', code, null),
      sideB: mapDocSide(m.sideB as DocSide, m.winnerSide, 'B', code, null),
    };
  });
  return { standings, matches: bracketMatches };
}

// ---------------------------------------------------------------------------
// Group-KO builder
// ---------------------------------------------------------------------------

export function buildGroupKoView(
  matches: MatchDocument[],
  qualifyPerGroup: number,
  totalKoRounds: number,
): GroupKoView {
  const groupMatches = matches.filter((m) => m.groupKey !== undefined && m.round === undefined);
  const koMatches = matches.filter((m) => m.round !== undefined);

  const byGroup = new Map<string, MatchDocument[]>();
  for (const m of groupMatches) {
    const k = m.groupKey!;
    const arr = byGroup.get(k) ?? [];
    arr.push(m);
    byGroup.set(k, arr);
  }

  const groups: Group[] = [...byGroup.keys()].sort().map((key) => {
    const gm = byGroup.get(key)!;
    const participants = new Map<string, { name: string; seed: number | null }>();
    for (const m of gm) {
      if (m.sideA?.registrationId)
        participants.set(m.sideA.registrationId, { name: m.sideA.name ?? 'Unknown', seed: m.sideA.seed });
      if (m.sideB?.registrationId)
        participants.set(m.sideB.registrationId, { name: m.sideB.name ?? 'Unknown', seed: m.sideB.seed });
    }
    // Sort by seed ascending; unseeded participants ranked after seeded ones.
    const sorted = [...participants.values()].sort((a, b) => {
      if (a.seed != null && b.seed != null) return a.seed - b.seed;
      if (a.seed != null) return -1;
      if (b.seed != null) return 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    const standings: StandingRow[] = sorted.map((p, idx) => ({
      rank: idx + 1, name: p.name, seed: p.seed,
      played: 0, won: 0, lost: 0, gameDiff: 0, points: 0,
      qualified: idx < qualifyPerGroup,
    }));
    return { name: `Bảng ${key}`, standings };
  });

  return { qualifyPerGroup, groups, knockout: buildKnockout(koMatches, totalKoRounds) };
}
