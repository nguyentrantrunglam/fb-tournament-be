import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as no-auth (skips AuthenticatedGuard). Used by the public/* read endpoints. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
