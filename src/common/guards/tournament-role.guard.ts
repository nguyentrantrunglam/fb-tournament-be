import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TOURNAMENT_ROLES_KEY,
  type TournamentRole,
} from '../decorators/tournament-roles.decorator';
import type { GlobalRole } from '../decorators/roles.decorator';
import {
  TournamentRole as TournamentRoleDoc,
  type TournamentRoleDocument,
} from '../../schemas/tournament-role.schema';
import type { SessionUser } from '../../schemas/user.schema';

type RequestWithUser = {
  user?: SessionUser;
  params?: Record<string, string | undefined>;
};

/**
 * Per-tournament authorization guard. Replaces the Phase 1 stub.
 *
 * Reads the `:tid` (or `:tournamentId`) route param and checks whether the
 * authenticated session user holds at least one of the required @TournamentRoles
 * on that tournament in the `tournamentRoles` collection.
 *
 * Admin bypasses the per-tournament check (global override).
 *
 * Registration: inject via module providers, NOT as a global guard. This guard
 * requires @InjectModel(TournamentRole.name) which must be provided by the
 * consuming module (TournamentsModule, CategoriesModule, CourtsModule all import
 * TournamentRolesModule which exports the model + this guard).
 */
@Injectable()
export class TournamentRoleGuard implements CanActivate {
  private readonly logger = new Logger('TournamentRoleGuard');

  constructor(
    private readonly reflector: Reflector,
    @InjectModel(TournamentRoleDoc.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TournamentRole[]>(
      TOURNAMENT_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // No @TournamentRoles annotation — guard is a no-op.
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;

    // AuthenticatedGuard runs before this guard (global), so user is always present here.
    // Defensive check in case guard ordering changes.
    if (!user) {
      throw new ForbiddenException('Vui lòng đăng nhập để tiếp tục.');
    }

    // Admin bypasses per-tournament role check (global privilege).
    if (user.globalRole === 'admin') return true;

    const tid = req.params?.['tid'] ?? req.params?.['tournamentId'];
    if (!tid) {
      // Guard applied to a route without :tid/:tournamentId param — config error.
      this.logger.error(
        'TournamentRoleGuard: no :tid or :tournamentId param found on route',
      );
      throw new NotFoundException('Tournament param missing.');
    }

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
