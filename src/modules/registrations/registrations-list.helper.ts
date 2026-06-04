import type { Model } from 'mongoose';
import type { UserDocument } from '../../schemas/user.schema';

/** Returns the last 4 digits of a national ID, or '' if absent. */
export function cccdLast4(nationalId?: string): string {
  if (!nationalId || nationalId.length < 4) return '';
  return nationalId.slice(-4);
}

/** Masks phone to first 4 chars + "…", or '' if absent. */
export function maskPhone(phone?: string): string {
  if (!phone || phone.length < 4) return '';
  return `${phone.slice(0, 4)}…`;
}

/**
 * Loads primary and optional partner user documents.
 * Throws DomainError (404) if a referenced user does not exist.
 * Accepts an optional cache map to avoid redundant DB queries within a batch.
 */
export async function resolveUsers(
  userModel: Model<UserDocument>,
  primaryUserId: string,
  partnerUserId?: string,
  cache?: Map<string, UserDocument | null>,
): Promise<{
  primary: { userId: string; gender: 'male' | 'female' };
  partner?: { userId: string; gender: 'male' | 'female' };
}> {
  const { DomainError } = await import('../../common/domain-error');

  const getUser = async (uid: string): Promise<UserDocument | null> => {
    if (cache) {
      if (!cache.has(uid)) {
        cache.set(
          uid,
          await userModel
            .findById(uid)
            .select('gender displayName identity')
            .exec(),
        );
      }
      return cache.get(uid) ?? null;
    }
    return userModel.findById(uid).select('gender displayName identity').exec();
  };

  const primaryDoc = await getUser(primaryUserId);
  if (!primaryDoc) {
    throw new DomainError(
      'USER_NOT_FOUND',
      'Người dùng chính không tồn tại.',
      404,
    );
  }

  const primary = { userId: primaryUserId, gender: primaryDoc.gender };

  if (!partnerUserId) {
    return { primary };
  }

  const partnerDoc = await getUser(partnerUserId);
  if (!partnerDoc) {
    throw new DomainError(
      'USER_NOT_FOUND',
      'Người dùng partner không tồn tại.',
      404,
    );
  }

  return {
    primary,
    partner: { userId: partnerUserId, gender: partnerDoc.gender },
  };
}

type LeanReg = {
  _id: { toHexString(): string };
  primaryUserId: string;
  partnerUserId?: string;
  categoryId: string;
  feeSnapshot: number;
  paymentStatus: string;
  status: string;
  createdAt: Date;
  seed?: number;
  teamPhotoUrl?: string;
};

type LeanUser = {
  _id: { toHexString(): string };
  displayName: string;
  gender?: string;
  identity?: { nationalId?: string; phone?: string };
};

type LeanCategory = {
  _id: { toHexString(): string };
  code: string;
};

/** Builds the safe list-item shape for the organizer registration dashboard. */
export function buildRegistrationListItem(
  reg: LeanReg,
  primaryUser: LeanUser | undefined,
  partnerUser: LeanUser | undefined,
  category: LeanCategory | undefined,
) {
  return {
    id: reg._id.toHexString(),
    athleteName: primaryUser?.displayName ?? '',
    cccdLast4: cccdLast4(primaryUser?.identity?.nationalId),
    phoneMasked: maskPhone(primaryUser?.identity?.phone),
    partnerName: partnerUser?.displayName ?? null,
    categoryId: reg.categoryId,
    categoryCode: category?.code ?? '',
    fee: reg.feeSnapshot,
    paymentStatus: reg.paymentStatus,
    registeredAt: reg.createdAt.toISOString(),
    status: reg.status,
    seed: reg.seed ?? null,
    teamPhotoUrl: reg.teamPhotoUrl ?? null,
  };
}
