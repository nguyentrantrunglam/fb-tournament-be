import { IsEnum, IsString } from 'class-validator';
import type { TournamentRoleValue } from '../../../schemas/tournament-role.schema';

export class GrantTournamentRoleDto {
  @IsString()
  userId!: string;

  @IsEnum(['organizer', 'referee'])
  role!: TournamentRoleValue;
}
