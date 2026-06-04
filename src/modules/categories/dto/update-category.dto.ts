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

/**
 * Subset of fields editable via PATCH /categories/:cid.
 * Fields frozen once registrationStatus !== 'not_open': code, playerCount, genderRequirement.
 * Fee is always editable (does not affect existing registration fee snapshots).
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,12}$/, {
    message: 'Mã hạng mục không hợp lệ (^[A-Z0-9_-]{2,12}$)',
  })
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @IsEnum([1, 2])
  playerCount?: 1 | 2;

  @IsOptional()
  @IsEnum(['men_only', 'women_only', 'mixed_pair', 'unrestricted'])
  genderRequirement?: 'men_only' | 'women_only' | 'mixed_pair' | 'unrestricted';

  @IsOptional()
  @IsEnum(['single_elim', 'round_robin', 'group_ko'])
  format?: 'single_elim' | 'round_robin' | 'group_ko';

  @IsOptional()
  @IsInt()
  @IsEnum([1, 3, 5])
  bestOf?: 1 | 3 | 5;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(256)
  maxTeams?: number;

  @IsOptional()
  @IsString()
  registrationDeadline?: string;
}
