import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CategoryFormat } from './category.schema';

/**
 * MatchSide subdocument — one participant's slot within a match.
 * All fields nullable: null = empty slot (skeleton state) or bye placeholder.
 * name and partnerName are denormalized at draw time from a user lookup.
 */
@Schema({ _id: false })
export class MatchSide {
  /** Draw seed assigned to this participant; null before draw or for placeholder slots. */
  @Prop({ type: Number, default: null })
  seed!: number | null;

  /** Ref to Registration._id; null for skeleton / bye / KO placeholder slots. */
  @Prop({ type: String, default: null })
  registrationId!: string | null;

  /** Denormalized display name, e.g. "Nguyen Van A" or "A / B" for doubles. */
  @Prop({ type: String, default: null })
  name!: string | null;

  /** Doubles partner display name; absent for singles categories. */
  @Prop({ type: String, default: null })
  partnerName!: string | null;

  /** Match score for this side; null until the match is completed. */
  @Prop({ type: Number, default: null })
  score!: number | null;
}

export const MatchSideSchema = SchemaFactory.createForClass(MatchSide);

/**
 * Match document — one scheduled encounter within a bracket.
 * Embedded MatchSide subdocs avoid separate collection lookups for display.
 *
 * Field semantics by format:
 *   single_elim / group_ko KO:  round + slotIndex present; matchIndex absent.
 *   round_robin / within-group: matchIndex present; round absent (for pure RR).
 *   group_ko group stage:       groupKey + matchIndex present; round absent.
 */
@Schema({
  collection: 'matches',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Match {
  _id!: Types.ObjectId;

  /** Ref to Bracket._id. */
  @Prop({ required: true })
  bracketId!: string;

  /** Ref to Category._id. */
  @Prop({ required: true })
  categoryId!: string;

  @Prop({
    required: true,
    enum: ['single_elim', 'round_robin', 'group_ko'],
  })
  format!: CategoryFormat;

  /** Elimination round number (1 = first round, final = highest round). */
  @Prop({ type: Number })
  round?: number;

  /** Zero-based match position within a round. */
  @Prop({ type: Number })
  slotIndex?: number;

  /** Group label for group_ko group stage ('A', 'B', ...). */
  @Prop({ type: String })
  groupKey?: string;

  /** Zero-based pairing index within a round-robin or group-stage. */
  @Prop({ type: Number })
  matchIndex?: number;

  /** True when one side is a bye — match is auto-completed at draw time. */
  @Prop({ required: true })
  isBye!: boolean;

  @Prop({
    required: true,
    enum: ['pending', 'completed'],
    default: 'pending',
  })
  status!: 'pending' | 'completed';

  /**
   * ID of the match the winner advances to; null for the final or
   * for round_robin matches (no advancement path).
   */
  @Prop({ type: String, default: null })
  nextMatchId!: string | null;

  /** Side that won; null until completed. */
  @Prop({ type: String, enum: ['A', 'B', null], default: null })
  winnerSide!: 'A' | 'B' | null;

  @Prop({ type: MatchSideSchema, default: null })
  sideA!: MatchSide | null;

  @Prop({ type: MatchSideSchema, default: null })
  sideB!: MatchSide | null;

  createdAt!: Date;
}

export type MatchDocument = HydratedDocument<Match>;
export const MatchSchema = SchemaFactory.createForClass(Match);

// Primary query: fetch all matches for a bracket (draw display, result entry).
MatchSchema.index({ bracketId: 1 });

// Secondary query: fetch matches for a category across all brackets (schedule view).
MatchSchema.index({ categoryId: 1 });
