import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, type CategoryDocument } from '../../schemas/category.schema';
import { DomainError } from '../../common/domain-error';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

// ---------------------------------------------------------------------------
// Frozen fields — immutable once registration is open.
// ---------------------------------------------------------------------------
const FROZEN_FIELDS = ['code', 'playerCount', 'genderRequirement'] as const;
type FrozenField = (typeof FROZEN_FIELDS)[number];

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  /**
   * Create a category within a tournament.
   * Validates: mixed_pair requires playerCount === 2; deadline must be future;
   * code regex already enforced by DTO.
   * Compound unique index {tournamentId, code} handles duplicate codes atomically;
   * E11000 is mapped to CATEGORY_CODE_DUPLICATE by DomainExceptionFilter.
   */
  async create(tid: string, dto: CreateCategoryDto) {
    // mixed_pair requires doubles (playerCount === 2) — gender pairing is meaningless for singles.
    if (dto.genderRequirement === 'mixed_pair' && dto.playerCount !== 2) {
      throw new DomainError(
        'INVALID_CATEGORY_CONFIG',
        'Nam-nữ (mixed_pair) chỉ áp dụng cho nội dung đôi (playerCount = 2).',
      );
    }

    if (new Date(dto.registrationDeadline) <= new Date()) {
      throw new DomainError(
        'INVALID_REGISTRATION_DEADLINE',
        'Hạn đăng ký phải là thời điểm trong tương lai.',
      );
    }

    const category = await this.categoryModel.create({
      tournamentId: tid,
      code: dto.code.toUpperCase(),
      name: dto.name.trim(),
      playerCount: dto.playerCount,
      genderRequirement: dto.genderRequirement,
      format: dto.format ?? 'single_elim',
      bestOf: dto.bestOf,
      fee: Math.max(0, Math.floor(dto.fee)),
      maxTeams: Math.max(2, Math.min(256, Math.floor(dto.maxTeams))),
      registrationDeadline: dto.registrationDeadline,
      registrationStatus: 'not_open',
    });

    return { id: category._id.toHexString() };
  }

  /**
   * Update category config.
   * Once registrationStatus is 'open' or 'closed', frozen fields (code, playerCount,
   * genderRequirement) cannot be changed — this prevents structural changes after
   * participants have registered.
   */
  async update(cid: string, dto: UpdateCategoryDto) {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    const isOpen = category.registrationStatus !== 'not_open';
    const patch: Record<string, unknown> = {};

    for (const field of FROZEN_FIELDS) {
      if (dto[field as keyof UpdateCategoryDto] !== undefined) {
        if (isOpen) {
          throw new DomainError(
            'CATEGORY_FIELD_FROZEN',
            `Không thể thay đổi "${field}" sau khi đã mở đăng ký.`,
          );
        }
        patch[field] = dto[field as FrozenField];
      }
    }

    // Validate mixed_pair consistency if either relevant field is being patched.
    const newPlayerCount =
      (patch['playerCount'] as number | undefined) ?? category.playerCount;
    const newGender =
      (patch['genderRequirement'] as string | undefined) ?? category.genderRequirement;
    if (newGender === 'mixed_pair' && newPlayerCount !== 2) {
      throw new DomainError(
        'INVALID_CATEGORY_CONFIG',
        'Nam-nữ (mixed_pair) chỉ áp dụng cho nội dung đôi (playerCount = 2).',
      );
    }

    if (dto.name !== undefined) patch['name'] = dto.name.trim();
    if (dto.format !== undefined) patch['format'] = dto.format;
    if (dto.bestOf !== undefined) patch['bestOf'] = dto.bestOf;
    if (dto.fee !== undefined) patch['fee'] = Math.max(0, Math.floor(dto.fee));
    if (dto.maxTeams !== undefined)
      patch['maxTeams'] = Math.max(2, Math.min(256, Math.floor(dto.maxTeams)));
    if (dto.registrationDeadline !== undefined)
      patch['registrationDeadline'] = dto.registrationDeadline;

    if (Object.keys(patch).length === 0) return { ok: true };

    const updated = await this.categoryModel
      .findByIdAndUpdate(cid, { $set: patch }, { returnDocument: 'after' })
      .exec();
    if (!updated) throw new NotFoundException('Hạng mục không tồn tại.');

    return this.safeCategory(updated);
  }

  // ---------------------------------------------------------------------------
  // Registration lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Open registration: not_open → open.
   * Sets openedAt timestamp.
   */
  async openRegistration(cid: string) {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    if (category.registrationStatus !== 'not_open') {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Không thể mở từ trạng thái "${category.registrationStatus}". Chỉ có thể mở từ "not_open".`,
      );
    }

    await this.categoryModel.updateOne(
      { _id: cid },
      { $set: { registrationStatus: 'open', openedAt: new Date() } },
    );
    return { ok: true, registrationStatus: 'open' };
  }

  /**
   * Close registration: open → closed.
   * Guard: pending registrations must be 0 before closing.
   *
   * TODO: wire pendingCount against the registrations collection once Phase 4
   * (registrations module) is built. Currently treats pending = 0 (no registrations exist).
   */
  async closeRegistration(cid: string) {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    if (category.registrationStatus !== 'open') {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Không thể đóng từ trạng thái "${category.registrationStatus}". Chỉ có thể đóng từ "open".`,
      );
    }

    // TODO (Phase 4): count pending registrations for this category and reject if > 0.
    // const pendingCount = await registrationModel.countDocuments({ categoryId: cid, status: 'pending' });
    // if (pendingCount > 0) throw new DomainError('PENDING_REGISTRATIONS_EXIST', `Còn ${pendingCount} pending, vui lòng duyệt/từ chối hết.`);
    const pendingCount = 0; // Placeholder until registrations module exists.

    if (pendingCount > 0) {
      throw new DomainError(
        'PENDING_REGISTRATIONS_EXIST',
        `Còn ${pendingCount} pending, vui lòng duyệt/từ chối hết.`,
      );
    }

    await this.categoryModel.updateOne(
      { _id: cid },
      { $set: { registrationStatus: 'closed', closedAt: new Date() } },
    );
    return { ok: true, registrationStatus: 'closed' };
  }

  /**
   * Reopen registration: closed → open.
   * Guard: no active bracket may exist for this category.
   *
   * TODO (Phase 5): query brackets collection for { categoryId: cid, isActive: true }.
   * Currently treats active bracket = none (brackets module not yet built).
   */
  async reopenRegistration(cid: string) {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    if (category.registrationStatus !== 'closed') {
      throw new DomainError(
        'INVALID_LIFECYCLE_TRANSITION',
        `Không thể mở lại từ trạng thái "${category.registrationStatus}". Chỉ có thể mở lại từ "closed".`,
      );
    }

    // TODO (Phase 5): block reopen if bracket is active.
    // const activeBracket = await bracketModel.findOne({ categoryId: cid, isActive: true }).lean().exec();
    // if (activeBracket) throw new DomainError('BRACKET_ALREADY_ACTIVE', 'Không thể mở lại sau khi bốc thăm.');

    await this.categoryModel.updateOne(
      { _id: cid },
      { $set: { registrationStatus: 'open', openedAt: new Date() } },
    );
    return { ok: true, registrationStatus: 'open' };
  }

  /**
   * Delete a category.
   * Blocked if registrations exist.
   *
   * TODO (Phase 4): query registrations collection; currently allows delete (no registrations exist yet).
   */
  async delete(cid: string) {
    const category = await this.categoryModel.findById(cid).exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    // TODO (Phase 4): block deletion if any registration references this category.
    // const count = await registrationModel.countDocuments({ categoryId: cid });
    // if (count > 0) throw new DomainError('CATEGORY_HAS_REGISTRATIONS', 'Không thể xóa hạng mục đã có đăng ký.');

    await this.categoryModel.deleteOne({ _id: cid });
    return { ok: true };
  }

  /** List all categories for a tournament. */
  async listByTournament(tid: string) {
    const categories = await this.categoryModel
      .find({ tournamentId: tid })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return { categories: categories.map((c) => this.safeLean(c)) };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private safeCategory(doc: CategoryDocument) {
    return {
      id: doc._id.toHexString(),
      tournamentId: doc.tournamentId,
      code: doc.code,
      name: doc.name,
      playerCount: doc.playerCount,
      genderRequirement: doc.genderRequirement,
      format: doc.format,
      bestOf: doc.bestOf,
      fee: doc.fee,
      maxTeams: doc.maxTeams,
      registrationDeadline: doc.registrationDeadline,
      registrationStatus: doc.registrationStatus,
      openedAt: doc.openedAt?.toISOString() ?? null,
      closedAt: doc.closedAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  private safeLean(doc: {
    _id: { toHexString(): string };
    tournamentId: string;
    code: string;
    name: string;
    playerCount: 1 | 2;
    genderRequirement: string;
    format: string;
    bestOf: 1 | 3 | 5;
    fee: number;
    maxTeams: number;
    registrationDeadline: string;
    registrationStatus: string;
    openedAt?: Date;
    closedAt?: Date;
    createdAt?: Date;
  }) {
    return {
      id: doc._id.toHexString(),
      tournamentId: doc.tournamentId,
      code: doc.code,
      name: doc.name,
      playerCount: doc.playerCount,
      genderRequirement: doc.genderRequirement,
      format: doc.format,
      bestOf: doc.bestOf,
      fee: doc.fee,
      maxTeams: doc.maxTeams,
      registrationDeadline: doc.registrationDeadline,
      registrationStatus: doc.registrationStatus,
      openedAt: doc.openedAt?.toISOString() ?? null,
      closedAt: doc.closedAt?.toISOString() ?? null,
      createdAt: doc.createdAt?.toISOString() ?? null,
    };
  }
}
