import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Court, type CourtDocument } from '../../schemas/court.schema';
import { DomainError } from '../../common/domain-error';
import type { CreateCourtDto } from './dto/create-court.dto';
import type { UpdateCourtDto } from './dto/update-court.dto';

@Injectable()
export class CourtsService {
  constructor(
    @InjectModel(Court.name)
    private readonly courtModel: Model<CourtDocument>,
  ) {}

  async create(tid: string, dto: CreateCourtDto) {
    const court = await this.courtModel.create({
      tournamentId: tid,
      name: dto.name.trim(),
      status: 'available',
    });
    return this.safeCourt(court);
  }

  async update(tid: string, cid: string, dto: UpdateCourtDto) {
    const court = await this.courtModel
      .findOne({ _id: cid, tournamentId: tid })
      .exec();
    if (!court)
      throw new NotFoundException('Sân không tồn tại trong giải đấu này.');

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch['name'] = dto.name.trim();

    if (Object.keys(patch).length === 0) return this.safeCourt(court);

    const updated = await this.courtModel
      .findByIdAndUpdate(cid, { $set: patch }, { returnDocument: 'after' })
      .exec();
    if (!updated) throw new NotFoundException('Sân không tồn tại.');
    return this.safeCourt(updated);
  }

  /**
   * Delete a court.
   * Blocked when currentMatchId is set — a match is active on this court.
   * The match-assignment flow (Phase 5+) sets and clears currentMatchId.
   */
  async delete(tid: string, cid: string) {
    const court = await this.courtModel
      .findOne({ _id: cid, tournamentId: tid })
      .exec();
    if (!court)
      throw new NotFoundException('Sân không tồn tại trong giải đấu này.');

    if (court.currentMatchId) {
      throw new DomainError(
        'COURT_HAS_ACTIVE_MATCH',
        'Không thể xóa sân đang có trận đấu được gán.',
      );
    }

    await this.courtModel.deleteOne({ _id: cid });
    return { ok: true };
  }

  async listByTournament(tid: string) {
    const courts = await this.courtModel
      .find({ tournamentId: tid })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return { courts: courts.map((c) => this.safeLean(c)) };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private safeCourt(doc: CourtDocument) {
    return {
      id: doc._id.toHexString(),
      tournamentId: doc.tournamentId,
      name: doc.name,
      status: doc.status,
      currentRefereeUserId: doc.currentRefereeUserId ?? null,
      currentMatchId: doc.currentMatchId ?? null,
    };
  }

  private safeLean(doc: {
    _id: { toHexString(): string };
    tournamentId: string;
    name: string;
    status: string;
    currentRefereeUserId?: string;
    currentMatchId?: string;
  }) {
    return {
      id: doc._id.toHexString(),
      tournamentId: doc.tournamentId,
      name: doc.name,
      status: doc.status,
      currentRefereeUserId: doc.currentRefereeUserId ?? null,
      currentMatchId: doc.currentMatchId ?? null,
    };
  }
}
