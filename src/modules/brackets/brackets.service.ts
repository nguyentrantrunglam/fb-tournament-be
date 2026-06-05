import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { Bracket, type BracketDocument, type DrawHistoryEntry } from '../../schemas/bracket.schema';
import { Match, type MatchDocument } from '../../schemas/match.schema';
import { Category, type CategoryDocument } from '../../schemas/category.schema';
import {
  Registration,
  type RegistrationDocument,
} from '../../schemas/registration.schema';
import { User, type UserDocument } from '../../schemas/user.schema';
import { DomainError } from '../../common/domain-error';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { buildSkeleton } from '../../domain/bracket/build-skeleton';
import { fillDraw } from '../../domain/bracket/fill-draw';
import type { DrawReg, SkeletonConfig } from '../../domain/bracket/types';
import type { SessionUser } from '../../schemas/user.schema';
import type { CreateSkeletonDto } from './dto/create-skeleton.dto';
import { mapBracketToResponse } from './bracket-response.mapper';
import {
  matchPlanToDoc,
  buildPlanToStoredMapping,
  mapDomainError,
  validateAndExtractGroupConfig,
} from './bracket-service-helpers';

@Injectable()
export class BracketsService {
  constructor(
    @InjectModel(Bracket.name)
    private readonly bracketModel: Model<BracketDocument>,
    @InjectModel(Match.name)
    private readonly matchModel: Model<MatchDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Registration.name)
    private readonly registrationModel: Model<RegistrationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // Create skeleton
  // ---------------------------------------------------------------------------

  async createSkeleton(cid: string, dto: CreateSkeletonDto, _user: SessionUser) {
    const category = await this.categoryModel.findById(cid).lean().exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    if (category.registrationStatus !== 'closed') {
      throw new DomainError(
        'CATEGORY_NOT_CLOSED',
        'Hạng mục phải đóng đăng ký trước khi tạo lịch thi đấu.',
        409,
      );
    }

    const N = await this.registrationModel.countDocuments({
      categoryId: cid,
      status: 'approved',
    });

    if (N < 2) {
      throw new DomainError(
        'NOT_ENOUGH_PARTICIPANTS',
        'Cần ít nhất 2 đội đã được duyệt để tạo lịch thi đấu.',
        409,
      );
    }

    const format = category.format;
    let formatConfig: SkeletonConfig | undefined;

    if (format === 'group_ko') {
      formatConfig = validateAndExtractGroupConfig(dto, N);
      // Category.formatConfig write is deferred into the transaction below
      // so an abort does not leave Category mutated without a skeleton.
    }

    let plan;
    try {
      plan = buildSkeleton(cid, N, format, formatConfig);
    } catch (err) {
      mapDomainError(err);
      throw err;
    }

    const session = await this.connection.startSession();
    let insertedBracket: BracketDocument;
    try {
      session.startTransaction();

      // Persist group config on Category inside the transaction so an abort
      // does not leave Category mutated without a corresponding skeleton.
      if (format === 'group_ko' && formatConfig) {
        await this.categoryModel.updateOne(
          { _id: cid },
          { $set: { formatConfig } },
          { session },
        );
      }

      const existing = await this.bracketModel
        .findOne({ categoryId: cid, isActive: true })
        .session(session)
        .lean()
        .exec();

      if (existing) {
        if (existing.status === 'drawn') {
          throw new DomainError(
            'BRACKET_ALREADY_DRAWN',
            'Lịch thi đấu đã được bốc thăm. Không thể tạo lại skeleton.',
            409,
          );
        }
        await this.bracketModel.updateOne(
          { _id: existing._id },
          { $set: { isActive: false } },
          { session },
        );
        await this.matchModel.deleteMany(
          { bracketId: existing._id.toHexString() },
          { session },
        );
      }

      const [bracket] = await this.bracketModel.create(
        [
          {
            categoryId: cid,
            format,
            status: 'skeleton',
            drawVersion: 0,
            isActive: true,
            bracketSize: plan.bracketSize,
            rounds: plan.rounds,
            byes: plan.byes,
            formatConfig: formatConfig ?? undefined,
          },
        ],
        { session },
      );
      insertedBracket = bracket!;

      if (plan.matches.length > 0) {
        const matchDocs = plan.matches.map((m) =>
          matchPlanToDoc(m, insertedBracket._id.toHexString(), cid, format),
        );
        await this.matchModel.insertMany(matchDocs, { session });
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    this.realtime.emitToCategory(cid, 'bracket:skeleton', { categoryId: cid });

    const matches = await this.matchModel
      .find({ bracketId: insertedBracket._id.toHexString() })
      .lean()
      .exec();

    return mapBracketToResponse(insertedBracket, matches as MatchDocument[], category);
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  async draw(cid: string, user: SessionUser) {
    const category = await this.categoryModel.findById(cid).lean().exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    const activeBracket = await this.bracketModel
      .findOne({ categoryId: cid, isActive: true })
      .lean()
      .exec();

    if (!activeBracket) {
      throw new DomainError(
        'SKELETON_NOT_FOUND',
        'Chưa tạo cấu trúc lịch thi đấu. Vui lòng tạo skeleton trước.',
        404,
      );
    }

    // Defensive drift check: reject if group_ko config changed since skeleton was built.
    if (category.format === 'group_ko') {
      const storedCfg = activeBracket.formatConfig;
      const catCfg = category.formatConfig;
      const storedGC = storedCfg?.groupCount;
      const storedQPG = storedCfg?.qualifyPerGroup;
      const catGC = catCfg?.['groupCount'] as number | undefined;
      const catQPG = catCfg?.['qualifyPerGroup'] as number | undefined;
      if (storedGC !== catGC || storedQPG !== catQPG) {
        throw new DomainError(
          'BRACKET_STRUCTURE_MISMATCH',
          'Cấu hình nhóm đã thay đổi kể từ khi tạo skeleton. Vui lòng tạo lại skeleton.',
          409,
        );
      }
    }

    const approvedRegs = await this.registrationModel
      .find({ categoryId: cid, status: 'approved' })
      .lean()
      .exec();

    const N = approvedRegs.length;
    if (N < 2) {
      throw new DomainError('NOT_ENOUGH_PARTICIPANTS', 'Cần ít nhất 2 đội đã được duyệt.', 409);
    }

    const drawRegs = await this.buildDrawRegs(approvedRegs);

    const config: SkeletonConfig | undefined =
      category.format === 'group_ko' && category.formatConfig
        ? {
            groupCount: category.formatConfig['groupCount'] as number | undefined,
            qualifyPerGroup: category.formatConfig['qualifyPerGroup'] as number | undefined,
          }
        : undefined;

    let rebuiltPlan;
    try {
      rebuiltPlan = buildSkeleton(cid, N, category.format, config);
    } catch (err) {
      mapDomainError(err);
      throw err;
    }

    const storedMatches = await this.matchModel
      .find({ bracketId: activeBracket._id.toHexString() })
      .lean()
      .exec();

    if (rebuiltPlan.matches.length !== storedMatches.length) {
      throw new DomainError(
        'BRACKET_STRUCTURE_MISMATCH',
        'Số trận đấu thay đổi kể từ khi tạo skeleton. Vui lòng tạo lại skeleton.',
        409,
      );
    }

    let filledPlan;
    try {
      filledPlan = fillDraw(rebuiltPlan, drawRegs);
    } catch (err) {
      mapDomainError(err);
      throw err;
    }

    const planToStoredId = buildPlanToStoredMapping(filledPlan.matches, storedMatches as MatchDocument[]);

    // Build seed snapshot: registrationId → assigned seed from the filled matches.
    const seedSnapshot: Record<string, number> = {};
    for (const m of filledPlan.matches) {
      if (m.sideA?.registrationId && m.sideA.seed != null) {
        seedSnapshot[m.sideA.registrationId] = m.sideA.seed;
      }
      if (m.sideB?.registrationId && m.sideB.seed != null) {
        seedSnapshot[m.sideB.registrationId] = m.sideB.seed;
      }
    }
    const hasAnySeeds = Object.keys(seedSnapshot).length > 0;
    const drawMode: 'seeded' | 'random' = hasAnySeeds ? 'seeded' : 'random';

    const session = await this.connection.startSession();
    let updatedBracket: BracketDocument;
    try {
      session.startTransaction();

      const newDrawVersion = (activeBracket.drawVersion ?? 0) + 1;

      for (const planMatch of filledPlan.matches) {
        const storedId = planToStoredId.get(planMatch.id);
        if (!storedId) continue;
        await this.matchModel.updateOne(
          { _id: storedId },
          {
            $set: {
              sideA: planMatch.sideA,
              sideB: planMatch.sideB,
              status: planMatch.status,
              winnerSide: planMatch.winnerSide,
              isBye: planMatch.isBye,
            },
          },
          { session },
        );
      }

      const historyEntry: DrawHistoryEntry = {
        drawVersion: newDrawVersion,
        seedSnapshot,
        mode: drawMode,
        drawnAt: new Date(),
        drawnByUserId: user.id,
      };

      await this.bracketModel.updateOne(
        { _id: activeBracket._id },
        {
          $set: {
            status: 'drawn',
            drawVersion: newDrawVersion,
            drawnAt: historyEntry.drawnAt,
            drawnByUserId: user.id,
          },
          $push: { drawHistory: historyEntry },
        },
        { session },
      );

      await session.commitTransaction();
      const updatedDoc = await this.bracketModel.findById(activeBracket._id).lean().exec();
      updatedBracket = updatedDoc as unknown as BracketDocument;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    this.realtime.emitToCategory(cid, 'bracket:drawn', {
      categoryId: cid,
      drawVersion: updatedBracket.drawVersion,
    });

    const finalMatches = await this.matchModel
      .find({ bracketId: activeBracket._id.toHexString() })
      .lean()
      .exec();

    return mapBracketToResponse(updatedBracket, finalMatches as MatchDocument[], category);
  }

  // ---------------------------------------------------------------------------
  // Get active bracket
  // ---------------------------------------------------------------------------

  async getActive(cid: string) {
    const category = await this.categoryModel.findById(cid).lean().exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    const bracket = await this.bracketModel
      .findOne({ categoryId: cid, isActive: true })
      .lean()
      .exec();

    if (!bracket) {
      throw new DomainError('SKELETON_NOT_FOUND', 'Chưa có lịch thi đấu cho hạng mục này.', 404);
    }

    const matches = await this.matchModel
      .find({ bracketId: bracket._id.toHexString() })
      .lean()
      .exec();

    return mapBracketToResponse(bracket as unknown as BracketDocument, matches as MatchDocument[], category);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async buildDrawRegs(
    regs: RegistrationDocument[],
  ): Promise<DrawReg[]> {
    const userIds = new Set<string>();
    for (const r of regs) {
      userIds.add(r.primaryUserId);
      if (r.partnerUserId) userIds.add(r.partnerUserId);
    }
    const users = await this.userModel
      .find({ _id: { $in: [...userIds] } })
      .select('displayName')
      .lean()
      .exec();
    const userMap = new Map(users.map((u) => [u._id.toHexString(), u.displayName]));
    return regs.map((r) => ({
      registrationId: r._id.toHexString(),
      seed: r.seed ?? null,
      name: userMap.get(r.primaryUserId) ?? 'Unknown',
      partnerName: r.partnerUserId ? (userMap.get(r.partnerUserId) ?? null) : null,
    }));
  }
}
