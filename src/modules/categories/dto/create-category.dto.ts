import {
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class CreateCategoryDto {
  /** Short code e.g. "MS", "WD", "XD". Uppercase alphanumeric + underscore/dash, 2-12 chars. */
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,12}$/, { message: 'Mã hạng mục không hợp lệ (^[A-Z0-9_-]{2,12}$)' })
  code!: string;

  @IsString()
  name!: string;

  @IsInt()
  @IsEnum([1, 2])
  playerCount!: 1 | 2;

  @IsEnum(['men_only', 'women_only', 'mixed_pair', 'unrestricted'])
  genderRequirement!: 'men_only' | 'women_only' | 'mixed_pair' | 'unrestricted';

  @IsOptional()
  @IsEnum(['single_elim', 'round_robin', 'group_ko'])
  format?: 'single_elim' | 'round_robin' | 'group_ko';

  @IsInt()
  @IsEnum([1, 3, 5])
  bestOf!: 1 | 3 | 5;

  @IsNumber()
  @Min(0)
  fee!: number;

  @IsInt()
  @Min(2)
  @Max(256)
  maxTeams!: number;

  /** ISO datetime string — must be in the future (enforced at service layer). */
  @IsString()
  registrationDeadline!: string;
}
