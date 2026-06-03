import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type GlobalRole } from '../decorators/roles.decorator';

/**
 * Checks the session user's globalRole against @Roles(...). Use AFTER AuthenticatedGuard.
 * Replaces Firestore "isAdmin()" / global-role checks.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<GlobalRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: { globalRole?: GlobalRole } }>();
    const role = req.user?.globalRole;
    return !!role && required.includes(role);
  }
}
