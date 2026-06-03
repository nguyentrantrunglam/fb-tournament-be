import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentConfigDto } from '../../tournaments/dto/update-tournament.dto';

export class CategoryFeeItemDto {
  @IsMongoId()
  id!: string;

  /** Entry fee in VND. 0 = free. */
  @IsNumber()
  @Min(0)
  fee!: number;
}

/**
 * PATCH /tournaments/:tid/fees body.
 * Updates paymentConfig (optional) and bulk-updates per-category fees.
 * Both fields are optional so callers can patch only what they need.
 */
export class PatchFeesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentConfigDto)
  paymentConfig?: PaymentConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryFeeItemDto)
  categoryFees?: CategoryFeeItemDto[];
}
