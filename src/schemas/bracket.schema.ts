import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { CategoryFormat } from './category.schema';

/**
 * Embedded audit record for each draw operation.
 * Preserves a snapshot of seed assignments across re-draws.
 * registrationId → seed (or seed → registrationId) at the time of that draw.
 */
export interface DrawHistoryEntry {
  drawVersion: number;
  /** Maps registrationId → assigned seed for this draw. */
  seedSnapshot: Record<string, number>;
  mode: 'seeded' | 'random';
  drawnAt: Date;
  drawnByUserId: string;
}

/**
 * Bracket document — one draw/bracket per category.
 * status='skeleton' after buildSkeleton; 'drawn' after fillDraw.
 * drawVersion increments on each re-draw so clients can detect stale caches.
 * isActive allows soft-deletion without losing historical bracket data.
 */
@Schema({
  collection: 'brackets',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Bracket {
  _id!: Types.ObjectId;

  /** Ref to Category._id (string form of ObjectId). */
  @Prop({ required: true })
  categoryId!: string;

  @Prop({
    required: true,
    enum: ['single_elim', 'round_robin', 'group_ko'],
  })
  format!: CategoryFormat;

  @Prop({
    required: true,
    enum: ['skeleton', 'drawn'],
    default: 'skeleton',
  })
  status!: 'skeleton' | 'drawn';

  /** Next power-of-2 participant count used to size the draw. null for round_robin. */
  @Prop({ type: Number, default: null })
  bracketSize!: number | null;

  /** Number of elimination rounds. null for round_robin. */
  @Prop({ type: Number, default: null })
  rounds!: number | null;

  /** Count of bye slots in the bracket (bracketSize - N). */
  @Prop({ required: true, default: 0 })
  byes!: number;

  /**
   * Monotonically increasing counter for re-draws.
   * 0 at skeleton creation; incremented each time fillDraw is applied.
   * Allows clients to detect stale cached draws by comparing versions.
   */
  @Prop({ required: true, default: 0 })
  drawVersion!: number;

  /** Soft-delete flag. Only the active bracket for a category is used. */
  @Prop({ required: true, default: true })
  isActive!: boolean;

  /** Format-specific config (e.g. groupCount, qualifyPerGroup for group_ko). */
  @Prop({ type: Object })
  formatConfig?: { groupCount?: number; qualifyPerGroup?: number };

  /** Timestamp of the most recent fillDraw call. */
  @Prop()
  drawnAt?: Date;

  /** UserId of the organizer who triggered the draw. */
  @Prop()
  drawnByUserId?: string;

  /**
   * Audit log of every draw. One entry appended per draw call.
   * Lightweight embedded array — no separate collection needed.
   */
  @Prop({ type: [Object], default: [] })
  drawHistory!: DrawHistoryEntry[];

  createdAt!: Date;
}

export type BracketDocument = HydratedDocument<Bracket>;
export const BracketSchema = SchemaFactory.createForClass(Bracket);

// Primary query: fetch the active bracket for a category.
BracketSchema.index({ categoryId: 1, isActive: 1 });
