import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import {
  Registration,
  type RegistrationDocument,
} from '../../schemas/registration.schema';
import { Category, type CategoryDocument } from '../../schemas/category.schema';
import { User, type UserDocument } from '../../schemas/user.schema';
import {
  TournamentRole,
  type TournamentRoleDocument,
} from '../../schemas/tournament-role.schema';
import { DomainError } from '../../common/domain-error';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { validateGenderRequirement } from '../../domain/validation/gender-requirement';
import type { AppConfig } from '../../config/configuration';
import type { SessionUser } from '../../schemas/user.schema';
import type { CreateSelfRegistrationDto } from './dto/create-self-registration.dto';
import type { CreateOrganizerRegistrationDto } from './dto/create-organizer-registration.dto';
import type { BulkRegistrationDto } from './dto/bulk-registration.dto';
import type { RejectRegistrationDto } from './dto/reject-registration.dto';
import type { EditableStatus } from './dto/update-registration-status.dto';
import type { SetSeedDto } from './dto/set-seed.dto';
import type { TeamPhotoDto } from './dto/team-photo.dto';
import {
  resolveUsers,
  buildRegistrationListItem,
  buildTeamsByCategoryResponse,
} from './registrations-list.helper';

/** Statuses that occupy a slot toward maxTeams. */
const ACTIVE_STATUSES = ['pending', 'approved'] as const;

/** A registration in 'pending' or 'approved' holds a category slot. */
function occupiesSlot(status: string): boolean {
  return status === 'pending' || status === 'approved';
}

type GenderReqCast = 'men_only' | 'women_only' | 'mixed_pair' | 'unrestricted';

@Injectable()
export class RegistrationsService {
  private readonly spacesPublicBaseUrl: string;

  constructor(
    @InjectModel(Registration.name)
    private readonly registrationModel: Model<RegistrationDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(TournamentRole.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    const spaces = this.config.get('spaces', { infer: true });
    // Use the same publicBaseUrl derivation as StorageService so URL validation
    // is anchored to the exact prefix that presigned uploads produce.
    this.spacesPublicBaseUrl =
      spaces.publicBaseUrl ||
      (spaces.endpoint && spaces.bucket
        ? `${spaces.endpoint}/${spaces.bucket}`
        : '');
  }

  // ---------------------------------------------------------------------------
  // Create — self
  // ---------------------------------------------------------------------------

  /**
   * Athlete self-registers for a category.
   * A slot is reserved atomically via findOneAndUpdate on the category counter
   * (slotsUsed < maxTeams) so concurrent registrations cannot oversubscribe maxTeams.
   * If the registration insert fails after reservation, the slot is compensated back.
   */
  async createSelf(
    cid: string,
    primaryUserId: string,
    dto: CreateSelfRegistrationDto,
  ) {
    const category = await this.loadOpenCategory(cid);
    const { primary, partner } = await resolveUsers(
      this.userModel,
      primaryUserId,
      dto.partnerUserId,
    );

    this.assertGender(category, primary, partner);
    await this.assertNoDuplicate(cid, primaryUserId);

    const reserved = await this.reserveSlot(cid);
    if (!reserved) {
      throw new DomainError('CATEGORY_FULL', 'Hạng mục đã đủ số đội.');
    }

    let regId: string | undefined;
    try {
      const created = await this.registrationModel.create([
        {
          tournamentId: category.tournamentId,
          categoryId: cid,
          primaryUserId,
          partnerUserId: dto.partnerUserId,
          status: 'pending',
          paymentStatus: 'unpaid',
          feeSnapshot: category.fee,
          createdMode: 'self',
          createdByUserId: primaryUserId,
        },
      ]);
      regId = created[0]!._id.toHexString();
    } catch (err) {
      // Compensate the reserved slot so the counter stays accurate.
      await this.releaseSlot(cid);
      throw err;
    }

    this.emitUpdated(category.tournamentId, cid, regId);
    return { id: regId };
  }

  // ---------------------------------------------------------------------------
  // Create — organizer single
  // ---------------------------------------------------------------------------

  /** Organizer registers an athlete on their behalf; auto-approved. */
  async createOrganizer(
    cid: string,
    dto: CreateOrganizerRegistrationDto,
    organizerId: string,
  ) {
    const category = await this.loadOpenCategory(cid);
    const { primary, partner } = await resolveUsers(
      this.userModel,
      dto.primaryUserId,
      dto.partnerUserId,
    );

    this.assertGender(category, primary, partner);
    await this.assertNoDuplicate(cid, dto.primaryUserId);

    const reserved = await this.reserveSlot(cid);
    if (!reserved) {
      throw new DomainError('CATEGORY_FULL', 'Hạng mục đã đủ số đội.');
    }

    let reg: RegistrationDocument;
    try {
      reg = await this.registrationModel.create({
        tournamentId: category.tournamentId,
        categoryId: cid,
        primaryUserId: dto.primaryUserId,
        partnerUserId: dto.partnerUserId,
        status: 'approved',
        paymentStatus: 'unpaid',
        feeSnapshot: category.fee,
        createdMode: 'organizer_single',
        createdByUserId: organizerId,
        approvedByUserId: organizerId,
      });
    } catch (err) {
      await this.releaseSlot(cid);
      throw err;
    }

    this.emitUpdated(category.tournamentId, cid, reg._id.toHexString());
    return { id: reg._id.toHexString() };
  }

  // ---------------------------------------------------------------------------
  // Create — bulk
  // ---------------------------------------------------------------------------

  /**
   * Bulk organizer registration. Each row is attempted independently — failures do not
   * roll back successful rows (partial commit). Each successful row atomically reserves
   * a slot via the category slotsUsed counter (slotsUsed < maxTeams filter). If the
   * insert fails after reservation, the slot is compensated back for that row only.
   */
  async bulk(tid: string, dto: BulkRegistrationDto, organizerId: string) {
    const success: { rowIndex: number; registrationId: string }[] = [];
    const errors: { rowIndex: number; code: string; message: string }[] = [];

    // Cache category and user lookups across rows for efficiency.
    const categoryCache = new Map<string, CategoryDocument | null>();
    const userCache = new Map<string, UserDocument | null>();

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i]!;
      try {
        if (!categoryCache.has(row.categoryId)) {
          categoryCache.set(
            row.categoryId,
            await this.categoryModel.findById(row.categoryId).lean().exec(),
          );
        }
        const category = categoryCache.get(
          row.categoryId,
        ) as CategoryDocument | null;
        if (!category)
          throw new DomainError(
            'CATEGORY_NOT_FOUND',
            'Hạng mục không tồn tại.',
            404,
          );
        if (category.tournamentId !== tid)
          throw new DomainError(
            'CATEGORY_NOT_FOUND',
            'Hạng mục không thuộc giải đấu này.',
            404,
          );
        if (category.registrationStatus !== 'open')
          throw new DomainError(
            'REGISTRATION_CLOSED',
            'Hạng mục chưa mở đăng ký.',
          );

        const { primary, partner } = await resolveUsers(
          this.userModel,
          row.primaryUserId,
          row.partnerUserId,
          userCache,
        );

        this.assertGender(category, primary, partner);
        await this.assertNoDuplicate(row.categoryId, row.primaryUserId);

        const reserved = await this.reserveSlot(row.categoryId);
        if (!reserved) {
          throw new DomainError(
            'CATEGORY_FULL',
            'Hạng mục đã đủ số đội.',
          );
        }

        let reg: RegistrationDocument;
        try {
          reg = await this.registrationModel.create({
            tournamentId: tid,
            categoryId: row.categoryId,
            primaryUserId: row.primaryUserId,
            partnerUserId: row.partnerUserId,
            status: 'approved',
            paymentStatus: 'unpaid',
            feeSnapshot: category.fee,
            createdMode: 'organizer_bulk',
            createdByUserId: organizerId,
            approvedByUserId: organizerId,
          });
        } catch (insertErr) {
          await this.releaseSlot(row.categoryId);
          throw insertErr;
        }

        success.push({ rowIndex: i, registrationId: reg._id.toHexString() });
        this.emitUpdated(tid, row.categoryId, reg._id.toHexString());
      } catch (err) {
        const code = err instanceof DomainError ? err.code : 'UNKNOWN_ERROR';
        const message =
          err instanceof Error ? err.message : 'Lỗi không xác định.';
        errors.push({ rowIndex: i, code, message });
      }
    }

    return { success, errors };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------------

  /**
   * Legacy organizer approve — strict pending → approved only. The conditional
   * update (status: 'pending' filter) is the atomic gate: a non-pending row
   * matches nothing and yields INVALID_LIFECYCLE_TRANSITION. Free editing of
   * already-decided registrations goes through setStatus / PATCH :rid/status.
   */
  async approve(rid: string, userId: string) {
    const reg = await this.loadRegistration(rid);
    const res = await this.registrationModel.updateOne(
      { _id: rid, status: 'pending' },
      { $set: { status: 'approved', approvedByUserId: userId } },
    );
    if (res.matchedCount === 0) {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Chỉ có thể duyệt từ trạng thái "pending". Hiện tại: "${reg.status}".`,
      );
    }
    // pending → approved: slot remains occupied — no counter change.
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  /** Legacy organizer reject — strict pending → rejected only (atomic gate). */
  async reject(rid: string, dto: RejectRegistrationDto) {
    const reg = await this.loadRegistration(rid);
    const res = await this.registrationModel.updateOne(
      { _id: rid, status: 'pending' },
      { $set: { status: 'rejected', rejectedReason: dto.reason ?? null } },
    );
    if (res.matchedCount === 0) {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Chỉ có thể từ chối từ trạng thái "pending". Hiện tại: "${reg.status}".`,
      );
    }
    // rejected frees the slot that was held while status was pending.
    await this.releaseSlot(reg.categoryId);
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  /**
   * Free-edit transition for organizers: pending ↔ approved ↔ rejected.
   * Every flip is an atomic conditional update on the OLD status, so the slot
   * side effect (reserve/release) is applied at most once per real transition
   * even under concurrent requests. 'withdrawn' is excluded as both source
   * (blocked) and target (rejected by the DTO) to keep withdraw ownership intact.
   */
  async setStatus(
    rid: string,
    target: EditableStatus,
    userId: string,
    reason?: string,
  ) {
    const reg = await this.loadRegistration(rid);
    const old = reg.status;

    if (old === 'withdrawn') {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        'Không thể chỉnh trạng thái đội đã rút.',
      );
    }

    // Idempotent no-op — never touches the slot counter. Refresh the rejected
    // reason if re-rejecting with a new one.
    if (old === target) {
      if (target === 'rejected' && reason !== undefined) {
        await this.registrationModel.updateOne(
          { _id: rid },
          { $set: { rejectedReason: reason } },
        );
        this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
      }
      return { ok: true };
    }

    const occOld = occupiesSlot(old);
    const occNew = occupiesSlot(target);

    const set: Record<string, unknown> = { status: target };
    if (target === 'approved') set.approvedByUserId = userId;
    // Keep any prior rejectedReason for audit when leaving 'rejected' — only
    // overwrite when entering 'rejected'.
    if (target === 'rejected') set.rejectedReason = reason ?? null;

    if (!occOld && occNew) {
      // Reactivate (rejected → pending/approved): claim a slot first. Capacity-only
      // reserve so an organizer can fix a roster even after registration is closed.
      await this.assertNoDuplicate(reg.categoryId, reg.primaryUserId);
      const reserved = await this.reserveSlotForReactivate(reg.categoryId);
      if (!reserved) {
        throw new DomainError('CATEGORY_FULL', 'Hạng mục đã đủ số đội.');
      }
      const res = await this.registrationModel.updateOne(
        { _id: rid, status: old },
        { $set: set },
      );
      if (res.matchedCount === 0) {
        // Lost a concurrent race — compensate the slot we just reserved.
        await this.releaseSlot(reg.categoryId);
        throw new DomainError(
          'CONFLICT',
          'Trạng thái vừa thay đổi, vui lòng tải lại.',
          409,
        );
      }
    } else if (occOld && !occNew) {
      // Release (pending/approved → rejected). Flip atomically first so only the
      // winning caller releases exactly one slot.
      const res = await this.registrationModel.updateOne(
        { _id: rid, status: old },
        { $set: set },
      );
      if (res.matchedCount === 0) {
        throw new DomainError(
          'CONFLICT',
          'Trạng thái vừa thay đổi, vui lòng tải lại.',
          409,
        );
      }
      await this.releaseSlot(reg.categoryId);
    } else {
      // pending ↔ approved: both occupy a slot, no counter change.
      const res = await this.registrationModel.updateOne(
        { _id: rid, status: old },
        { $set: set },
      );
      if (res.matchedCount === 0) {
        throw new DomainError(
          'CONFLICT',
          'Trạng thái vừa thay đổi, vui lòng tải lại.',
          409,
        );
      }
    }

    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  /**
   * Withdraw a registration. Caller must be the primary athlete or an organizer
   * of the tournament. Only pending or approved registrations may be withdrawn —
   * already-terminal states (withdrawn, rejected) are blocked.
   * Cascade logic (bracket slot cleanup) is deferred to a later phase.
   */
  async withdraw(rid: string, caller: SessionUser) {
    const reg = await this.loadRegistration(rid);

    if (reg.status === 'withdrawn' || reg.status === 'rejected') {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Không thể rút đăng ký ở trạng thái "${reg.status}".`,
      );
    }

    const isOwner = reg.primaryUserId === caller.id;

    if (!isOwner && caller.globalRole !== 'admin') {
      const hasRole = await this.roleModel.exists({
        tournamentId: reg.tournamentId,
        userId: caller.id,
        role: 'organizer',
      });
      if (!hasRole) {
        throw new DomainError(
          'FORBIDDEN',
          'Chỉ chủ đăng ký hoặc BTC mới có thể rút đăng ký này.',
          403,
        );
      }
    }

    // Atomic conditional flip: only a slot-occupying row transitions to withdrawn,
    // so a concurrent setStatus on the same registration cannot double-release.
    const res = await this.registrationModel.updateOne(
      { _id: rid, status: { $in: ['pending', 'approved'] } },
      { $set: { status: 'withdrawn', withdrawnAt: new Date() } },
    );
    if (res.matchedCount === 0) {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Không thể rút đăng ký ở trạng thái "${reg.status}".`,
      );
    }
    // withdrawn frees the slot that was held while status was pending or approved.
    await this.releaseSlot(reg.categoryId);
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Payment
  // ---------------------------------------------------------------------------

  async markPaid(rid: string, organizerId: string) {
    const reg = await this.loadRegistration(rid);
    await this.registrationModel.updateOne(
      { _id: rid },
      {
        $set: {
          paymentStatus: 'paid',
          paidAt: new Date(),
          paidMarkByUserId: organizerId,
        },
      },
    );
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  async unmarkPaid(rid: string) {
    const reg = await this.loadRegistration(rid);
    await this.registrationModel.updateOne(
      { _id: rid },
      {
        $set: { paymentStatus: 'unpaid' },
        $unset: { paidAt: '', paidMarkByUserId: '' },
      },
    );
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  /**
   * Set or clear a draw seed. Seed is allowed on any approved registration
   * regardless of category registration status — category status no longer gates it.
   * Only approved registrations can receive a seed; pending/rejected/withdrawn are rejected.
   */
  async setSeed(rid: string, dto: SetSeedDto) {
    const reg = await this.loadRegistration(rid);

    if (reg.status !== 'approved') {
      throw new DomainError(
        'REGISTRATION_NOT_APPROVED',
        'Chỉ có thể gán seed cho đội đã được duyệt.',
      );
    }

    const category = await this.categoryModel
      .findById(reg.categoryId)
      .lean()
      .exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    const seedValue = dto.seed ?? null;
    if (seedValue === null) {
      await this.registrationModel.updateOne(
        { _id: rid },
        { $unset: { seed: '' } },
      );
    } else {
      await this.registrationModel.updateOne(
        { _id: rid },
        { $set: { seed: seedValue } },
      );
    }
    // Push so other organizers viewing the team list see the seed change live,
    // instead of waiting out the client staleTime.
    this.emitUpdated(reg.tournamentId, reg.categoryId, rid);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Team photo
  // ---------------------------------------------------------------------------

  /**
   * Confirms a team photo URL after the presign upload completes.
   * URL must begin with the configured Spaces public base URL followed by
   * tournaments/{tid}/teams/{rid}. to prevent arbitrary external URLs from
   * being stored. If Spaces is not configured, the upload path is unavailable.
   */
  async setTeamPhoto(rid: string, dto: TeamPhotoDto) {
    const reg = await this.loadRegistration(rid);
    const tid = reg.tournamentId;

    if (!this.spacesPublicBaseUrl) {
      throw new DomainError(
        'SPACES_NOT_CONFIGURED',
        'File storage (DigitalOcean Spaces) is not configured in this environment.',
        501,
      );
    }

    const expectedPrefix = `${this.spacesPublicBaseUrl}/tournaments/${tid}/teams/${rid}.`;
    if (!dto.url.startsWith(expectedPrefix)) {
      throw new DomainError(
        'INVALID_TEAM_PHOTO_URL',
        'URL ảnh đội không hợp lệ. Phải upload qua presign của giải đấu này.',
      );
    }

    await this.registrationModel.updateOne(
      { _id: rid },
      { $set: { teamPhotoUrl: dto.url } },
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  /**
   * Returns all registrations for a tournament joined with athlete profile data.
   * PII is masked: nationalId → last-4 digits; phone → first-4 + "…".
   * This endpoint is organizer-only, so feeSnapshot and paymentStatus are included.
   */
  async listByTournament(tid: string) {
    const regs = await this.registrationModel
      .find({ tournamentId: tid })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    if (regs.length === 0) return { registrations: [], totalCount: 0 };

    const userIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const r of regs) {
      userIds.add(r.primaryUserId);
      if (r.partnerUserId) userIds.add(r.partnerUserId);
      categoryIds.add(r.categoryId);
    }

    const [users, categories] = await Promise.all([
      this.userModel
        .find({ _id: { $in: [...userIds] } })
        .select('displayName identity gender')
        .lean()
        .exec(),
      this.categoryModel
        .find({ _id: { $in: [...categoryIds] } })
        .select('code')
        .lean()
        .exec(),
    ]);

    const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));
    const categoryMap = new Map(
      categories.map((c) => [c._id.toHexString(), c]),
    );

    const registrations = regs.map((r) => {
      const primaryUser = userMap.get(r.primaryUserId);
      const partnerUser = r.partnerUserId
        ? userMap.get(r.partnerUserId)
        : undefined;
      const category = categoryMap.get(r.categoryId);
      return buildRegistrationListItem(r, primaryUser, partnerUser, category);
    });

    return { registrations, totalCount: registrations.length };
  }

  /**
   * Returns approved registrations for a tournament grouped by category.
   * Only approved teams are included — pending/rejected/withdrawn are excluded.
   * Player names are displayName only; no PII (email, nationalId, phone) is returned.
   */
  async listTeamsByCategory(tid: string) {
    const regs = await this.registrationModel
      .find({ tournamentId: tid, status: 'approved' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    if (regs.length === 0) {
      // Still need to return categories even if no approved teams.
      const categories = await this.categoryModel
        .find({ tournamentId: tid })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      return {
        categories: categories.map((c) => ({
          id: c._id.toHexString(),
          code: c.code,
          name: c.name,
          playerCount: c.playerCount,
          approvedCount: 0,
          seededCount: 0,
          teams: [],
        })),
      };
    }

    const userIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const r of regs) {
      userIds.add(r.primaryUserId);
      if (r.partnerUserId) userIds.add(r.partnerUserId);
      categoryIds.add(r.categoryId);
    }

    // Load users (displayName only — no PII fields) and all tournament categories.
    const [users, categories] = await Promise.all([
      this.userModel
        .find({ _id: { $in: [...userIds] } })
        .select('displayName')
        .lean()
        .exec(),
      this.categoryModel
        .find({ tournamentId: tid })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);

    const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));

    return buildTeamsByCategoryResponse(regs, categories, userMap);
  }

  // ---------------------------------------------------------------------------
  // Partner search
  // ---------------------------------------------------------------------------

  /**
   * Search users to select as a doubles partner.
   * Matches displayName only — email and nationalId are excluded from the query
   * to prevent PII enumeration by any authenticated user.
   * Returns minimal safe fields only — no PII.
   * Regex metacharacters escaped to prevent ReDoS (OWASP CWE-1333).
   */
  async searchUsersForPartner(_tid: string, q: string, gender?: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return { users: [] };

    const safe = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safe, 'i');

    const filter: Record<string, unknown> = {
      displayName: { $regex: regex },
    };

    if (gender === 'male' || gender === 'female') {
      filter['gender'] = gender;
    }

    const users = await this.userModel
      .find(filter)
      .select('displayName gender avatarUrl')
      .limit(15)
      .lean()
      .exec();

    return {
      users: users.map((u) => ({
        id: u._id.toHexString(),
        displayName: u.displayName,
        gender: u.gender,
        avatarUrl: u.avatarUrl ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async loadOpenCategory(cid: string): Promise<CategoryDocument> {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');
    if (category.registrationStatus !== 'open') {
      throw new DomainError('REGISTRATION_CLOSED', 'Hạng mục chưa mở đăng ký.');
    }
    return category;
  }

  private async loadRegistration(rid: string): Promise<RegistrationDocument> {
    const reg = await this.registrationModel.findById(rid).exec();
    if (!reg) throw new NotFoundException('Đăng ký không tồn tại.');
    return reg;
  }

  /**
   * Atomically increment slotsUsed if slotsUsed < maxTeams and registration is open.
   * Returns true if a slot was claimed, false if the category is full or not open.
   */
  private async reserveSlot(cid: string): Promise<boolean> {
    const result = await this.categoryModel.findOneAndUpdate(
      {
        _id: cid,
        registrationStatus: 'open',
        $expr: { $lt: ['$slotsUsed', '$maxTeams'] },
      },
      { $inc: { slotsUsed: 1 } },
      { returnDocument: 'after' },
    );
    return result !== null;
  }

  /**
   * Atomically claim a slot for reactivating a rejected registration.
   * Unlike reserveSlot, this does NOT require registrationStatus 'open' — an
   * organizer may clean up the roster (un-reject a team) after registration
   * has closed. Capacity (slotsUsed < maxTeams) is still enforced atomically.
   */
  private async reserveSlotForReactivate(cid: string): Promise<boolean> {
    const result = await this.categoryModel.findOneAndUpdate(
      {
        _id: cid,
        $expr: { $lt: ['$slotsUsed', '$maxTeams'] },
      },
      { $inc: { slotsUsed: 1 } },
      { returnDocument: 'after' },
    );
    return result !== null;
  }

  /**
   * Decrement slotsUsed when a slot-occupying registration is freed.
   * min:0 on the schema field prevents underflow, but we only call this
   * when transitioning out of a slot-occupying status (pending/approved).
   */
  private async releaseSlot(cid: string): Promise<void> {
    await this.categoryModel.updateOne(
      { _id: cid, slotsUsed: { $gt: 0 } },
      { $inc: { slotsUsed: -1 } },
    );
  }

  private assertGender(
    category: { playerCount: 1 | 2; genderRequirement: string },
    primary: { userId: string; gender: 'male' | 'female' },
    partner?: { userId: string; gender: 'male' | 'female' },
  ) {
    let result;
    try {
      result = validateGenderRequirement(
        category as { playerCount: 1 | 2; genderRequirement: GenderReqCast },
        primary,
        partner,
      );
    } catch {
      // validateGenderRequirement throws for mixed_pair+singles (invalid category config).
      // Wrap as a domain error so it surfaces as 400, not 500.
      throw new DomainError(
        'INVALID_CATEGORY_CONFIG',
        'Nam-nữ chỉ áp dụng cho nội dung đôi.',
      );
    }
    if (!result.ok) {
      throw new DomainError(
        'GENDER_REQUIREMENT_VIOLATION',
        result.error ?? 'Không đáp ứng yêu cầu giới tính.',
      );
    }
  }

  private async assertNoDuplicate(cid: string, primaryUserId: string) {
    const existing = await this.registrationModel
      .exists({
        categoryId: cid,
        primaryUserId,
        status: { $in: ACTIVE_STATUSES },
      })
      .exec();
    if (existing) {
      throw new DomainError(
        'DUPLICATE_REGISTRATION',
        'Bạn đã đăng ký hạng mục này rồi.',
      );
    }
  }

  private emitUpdated(
    tournamentId: string,
    categoryId: string,
    registrationId: string,
  ) {
    const payload = { registrationId, categoryId };
    this.realtime.emitToCategory(categoryId, 'registration:updated', payload);
    this.realtime.emitToTournament(
      tournamentId,
      'registration:updated',
      payload,
    );
  }
}
