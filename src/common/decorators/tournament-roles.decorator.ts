import { SetMetadata } from '@nestjs/common';

export type TournamentRole = 'organizer' | 'referee';

export const TOURNAMENT_ROLES_KEY = 'tournamentRoles';

/**
 * Requires the session user to hold one of `roles` on the tournament referenced by the
 * `:tid` (or `:tournamentId`) route param. Enforced by TournamentRoleGuard (implemented in Phase 3).
 */
export const TournamentRoles = (...roles: TournamentRole[]) =>
  SetMetadata(TOURNAMENT_ROLES_KEY, roles);
