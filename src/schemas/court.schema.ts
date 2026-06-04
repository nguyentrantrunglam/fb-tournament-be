import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CourtStatus = 'available' | 'busy';

/**
 * Court document — a physical playing court belonging to a tournament.
 * currentMatchId is set by the match-assignment flow (Phase 5+ operations module).
 * DELETE is blocked at service layer when currentMatchId is set (match in progress).
 */
@Schema({
  collection: 'courts',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Court {
  _id!: Types.ObjectId;

  /** Ref to Tournament._id. */
  @Prop({ required: true })
  tournamentId!: string;

  /** Display name, e.g. "Sân 1", "Court A". */
  @Prop({ required: true })
  name!: string;

  /**
   * Referee currently assigned to this court (snapshot of userId).
   * Set by the court-assign flow; null when court is unattended.
   */
  @Prop()
  currentRefereeUserId?: string;

  /**
   * Match currently active on this court.
   * Set by match-assignment (Phase 5+). Non-null blocks court deletion.
   */
  @Prop()
  currentMatchId?: string;

  @Prop({
    required: true,
    enum: ['available', 'busy'],
    default: 'available',
  })
  status!: CourtStatus;

  /** When the current referee was assigned — used by referee snapshot auth logic. */
  @Prop()
  refereeAssignedAt?: Date;

  createdAt!: Date;
}

export type CourtDocument = HydratedDocument<Court>;
export const CourtSchema = SchemaFactory.createForClass(Court);
