import { IsString, Matches } from 'class-validator';

export class PresignUploadDto {
  /**
   * Object key within the bucket. Must start with tournaments/{tid}/
   * to prevent unauthorized upload into arbitrary paths.
   * Validated by regex at service layer (not DTO) to give a clear DomainError code.
   */
  @IsString()
  key!: string;

  /** MIME type sent as Content-Type constraint in the presigned PUT. e.g. image/jpeg */
  @IsString()
  @Matches(/^[\w-]+\/[\w.+-]+$/, { message: 'contentType không hợp lệ.' })
  contentType!: string;
}
