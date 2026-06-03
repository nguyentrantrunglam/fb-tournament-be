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
import { TOURNAMENT_ROLES_KEY, type TournamentRole } from '../../common/decorators/tournament-roles.decorator';
import type { GlobalRole } from '../../common/decorators/roles.decorator';
import { TournamentRole as TournamentRoleDoc, type TournamentRoleDocument } from '../../schemas/tournament-role.schema';
import { Category, type CategoryDocument } from '../../schemas/category.schema';
import type { SessionUser } from '../../schemas/user.schema';

type RequestWithUser = {
  user?: SessionUser;
  params?: Record<string, string | undefined>;
};

/**
 * Specialized guard for category-scoped routes (e.g. PATCH /categories/:cid).
 *
 * The base TournamentRoleGuard reads :tid directly from the route param.
 * Category routes use :cid instead, so we must first load the category document
 * to resolve its tournamentId, then check the caller's role on that tournament.
 *
 * Admin bypasses (globalRole === 'admin').
 */
@Injectable()
export class CategoryTournamentRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(TournamentRoleDoc.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TournamentRole[]>(TOURNAMENT_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Vui lòng đăng nhập để tiếp tục.');

    if ((user.globalRole as GlobalRole) === 'admin') return true;

    const cid = req.params?.['cid'];
    if (!cid) throw new NotFoundException('Category param missing.');

    // Resolve the tournament that owns this category.
    const category = await this.categoryModel.findById(cid).select('tournamentId').lean().exec();
    if (!category) throw new NotFoundException('Hạng mục không tồn tại.');

    const tid = category.tournamentId;

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
