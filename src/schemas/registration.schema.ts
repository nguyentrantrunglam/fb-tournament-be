import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RegistrationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn';
export type PaymentStatus = 'unpaid' | 'paid';
export type CreatedMode = 'self' | 'organizer_single' | 'organizer_bulk';

/**
 * Registration document — one team entry (singles or doubles) within a category.
 *
 * Slot enforcement: category.slotsUsed is incremented atomically via findOneAndUpdate
 * (with filter slotsUsed < maxTeams) before the registration document is inserted.
 * This makes the counter the serialization point — concurrent registrations cannot both
 * claim the last slot. slotsUsed is decremented when a registration is withdrawn or
 * rejected, and unchanged on approve (slot remains occupied).
 *
 * feeSnapshot captures the category fee at registration time so fee changes after
 * registration creation do not retroactively affect existing entries.
 */
@Schema({
  collection: 'registrations',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Registration {
  _id!: Types.ObjectId;

  @Prop({ required: true })
  tournamentId!: string;

  @Prop({ required: true })
  categoryId!: string;

  @Prop({ required: true })
  primaryUserId!: string;

  /** Present for doubles categories; absent for singles. */
  @Prop()
  partnerUserId?: string;

  @Prop({
    required: true,
    enum: ['pending', 'approved', 'rejected', 'withdrawn'],
    default: 'pending',
  })
  status!: RegistrationStatus;

  @Prop({
    required: true,
    enum: ['unpaid', 'paid'],
    default: 'unpaid',
  })
  paymentStatus!: PaymentStatus;

  /** Fee captured at registration time; immutable after creation. */
  @Prop({ required: true, min: 0 })
  feeSnapshot!: number;

  @Prop({
    required: true,
    enum: ['self', 'organizer_single', 'organizer_bulk'],
  })
  createdMode!: CreatedMode;

  @Prop({ required: true })
  createdByUserId!: string;

  /** Set when an organizer approves a pending registration. */
  @Prop()
  approvedByUserId?: string;

  /** Timestamp of payment confirmation (mark-paid). */
  @Prop()
  paidAt?: Date;

  /** Organizer who marked the registration as paid. */
  @Prop()
  paidMarkByUserId?: string;

  /** Draw seed — set after registration closes, before bracket generation. */
  @Prop()
  seed?: number;

  /** URL of the team's custom photo (uploaded via presigned PUT to Spaces). */
  @Prop()
  teamPhotoUrl?: string;

  /** Set when status transitions to 'withdrawn'. */
  @Prop()
  withdrawnAt?: Date;

  /** Reason provided when an organizer rejects a registration. */
  @Prop()
  rejectedReason?: string;

  /** Injected by timestamps option. */
  createdAt!: Date;
}

export type RegistrationDocument = HydratedDocument<Registration>;
export const RegistrationSchema = SchemaFactory.createForClass(Registration);

// Slot counting: primary query pattern for enforcing maxTeams.
RegistrationSchema.index({ categoryId: 1, status: 1 });

// Tournament-level listing for organizer dashboard.
RegistrationSchema.index({ tournamentId: 1 });

// Per-user registration lookup (athlete sees own registrations).
RegistrationSchema.index({ primaryUserId: 1 });
