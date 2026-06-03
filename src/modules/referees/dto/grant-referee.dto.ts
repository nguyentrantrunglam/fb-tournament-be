import { IsMongoId } from 'class-validator';

/**
 * Body for POST /tournaments/:tid/referees.
 * Grants referee role to an existing user by their MongoDB user ID.
 */
export class GrantRefereeDto {
  @IsMongoId()
  userId!: string;
}
