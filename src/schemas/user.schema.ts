import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** PII sub-document — never returned to clients except owner/admin routes. */
@Schema({ _id: false })
export class IdentitySubdoc {
  @Prop({ required: true })
  nationalId!: string;

  @Prop()
  phone?: string;
}

export const IdentitySubdocSchema =
  SchemaFactory.createForClass(IdentitySubdoc);

export type GlobalRole = 'athlete' | 'organizer_capable' | 'admin';

/**
 * User document. PII lives in `identity` (never exposed by default).
 * passwordHash has `select: false` so it is never included in queries unless
 * explicitly requested with `.select('+passwordHash')`.
 */
@Schema({
  collection: 'users',
  timestamps: { createdAt: true, updatedAt: false },
})
export class User {
  /** Injected by Mongoose — always present after save. */
  _id!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  email!: string;

  /** Never returned in normal queries — select explicitly only in auth paths. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ required: true, enum: ['male', 'female'] })
  gender!: 'male' | 'female';

  @Prop({ required: true })
  dob!: Date;

  @Prop()
  avatarUrl?: string;

  @Prop({
    required: true,
    enum: ['athlete', 'organizer_capable', 'admin'],
    default: 'athlete',
  })
  globalRole!: GlobalRole;

  @Prop({ type: IdentitySubdocSchema, required: true })
  identity!: IdentitySubdoc;

  /** Injected by timestamps option. */
  createdAt!: Date;

  /** Password reset token — sha256 hash stored; raw token sent in email. */
  @Prop({ select: false })
  resetTokenHash?: string;

  /** UTC expiry for the reset token. */
  @Prop({ select: false })
  resetTokenExpiresAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// Compound unique index on identity.nationalId — race protection is delegated to DB (E11000).
UserSchema.index({ 'identity.nationalId': 1 }, { unique: true });

/**
 * Safe user object returned to clients — never contains passwordHash or reset fields.
 * `identity` is included ONLY when the caller is the owner or an admin.
 *
 * Mongoose documents are not plain class instances, so we cannot rely on
 * class-transformer @Exclude alone. This function is the single controlled exit point.
 */
export function sanitizeUser(
  user:
    | UserDocument
    | (Partial<User> & { _id: Types.ObjectId; createdAt?: Date }),
  opts: { includeIdentity: boolean },
): SafeUser {
  const base: SafeUser = {
    id: user._id.toHexString(),
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    gender: user.gender ?? ('athlete' as unknown as 'male' | 'female'),
    dob: (user.dob ?? new Date()).toISOString(),
    avatarUrl: user.avatarUrl,
    globalRole: user.globalRole ?? 'athlete',
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };

  if (opts.includeIdentity && user.identity) {
    base.identity = {
      nationalId: user.identity.nationalId,
      phone: user.identity.phone,
    };
  }

  return base;
}

/** Minimal session user — stored in express-session (no PII). */
export interface SessionUser {
  id: string;
  globalRole: GlobalRole;
}

/** Safe API response shape for a user. */
export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  gender: 'male' | 'female';
  dob: string;
  avatarUrl?: string;
  globalRole: GlobalRole;
  createdAt: string;
  identity?: {
    nationalId: string;
    phone?: string;
  };
}
