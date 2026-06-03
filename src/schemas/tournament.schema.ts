import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// ---------------------------------------------------------------------------
// Subdocuments
// ---------------------------------------------------------------------------

/** Sponsor entry embedded in the tournament document. sponsors[] is bounded (MVP cap 20). */
@Schema({ _id: false })
export class SponsorSubdoc {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, enum: ['diamond', 'gold', 'silver', 'operator', 'media'] })
  tier!: 'diamond' | 'gold' | 'silver' | 'operator' | 'media';

  @Prop({ required: true })
  name!: string;

  @Prop()
  logoUrl?: string;

  @Prop({ default: '' })
  link!: string;

  @Prop({ default: '' })
  description!: string;
}

export const SponsorSubdocSchema = SchemaFactory.createForClass(SponsorSubdoc);

/** Payment / QR config embedded in the tournament document. */
@Schema({ _id: false })
export class PaymentConfigSubdoc {
  @Prop({ required: true })
  accountHolder!: string;

  @Prop({ required: true })
  accountNumber!: string;

  @Prop({ required: true })
  bankCode!: string;

  @Prop({ required: true })
  transferMemoTemplate!: string;

  @Prop()
  qrUrl?: string;
}

export const PaymentConfigSubdocSchema = SchemaFactory.createForClass(PaymentConfigSubdoc);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

export type TournamentStatus = 'draft' | 'open' | 'running' | 'completed' | 'cancelled';
export type SponsorTier = 'diamond' | 'gold' | 'silver' | 'operator' | 'media';

/**
 * Tournament document. Mirrors the Firestore `tournaments/{id}` document structure.
 * sponsors[] and paymentConfig are embedded (bounded size, no separate collection needed).
 * slug has a unique index — slug collision on create is handled by retrying with a suffix
 * (DomainExceptionFilter maps E11000 → SLUG_ALREADY_USED on the PATCH /slug flow).
 */
@Schema({ collection: 'tournaments', timestamps: { createdAt: true, updatedAt: false } })
export class Tournament {
  _id!: Types.ObjectId;

  @Prop({ required: true, minlength: 3 })
  name!: string;

  /** URL-safe kebab slug, unique across the platform. */
  @Prop({ required: true, unique: true })
  slug!: string;

  @Prop({ default: '' })
  description!: string;

  /** ISO date string YYYY-MM-DD (timezone-free — tournament date, not instant). */
  @Prop({ required: true })
  startDate!: string;

  @Prop({ required: true })
  endDate!: string;

  @Prop({ required: true })
  location!: string;

  @Prop()
  bannerUrl?: string;

  @Prop()
  logoUrl?: string;

  /** Rich text rules (markdown, max 20 000 chars at service layer). */
  @Prop()
  rulesText?: string;

  @Prop({ type: [SponsorSubdocSchema], default: [] })
  sponsors!: SponsorSubdoc[];

  @Prop({ type: PaymentConfigSubdocSchema })
  paymentConfig?: PaymentConfigSubdoc;

  /** False until organizer explicitly toggles public. */
  @Prop({ default: false })
  isPublic!: boolean;

  /** ObjectId string of the user who created the tournament. */
  @Prop({ required: true })
  ownerUserId!: string;

  @Prop({
    required: true,
    enum: ['draft', 'open', 'running', 'completed', 'cancelled'],
    default: 'draft',
  })
  status!: TournamentStatus;

  /** Injected by timestamps option. */
  createdAt!: Date;
}

export type TournamentDocument = HydratedDocument<Tournament>;
export const TournamentSchema = SchemaFactory.createForClass(Tournament);

// slug already has unique:true via @Prop — Mongoose creates the index automatically.
