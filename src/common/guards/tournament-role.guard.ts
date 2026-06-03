import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TOURNAMENT_ROLES_KEY, type TournamentRole } from '../decorators/tournament-roles.decorator';
import type { GlobalRole } from '../decorators/roles.decorator';

/**
 * STUB — full per-tournament role check is implemented in Phase 3 (reads the
 * `tournamentRoles` collection for req.user.id + the `:tid`/`:tournamentId` param).
 * For now: admin bypasses; everyone else is denied when a @TournamentRoles is required.
 * Unused until Phase 3 wires it onto tournament routes.
 */
@Injectable()
export class TournamentRoleGuard implements CanActivate {
  private readonly logger = new Logger('TournamentRoleGuard');

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TournamentRole[]>(TOURNAMENT_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: { globalRole?: GlobalRole } }>();
    if (req.user?.globalRole === 'admin') return true;

    this.logger.warn('TournamentRoleGuard hit before Phase 3 implementation — denying.');
    return false;
  }
}
