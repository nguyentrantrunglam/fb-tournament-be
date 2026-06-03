import { IsBoolean } from 'class-validator';

export class TournamentVisibilityDto {
  @IsBoolean()
  isPublic!: boolean;
}
