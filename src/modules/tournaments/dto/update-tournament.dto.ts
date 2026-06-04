import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsEnum,
  MaxLength,
  IsUrl,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const SPONSOR_TIERS = [
  'diamond',
  'gold',
  'silver',
  'operator',
  'media',
] as const;
type SponsorTier = (typeof SPONSOR_TIERS)[number];

export class SponsorDto {
  @IsString()
  id!: string;

  @IsEnum(SPONSOR_TIERS)
  tier!: SponsorTier;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class PaymentConfigDto {
  @IsString()
  accountHolder!: string;

  @IsString()
  accountNumber!: string;

  @IsString()
  bankCode!: string;

  @IsString()
  transferMemoTemplate!: string;

  @IsOptional()
  @IsString()
  qrUrl?: string;
}

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  // Slug is user-editable (UI: "tự sinh, có thể sửa"). Uniqueness enforced by the
  // unique index → E11000 mapped to SLUG_ALREADY_USED by DomainExceptionFilter.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug chỉ gồm chữ thường, số và dấu gạch ngang.',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  rulesText?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SponsorDto)
  sponsors?: SponsorDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentConfigDto)
  paymentConfig?: PaymentConfigDto;
}
