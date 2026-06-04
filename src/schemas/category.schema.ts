import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryRegistrationStatus = 'not_open' | 'open' | 'closed';
export type GenderRequirement =
  | 'men_only'
  | 'women_only'
  | 'mixed_pair'
  | 'unrestricted';
export type CategoryFormat = 'single_elim' | 'round_robin' | 'group_ko';

/**
 * Category document — one competition event within a tournament (e.g. "Men's Singles").
 * Compound unique index {tournamentId, code} prevents duplicate codes within a tournament;
 * duplicate-key E11000 is mapped to CATEGORY_CODE_DUPLICATE by DomainExceptionFilter.
 *
 * Field freeze rule: code, playerCount, genderRequirement become immutable once
 * registrationStatus transitions to 'open' (enforced at service layer, not schema).
 */
@Schema({
  collection: 'categories',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Category {
  _id!: Types.ObjectId;

  /** Ref to Tournament._id (string form of ObjectId). */
  @Prop({ required: true })
  tournamentId!: string;

  /**
   * Short code unique within the tournament, e.g. "MS", "WD", "XD".
   * Regex ^[A-Z0-9_-]{2,12}$ enforced at service layer before insert.
   */
  @Prop({ required: true })
  code!: string;

  @Prop({ required: true })
  name!: string;

  /** 1 = singles, 2 = doubles/pairs. mixed_pair requires playerCount === 2. */
  @Prop({ required: true, enum: [1, 2] })
  playerCount!: 1 | 2;

  @Prop({
    required: true,
    enum: ['men_only', 'women_only', 'mixed_pair', 'unrestricted'],
  })
  genderRequirement!: GenderRequirement;

  @Prop({
    required: true,
    enum: ['single_elim', 'round_robin', 'group_ko'],
    default: 'single_elim',
  })
  format!: CategoryFormat;

  /** Best-of series length. Only 1, 3, or 5 are valid (enforced at service layer). */
  @Prop({ required: true, enum: [1, 3, 5], default: 3 })
  bestOf!: 1 | 3 | 5;

  /** Arbitrary format-specific config (e.g. group sizes for group_ko). Untyped for extensibility. */
  @Prop({ type: Object })
  formatConfig?: Record<string, unknown>;

  /** ISO datetime — must be in the future at creation time. */
  @Prop({ required: true })
  registrationDeadline!: string;

  /** Entry fee in VND. 0 = free. */
  @Prop({ required: true, min: 0, default: 0 })
  fee!: number;

  /** Maximum teams/pairs allowed. Clamped to [2, 256] at service layer. */
  @Prop({ required: true, min: 2, max: 256 })
  maxTeams!: number;

  /**
   * Atomic slot counter: incremented when a registration enters pending/approved,
   * decremented when it transitions out (withdrawn, rejected). The counter is the
   * serialization point that prevents concurrent registrations from oversubscribing
   * maxTeams — only a findOneAndUpdate with { slotsUsed < maxTeams } can claim a slot.
   * Default 0; min:0 prevents underflow. Existing categories treat missing as 0 via $inc.
   */
  @Prop({ required: true, default: 0, min: 0 })
  slotsUsed!: number;

  /** Optional start time for scheduling this category's matches. */
  @Prop()
  scheduleStartAt?: string;

  /** Estimated minutes per match — used by the scheduler formula (Phase 5+). */
  @Prop()
  estimatedMinPerMatch?: number;

  @Prop({
    required: true,
    enum: ['not_open', 'open', 'closed'],
    default: 'not_open',
  })
  registrationStatus!: CategoryRegistrationStatus;

  /** Timestamp when organizer opened registration. */
  @Prop()
  openedAt?: Date;

  /** Timestamp when organizer closed registration. */
  @Prop()
  closedAt?: Date;

  createdAt!: Date;
}

export type CategoryDocument = HydratedDocument<Category>;
export const CategorySchema = SchemaFactory.createForClass(Category);

/**
 * Compound unique index: a category code must be unique within a tournament.
 * E11000 on this index is mapped to CATEGORY_CODE_DUPLICATE by DomainExceptionFilter.
 */
CategorySchema.index({ tournamentId: 1, code: 1 }, { unique: true });
