import { IsEnum, IsMongoId } from 'class-validator';
import type { TournamentRoleValue } from '../../../schemas/tournament-role.schema';

export class GrantTournamentRoleDto {
  @IsMongoId()
  userId!: string;

  @IsEnum(['organizer', 'referee'])
  role!: TournamentRoleValue;
}
