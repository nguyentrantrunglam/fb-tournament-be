/**
 * Pure domain types for bracket planning and draw assignment.
 * No Mongoose or NestJS imports — portable across layers.
 */

export type BracketFormat = 'single_elim' | 'round_robin' | 'group_ko';

/** One participant's slot in a match — null fields mean slot is empty (skeleton state). */
export interface SidePlan {
  seed: number | null;
  registrationId: string | null;
  name: string | null;
  /** Doubles partner name, denormalized at draw time. */
  partnerName?: string | null;
  score: number | null;
}

/**
 * A single match plan within the bracket.
 * round/slotIndex apply to single_elim and group_ko KO rounds.
 * groupKey applies to group_ko group-stage and optionally round_robin.
 * matchIndex applies to round_robin pairings and within-group pairings.
 */
export interface MatchPlan {
  id: string;
  round?: number;
  slotIndex?: number;
  groupKey?: string;
  matchIndex?: number;
  isBye: boolean;
  status: 'pending' | 'completed';
  nextMatchId: string | null;
  winnerSide: 'A' | 'B' | null;
  sideA: SidePlan | null;
  sideB: SidePlan | null;
}

/** Full bracket plan produced by buildSkeleton / fillDraw. */
export interface SkeletonPlan {
  /** Category this skeleton was built for — used during draw to route match IDs. */
  categoryId: string;
  format: BracketFormat;
  /** null for round_robin */
  bracketSize: number | null;
  /** null for round_robin */
  rounds: number | null;
  byes: number;
  groupCount?: number;
  qualifyPerGroup?: number;
  matches: MatchPlan[];
}

/** Registration entry passed into draw resolution. seed=null means unseeded. */
export interface DrawReg {
  registrationId: string;
  seed: number | null;
  name: string;
  partnerName?: string | null;
}

/** Maps seed number → DrawReg after seed resolution. */
export type SeedMap = Map<number, DrawReg>;

/** Optional config for group_ko format. */
export interface SkeletonConfig {
  groupCount?: number;
  qualifyPerGroup?: number;
}
