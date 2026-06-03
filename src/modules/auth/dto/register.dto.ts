import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NATIONAL_ID_REGEX } from '../../../domain/validation/national-id-format';

export class RegisterDto {
  @IsEmail()
  email!: string;

  /** Minimum 8 characters — bcrypt is applied before storage. */
  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName!: string;

  /** Vietnamese CCCD (post-2021): exactly 12 digits. */
  @Matches(NATIONAL_ID_REGEX, { message: 'nationalId phải đủ 12 chữ số' })
  nationalId!: string;

  @IsEnum(['male', 'female'])
  gender!: 'male' | 'female';

  /** ISO date string YYYY-MM-DD. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob phải theo định dạng YYYY-MM-DD' })
  dob!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
