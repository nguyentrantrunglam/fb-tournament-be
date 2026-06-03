import {
  IsString,
  MinLength,
  IsDateString,
} from 'class-validator';

export class CreateTournamentDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MinLength(3)
  location!: string;
}
