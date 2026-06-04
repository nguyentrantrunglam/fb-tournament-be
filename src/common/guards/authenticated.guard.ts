import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Deny-by-default: requires an authenticated session unless the route is @Public().
 * Throws UnauthorizedException (401) — not ForbiddenException — so clients can
 * distinguish "not logged in" from "logged in but lacks permission" (403).
 * Replaces Firestore "isSignedIn()" rule. Registered globally in AppModule.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ isAuthenticated?: () => boolean }>();
    const authenticated =
      typeof req.isAuthenticated === 'function' && req.isAuthenticated();
    if (!authenticated) {
      throw new UnauthorizedException('Vui lòng đăng nhập để tiếp tục.');
    }
    return true;
  }
}
