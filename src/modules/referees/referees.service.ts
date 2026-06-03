import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tournament, type TournamentDocument } from '../../schemas/tournament.schema';
import {
  TournamentRole,
  type TournamentRoleDocument,
} from '../../schemas/tournament-role.schema';
import { User, type UserDocument } from '../../schemas/user.schema';
import { Court, type CourtDocument } from '../../schemas/court.schema';
import { DomainError } from '../../common/domain-error';
import type { GrantRefereeDto } from './dto/grant-referee.dto';
import type { InviteRefereeDto } from './dto/invite-referee.dto';

/**
 * Referee management service.
 *
 * Role grant/revoke reuses the same TournamentRole collection used by
 * TournamentsService.grantRole — no separate collection or schema needed.
 *
 * Search returns only {id, displayName, gender, avatarUrl} — never email,
 * nationalId, or phone (PII rules mirror the Firebase search-users route).
 */
@Injectable()
export class RefereesService {
  constructor(
    @InjectModel(Tournament.name)
    private readonly tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentRole.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Court.name)
    private readonly courtModel: Model<CourtDocument>,
  ) {}

  /**
   * GET /tournaments/:tid/referees (organizer).
   * Lists users holding role 'referee' on the tournament, joined with their
   * user profile (sanitized — no PII). Also returns which court each referee
   * is currently assigned to (mirrors Firebase courtsByReferee aggregation).
   */
  async listReferees(tid: string) {
    const tournament = await this.tournamentModel.findById(tid).lean().exec();
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    const roleDocs = await this.roleModel
      .find({ tournamentId: tid, role: 'referee' })
      .lean()
      .exec();

    if (roleDocs.length === 0) return { referees: [] };

    // Build referee-to-court mapping (court.currentRefereeUserId snapshot).
    const courts = await this.courtModel
      .find({ tournamentId: tid, currentRefereeUserId: { $exists: true, $ne: null } })
      .select('name currentRefereeUserId')
      .lean()
      .exec();

    const courtsByReferee: Record<string, string[]> = {};
    for (const court of courts) {
      const uid = court.currentRefereeUserId!;
      courtsByReferee[uid] ??= [];
      courtsByReferee[uid].push(court.name);
    }

    const userIds = roleDocs.map((r) => r.userId);
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('displayName avatarUrl gender')
      .lean()
      .exec();

    const userById: Record<string, typeof users[number]> = {};
    for (const u of users) userById[u._id.toHexString()] = u;

    const referees = roleDocs.map((role) => {
      const user = userById[role.userId];
      return {
        userId: role.userId,
        displayName: user?.displayName ?? '',
        avatarUrl: user?.avatarUrl ?? null,
        gender: user?.gender ?? null,
        assignedCourts: courtsByReferee[role.userId] ?? [],
        grantedAt: role.grantedAt,
      };
    });

    return { referees };
  }

  /**
   * POST /tournaments/:tid/referees (organizer).
   * Grants referee role to an existing user by userId.
   * Reuses the same E11000 → TOURNAMENT_ROLE_ALREADY_GRANTED mapping from
   * DomainExceptionFilter (compound unique index on tournamentRoles).
   */
  async grantReferee(tid: string, dto: GrantRefereeDto, grantedBy: string) {
    const [tournament, userExists] = await Promise.all([
      this.tournamentModel.findById(tid).lean().exec(),
      this.userModel.exists({ _id: dto.userId }),
    ]);

    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');
    if (!userExists) {
      throw new DomainError('USER_NOT_FOUND', 'Người dùng không tồn tại.', 404);
    }

    await this.roleModel.create({
      tournamentId: tid,
      userId: dto.userId,
      role: 'referee',
      grantedAt: new Date(),
      grantedByUserId: grantedBy,
    });

    return { ok: true };
  }

  /**
   * POST /tournaments/:tid/referees/invite (organizer).
   * Looks up an existing user by email and grants them the referee role.
   *
   * Firebase behaviour (mirrored): the invite-referee route accepted emailOrPhone,
   * did a Firebase Auth lookup, then set the role doc. If no account matched,
   * it returned 404. This NestJS implementation accepts email only (no phone
   * lookup needed — users register with email here, not phone). If no user
   * account matches the email, USER_NOT_FOUND (404) is returned, matching
   * the Firebase semantics. No out-of-band email is sent (MVP scope).
   */
  async inviteRefereeByEmail(tid: string, dto: InviteRefereeDto, grantedBy: string) {
    const tournament = await this.tournamentModel.findById(tid).lean().exec();
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại.');

    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase().trim() })
      .select('_id')
      .lean()
      .exec();

    if (!user) {
      throw new DomainError(
        'USER_NOT_FOUND',
        'Không tìm thấy tài khoản với email này.',
        404,
      );
    }

    // Reuse grant logic — E11000 from compound unique index → TOURNAMENT_ROLE_ALREADY_GRANTED.
    await this.roleModel.create({
      tournamentId: tid,
      userId: user._id.toHexString(),
      role: 'referee',
      grantedAt: new Date(),
      grantedByUserId: grantedBy,
    });

    return { ok: true, userId: user._id.toHexString() };
  }

  /**
   * DELETE /tournaments/:tid/referees/:userId (organizer).
   * Removes the referee role doc for the given user.
   *
   * Guard note: if the referee is currently assigned to a court
   * (court.currentRefereeUserId === userId), we allow deletion anyway
   * and leave a TODO — Firebase did not enforce this constraint, so we
   * mirror that permissive behaviour. The court field becomes a stale
   * snapshot until cleared by the court-assignment flow.
   *
   * TODO: once live match operation exists, block removal when the referee is
   * bound to a court with an in-progress match (currentMatchId set).
   */
  async removeReferee(tid: string, userId: string) {
    const result = await this.roleModel.deleteOne({
      tournamentId: tid,
      userId,
      role: 'referee',
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Trọng tài không tồn tại trong giải đấu này.');
    }

    return { ok: true };
  }

  /**
   * GET /tournaments/:tid/search-users?q= (organizer).
   * Regex search across displayName. Returns minimal fields only:
   * {id, displayName, gender, avatarUrl} — NO email, nationalId, or phone.
   *
   * Regex metacharacters in q are escaped to prevent ReDoS.
   * Min query length: 2 characters. Result cap: 15.
   * Excludes users who already hold the referee role on this tournament.
   */
  async searchUsers(tid: string, q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return { users: [] };

    // Escape regex metacharacters to prevent ReDoS (OWASP CWE-1333).
    const safe = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safe, 'i');

    // Find user IDs already holding the referee role → exclude from results.
    const existingRoles = await this.roleModel
      .find({ tournamentId: tid, role: 'referee' })
      .select('userId')
      .lean()
      .exec();
    const excludedIds = existingRoles.map((r) => r.userId);

    // Match by displayName OR email OR nationalId so an organizer can find someone
    // by their exact email/CCCD (parity with the old search). Those fields are
    // matched but NEVER returned (see select + map below — PII stays hidden).
    const users = await this.userModel
      .find({
        _id: { $nin: excludedIds },
        $or: [
          { displayName: { $regex: regex } },
          { email: { $regex: regex } },
          { 'identity.nationalId': { $regex: regex } },
        ],
      })
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
        // email, nationalId, phone are intentionally omitted (PII rules).
      })),
    };
  }
}
