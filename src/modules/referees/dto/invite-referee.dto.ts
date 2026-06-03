import { IsEmail } from 'class-validator';

/**
 * Body for POST /tournaments/:tid/referees/invite.
 * Looks up a user by email; if found, grants referee role.
 * MVP: invite requires an existing account — no out-of-band email sending.
 * Returns USER_NOT_FOUND (404) when no account matches, mirroring
 * the Firebase invite-referee route which throws 404 for unknown email/phone.
 */
export class InviteRefereeDto {
  @IsEmail()
  email!: string;
}
