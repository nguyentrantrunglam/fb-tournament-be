import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TOURNAMENT_ROLES_KEY,
  type TournamentRole,
} from '../../common/decorators/tournament-roles.decorator';
import {
  TournamentRole as TournamentRoleDoc,
  type TournamentRoleDocument,
} from '../../schemas/tournament-role.schema';
import {
  Registration,
  type RegistrationDocument,
} from '../../schemas/registration.schema';
import type { SessionUser } from '../../schemas/user.schema';

type RequestWithUser = {
  user?: SessionUser;
  params?: Record<string, string | undefined>;
};

/**
 * Guard for registration-scoped routes (e.g. POST /registrations/:rid/approve).
 *
 * Resolves the tournament from the registration document identified by :rid,
 * then checks whether the authenticated session user holds the required role
 * on that tournament. Mirrors CategoryTournamentRoleGuard but uses the
 * registrations collection as the indirection layer.
 *
 * Admin bypasses (globalRole === 'admin').
 */
@Injectable()
export class RegistrationTournamentRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(TournamentRoleDoc.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
    @InjectModel(Registration.name)
    private readonly registrationModel: Model<RegistrationDocument>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TournamentRole[]>(
      TOURNAMENT_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Vui lòng đăng nhập để tiếp tục.');

    if (user.globalRole === 'admin') return true;

    const rid = req.params?.['rid'];
    if (!rid) throw new NotFoundException('Registration param missing.');

    // Resolve tournament from the registration document.
    const reg = await this.registrationModel
      .findById(rid)
      .select('tournamentId')
      .lean()
      .exec();
    if (!reg) throw new NotFoundException('Đăng ký không tồn tại.');

    const tid = reg.tournamentId;

    const roleDoc = await this.roleModel
      .findOne({ tournamentId: tid, userId: user.id, role: { $in: required } })
      .lean()
      .exec();

    if (!roleDoc) {
      throw new ForbiddenException('Bạn không có quyền với giải đấu này.');
    }

    return true;
  }
}
