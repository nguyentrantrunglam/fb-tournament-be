import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TournamentRoleValue = 'organizer' | 'referee';

/**
 * Per-tournament role grant. One doc per {tournamentId, userId, role} triple.
 * Compound unique index prevents granting the same role twice.
 *
 * Organizer is auto-inserted when a tournament is created (owner = organizer).
 * Referee is granted via POST /tournaments/:tid/roles by an organizer or admin.
 */
@Schema({ collection: 'tournamentRoles', timestamps: false })
export class TournamentRole {
  _id!: Types.ObjectId;

  @Prop({ required: true })
  tournamentId!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true, enum: ['organizer', 'referee'] })
  role!: TournamentRoleValue;

  @Prop({ required: true, default: () => new Date() })
  grantedAt!: Date;

  /** Who granted this role. Self-referential for the owner bootstrap (ownerUserId = grantedByUserId). */
  @Prop({ required: true })
  grantedByUserId!: string;
}

export type TournamentRoleDocument = HydratedDocument<TournamentRole>;
export const TournamentRoleSchema = SchemaFactory.createForClass(TournamentRole);

/** Compound unique: one role per user per tournament. E11000 → DUPLICATE_KEY (already has the role). */
TournamentRoleSchema.index({ tournamentId: 1, userId: 1, role: 1 }, { unique: true });
