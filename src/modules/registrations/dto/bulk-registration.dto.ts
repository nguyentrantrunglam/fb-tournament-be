import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class BulkRegistrationRowDto {
  @IsString()
  @IsMongoId()
  categoryId!: string;

  @IsString()
  @IsMongoId()
  primaryUserId!: string;

  @IsOptional()
  @IsString()
  @IsMongoId()
  partnerUserId?: string;
}

/** Bulk registration payload — up to 50 rows per request. */
export class BulkRegistrationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkRegistrationRowDto)
  rows!: BulkRegistrationRowDto[];
}
