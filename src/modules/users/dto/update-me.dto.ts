import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Fields an authenticated user may update on their own profile.
 * nationalId, gender, dob, email and globalRole are locked — they are never accepted here.
 */
export class UpdateMeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
