import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import {
  Tournament,
  type TournamentDocument,
} from '../../schemas/tournament.schema';
import { Category, type CategoryDocument } from '../../schemas/category.schema';
import type { PatchFeesDto } from './dto/patch-fees.dto';

/**
 * Fees service — aggregates tournament paymentConfig + per-category fees.
 * Reuses existing Tournament + Category models; no duplicate schema logic.
 *
 * The PATCH operation uses a Mongo transaction so paymentConfig + all category
 * fee updates are atomic — no partial state if the DB write fails mid-batch.
 */
@Injectable()
export class FeesService {
  constructor(
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * GET /tournaments/:tid/fees (organizer).
   * Returns paymentConfig from the tournament + fee/registrationStatus per category.
   * Shape mirrors the Firebase /fees GET response used by the fees management UI.
   */
  async getFeesOverview(tid: string) {
    const [tournament, categories] = await Promise.all([
      this.tournamentModel.findById(tid).lean().exec(),
      this.categoryModel
        .find({ tournamentId: tid })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);

    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    return {
      paymentConfig: tournament.paymentConfig ?? null,
      categories: categories.map((c) => ({
        id: c._id.toHexString(),
        code: c.code,
        name: c.name,
        playerCount: c.playerCount,
        genderRequirement: c.genderRequirement,
        fee: c.fee,
        registrationStatus: c.registrationStatus,
      })),
    };
  }

  /**
   * PATCH /tournaments/:tid/fees (organizer).
   * Atomically updates paymentConfig on the tournament AND bulk-updates each
   * category fee in a single transaction. Either all writes succeed or none do.
   */
  async patchFees(tid: string, dto: PatchFeesDto) {
    const tournament = await this.tournamentModel.findById(tid).lean().exec();
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    // Validate all referenced category IDs belong to this tournament before starting
    // the transaction — fail fast, outside the session.
    const categoryIds = (dto.categoryFees ?? []).map((f) => f.id);
    if (categoryIds.length > 0) {
      const found = await this.categoryModel
        .find({ _id: { $in: categoryIds }, tournamentId: tid })
        .select('_id')
        .lean()
        .exec();

      if (found.length !== categoryIds.length) {
        const foundSet = new Set(found.map((c) => c._id.toHexString()));
        const missing = categoryIds.filter((id) => !foundSet.has(id));
        throw new NotFoundException(
          `Hạng mục không tồn tại: ${missing.join(', ')}`,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const tournamentPatch: Record<string, unknown> = {};
      if (dto.paymentConfig !== undefined) {
        tournamentPatch['paymentConfig'] = dto.paymentConfig;
      }

      if (Object.keys(tournamentPatch).length > 0) {
        await this.tournamentModel.findByIdAndUpdate(
          tid,
          { $set: tournamentPatch },
          { session },
        );
      }

      // Bulk-update each category fee. We use individual updateOne calls within
      // the same session — Mongoose doesn't support bulkWrite session param in all
      // versions, so individual ops are safer and still transactional.
      for (const { id, fee } of dto.categoryFees ?? []) {
        await this.categoryModel.updateOne(
          { _id: id, tournamentId: tid },
          { $set: { fee: Math.max(0, Math.floor(fee)) } },
          { session },
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return { ok: true };
  }
}
