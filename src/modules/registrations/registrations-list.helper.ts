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
  dob?: Date;
  avatarUrl?: string;
  identity?: { nationalId?: string; phone?: string };
};

type LeanCategory = {
  _id: { toHexString(): string };
  code: string;
};

type LeanCategoryFull = {
  _id: { toHexString(): string };
  code: string;
  name: string;
  playerCount: 1 | 2;
  createdAt: Date;
};

type LeanDisplayUser = {
  _id: { toHexString(): string };
  displayName: string;
  gender?: string;
  dob?: Date;
  identity?: { nationalId?: string; phone?: string };
};

type LeanRegApproved = {
  _id: { toHexString(): string };
  categoryId: string;
  primaryUserId: string;
  partnerUserId?: string;
  seed?: number;
  teamPhotoUrl?: string;
  createdAt: Date;
};

/**
 * Groups approved registrations by category and maps them to the teams response contract.
 * Categories are sorted by createdAt asc. Teams per category are sorted seed asc
 * (nulls last), then createdAt asc.
 * Players carry displayName only — no PII fields included.
 */
export function buildTeamsByCategoryResponse(
  regs: LeanRegApproved[],
  categories: LeanCategoryFull[],
  userMap: Map<string, LeanDisplayUser>,
) {
  // Group registrations by categoryId.
  const regsByCategory = new Map<string, LeanRegApproved[]>();
  for (const r of regs) {
    const list = regsByCategory.get(r.categoryId) ?? [];
    list.push(r);
    regsByCategory.set(r.categoryId, list);
  }

  const result = categories.map((cat) => {
    const catId = cat._id.toHexString();
    const catRegs = regsByCategory.get(catId) ?? [];

    // Sort: seed asc (nulls last), then createdAt asc.
    const sorted = [...catRegs].sort((a, b) => {
      const sa = a.seed ?? null;
      const sb = b.seed ?? null;
      if (sa !== null && sb !== null) return sa - sb;
      if (sa !== null) return -1;
      if (sb !== null) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const teams = sorted.map((r) => {
      const primary = userMap.get(r.primaryUserId);

      function playerShape(u: LeanDisplayUser | undefined) {
        const initials = (() => {
          const parts = (u?.displayName ?? '').trim().split(/\s+/);
          return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
        })();
        return {
          name: u?.displayName ?? '',
          initials,
          gender: (u?.gender ?? null) as 'male' | 'female' | null,
          dob: u?.dob ? new Date(u.dob).toISOString() : null,
          cccd: u?.identity?.nationalId ?? null,
          phone: u?.identity?.phone ?? null,
        };
      }

      const players = [playerShape(primary)];
      if (r.partnerUserId) {
        players.push(playerShape(userMap.get(r.partnerUserId)));
      }

      return {
        id: r._id.toHexString(),
        seed: r.seed ?? null,
        teamPhotoUrl: r.teamPhotoUrl ?? null,
        players,
      };
    });

    return {
      id: catId,
      code: cat.code,
      name: cat.name,
      playerCount: cat.playerCount,
      approvedCount: teams.length,
      seededCount: teams.filter((t) => t.seed !== null).length,
      teams,
    };
  });

  return { categories: result };
}

/** Builds the safe list-item shape for the organizer registration dashboard. */
export function buildRegistrationListItem(
  reg: LeanReg,
  primaryUser: LeanUser | undefined,
  partnerUser: LeanUser | undefined,
  category: LeanCategory | undefined,
) {
  return {
    id: reg._id.toHexString(),
    // Primary athlete
    athleteName: primaryUser?.displayName ?? '',
    athleteAvatarUrl: primaryUser?.avatarUrl ?? null,
    athleteGender: (primaryUser?.gender ?? null) as 'male' | 'female' | null,
    athleteDob: primaryUser?.dob ? new Date(primaryUser.dob).toISOString() : null,
    athleteCccd: primaryUser?.identity?.nationalId ?? null,
    athletePhone: primaryUser?.identity?.phone ?? null,
    // Partner (doubles only)
    partnerName: partnerUser?.displayName ?? null,
    partnerAvatarUrl: partnerUser?.avatarUrl ?? null,
    partnerGender: (partnerUser?.gender ?? null) as 'male' | 'female' | null,
    partnerDob: partnerUser?.dob ? new Date(partnerUser.dob).toISOString() : null,
    partnerCccd: partnerUser?.identity?.nationalId ?? null,
    partnerPhone: partnerUser?.identity?.phone ?? null,
    // Registration
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
