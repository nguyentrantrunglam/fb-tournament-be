import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** Raw token from the reset email link — sha256 hashed before DB lookup. */
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
