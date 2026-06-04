import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Injects the authenticated session user (req.user) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
    return req.user;
  },
);
