import { SetMetadata } from '@nestjs/common';

export type GlobalRole = 'athlete' | 'organizer_capable' | 'admin';

export const ROLES_KEY = 'globalRoles';

/** Requires the session user's globalRole to be one of `roles` (checked by RolesGuard). */
export const Roles = (...roles: GlobalRole[]) => SetMetadata(ROLES_KEY, roles);
