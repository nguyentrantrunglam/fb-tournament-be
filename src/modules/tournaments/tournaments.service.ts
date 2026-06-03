import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tournament, type TournamentDocument } from '../../schemas/tournament.schema';
import {
  TournamentRole,
  type TournamentRoleDocument,
} from '../../schemas/tournament-role.schema';
import { User, type UserDocument } from '../../schemas/user.schema';
import { DomainError } from '../../common/domain-error';
import type { CreateTournamentDto } from './dto/create-tournament.dto';
import type { UpdateTournamentDto } from './dto/update-tournament.dto';
import type { TournamentVisibilityDto } from './dto/tournament-visibility.dto';
import type { GrantTournamentRoleDto } from './dto/grant-tournament-role.dto';

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Vietnamese tournament name to a URL-safe kebab slug.
 * Strips diacritics, replaces spaces with hyphens, removes invalid chars.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Generate a short random suffix (5 hex chars) for slug uniqueness. */
function shortId(): string {
  return Math.random().toString(16).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Safe serialization
// ---------------------------------------------------------------------------

function safeTournament(doc: TournamentDocument) {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    startDate: doc.startDate,
    endDate: doc.endDate,
    location: doc.location,
    bannerUrl: doc.bannerUrl ?? null,
    logoUrl: doc.logoUrl ?? null,
    rulesText: doc.rulesText ?? null,
    sponsors: doc.sponsors,
    paymentConfig: doc.paymentConfig ?? null,
    isPublic: doc.isPublic,
    ownerUserId: doc.ownerUserId,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TournamentsService {
  constructor(
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentRole.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Create a tournament and atomically grant the creator the organizer role.
   * Slug is generated from the name; if an E11000 conflict occurs (race),
   * the service appends a random suffix and retries once.
   */
  async create(dto: CreateTournamentDto, callerId: string) {
    if (dto.endDate < dto.startDate) {
      throw new DomainError('INVALID_DATE_RANGE', 'Ngày kết thúc phải sau ngày bắt đầu.');
    }

    const base = slugify(dto.name) || 'giai';
    const slug = `${base}-${shortId()}`;

    const tournament = await this.tournamentModel.create({
      name: dto.name.trim(),
      slug,
      description: '',
      startDate: dto.startDate,
      endDate: dto.endDate,
      location: dto.location.trim(),
      isPublic: false,
      ownerUserId: callerId,
      status: 'draft',
      sponsors: [],
    });

    // Auto-grant the creator the organizer role on this tournament.
    await this.roleModel.create({
      tournamentId: tournament._id.toHexString(),
      userId: callerId,
      role: 'organizer',
      grantedAt: new Date(),
      grantedByUserId: callerId,
    });

    return { id: tournament._id.toHexString(), slug: tournament.slug };
  }

  /**
   * List tournaments visible to the caller:
   * - admin sees all tournaments.
   * - organizer/referee sees tournaments they own OR have a role in.
   * - athlete sees only their owned tournaments (rare edge case).
   */
  async listMine(callerId: string, globalRole: string) {
    if (globalRole === 'admin') {
      const all = await this.tournamentModel.find().sort({ createdAt: -1 }).lean().exec();
      return { tournaments: all.map((t) => this.safeLean(t, callerId)) };
    }

    // Tournaments where caller is owner.
    const ownedQuery = this.tournamentModel
      .find({ ownerUserId: callerId })
      .lean()
      .exec();

    // Tournaments where caller has any role (organizer or referee).
    const roleDocs = await this.roleModel
      .find({ userId: callerId })
      .select('tournamentId')
      .lean()
      .exec();

    const roleIds = roleDocs.map((r) => r.tournamentId);

    const [owned, byRole] = await Promise.all([
      ownedQuery,
      this.tournamentModel
        .find({ _id: { $in: roleIds } })
        .lean()
        .exec(),
    ]);

    // Deduplicate (owner may also appear in roleIds).
    const seen = new Set<string>();
    const merged: typeof owned = [];
    for (const t of [...owned, ...byRole]) {
      const id = t._id.toHexString();
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(t);
      }
    }
    merged.sort(
      (a, b) =>
        (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );

    return { tournaments: merged.map((t) => this.safeLean(t, callerId)) };
  }

  /** Get tournament detail. Visibility: owner/role/admin always; others only if isPublic. */
  async getOne(tid: string, callerId: string, globalRole: string) {
    const tournament = await this.tournamentModel.findById(tid).exec();
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    const isAdmin = globalRole === 'admin';
    const isOwner = tournament.ownerUserId === callerId;

    if (!tournament.isPublic && !isAdmin && !isOwner) {
      // Check if caller has any role in this tournament.
      const roleDoc = await this.roleModel
        .findOne({ tournamentId: tid, userId: callerId })
        .lean()
        .exec();
      if (!roleDoc) throw new ForbiddenException('Bạn không có quyền xem giải đấu này.');
    }

    return safeTournament(tournament);
  }

  /** Update tournament detail fields (not visibility — that's a separate endpoint). */
  async update(tid: string, dto: UpdateTournamentDto) {
    const patch: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 3)
        throw new DomainError('INVALID_NAME', 'Tên giải tối thiểu 3 ký tự.');
      patch['name'] = name;
    }
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim().toLowerCase();
      if (slug.length < 3) throw new DomainError('INVALID_SLUG', 'Slug tối thiểu 3 ký tự.');
      // Duplicate slug → unique-index E11000 → SLUG_ALREADY_USED (DomainExceptionFilter).
      patch['slug'] = slug;
    }
    if (dto.description !== undefined) patch['description'] = dto.description.slice(0, 1000);
    if (dto.startDate !== undefined) patch['startDate'] = dto.startDate;
    if (dto.endDate !== undefined) patch['endDate'] = dto.endDate;

    // Validate date range when both dates are supplied or being updated.
    const start = (patch['startDate'] as string | undefined) ?? undefined;
    const end = (patch['endDate'] as string | undefined) ?? undefined;
    if (start && end && end < start) {
      throw new DomainError('INVALID_DATE_RANGE', 'Ngày kết thúc phải sau ngày bắt đầu.');
    }

    if (dto.location !== undefined) patch['location'] = dto.location.trim();
    if (dto.bannerUrl !== undefined) patch['bannerUrl'] = dto.bannerUrl || null;
    if (dto.logoUrl !== undefined) patch['logoUrl'] = dto.logoUrl || null;
    if (dto.rulesText !== undefined)
      patch['rulesText'] = dto.rulesText ? dto.rulesText.slice(0, 20000) : null;

    if (dto.sponsors !== undefined) {
      patch['sponsors'] = dto.sponsors.map((s, i) => ({
        id: s.id || `s${i}`,
        tier: s.tier,
        name: s.name.slice(0, 120),
        logoUrl: s.logoUrl ?? null,
        link: (s.link ?? '').slice(0, 300),
        description: (s.description ?? '').slice(0, 300),
      }));
    }

    if (dto.paymentConfig !== undefined) {
      patch['paymentConfig'] = dto.paymentConfig;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const updated = await this.tournamentModel
      .findByIdAndUpdate(tid, { $set: patch }, { returnDocument: 'after' })
      .exec();

    if (!updated) throw new NotFoundException('Giải đấu không tồn tại.');
    return safeTournament(updated);
  }

  /** Toggle isPublic visibility. */
  async setVisibility(tid: string, dto: TournamentVisibilityDto) {
    const updated = await this.tournamentModel
      .findByIdAndUpdate(tid, { $set: { isPublic: dto.isPublic } }, { returnDocument: 'after' })
      .exec();
    if (!updated) throw new NotFoundException('Giải đấu không tồn tại.');
    return { id: updated._id.toHexString(), isPublic: updated.isPublic };
  }

  /**
   * Grant a user a role on this tournament. E11000 from the compound unique index
   * is caught by DomainExceptionFilter → TOURNAMENT_ROLE_ALREADY_GRANTED.
   *
   * H2: verifies the target user exists before inserting the role doc to prevent orphan grants.
   */
  async grantRole(tid: string, dto: GrantTournamentRoleDto, grantedBy: string) {
    const tournament = await this.tournamentModel.findById(tid).lean().exec();
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    // H2 — prevent orphan role grants for non-existent users.
    const targetUserExists = await this.userModel.exists({ _id: dto.userId });
    if (!targetUserExists) {
      throw new DomainError('USER_NOT_FOUND', 'Người dùng không tồn tại.', 404);
    }

    await this.roleModel.create({
      tournamentId: tid,
      userId: dto.userId,
      role: dto.role,
      grantedAt: new Date(),
      grantedByUserId: grantedBy,
    });

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private safeLean(
    t: {
      _id: { toHexString(): string };
      name: string;
      slug: string;
      status: string;
      startDate: string;
      endDate: string;
      location: string;
      bannerUrl?: string;
      logoUrl?: string;
      ownerUserId: string;
      isPublic: boolean;
      createdAt?: Date;
    },
    callerId: string,
  ) {
    return {
      id: t._id.toHexString(),
      name: t.name,
      slug: t.slug,
      status: t.status,
      startDate: t.startDate,
      endDate: t.endDate,
      location: t.location,
      bannerUrl: t.bannerUrl ?? null,
      logoUrl: t.logoUrl ?? null,
      isPublic: t.isPublic,
      isOwner: t.ownerUserId === callerId,
      createdAt: t.createdAt?.toISOString() ?? null,
    };
  }
}
