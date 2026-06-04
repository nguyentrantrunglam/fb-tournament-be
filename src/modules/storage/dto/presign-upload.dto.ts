import { IsIn, IsString } from 'class-validator';

/** Image MIME types accepted for tournament asset uploads (banner, logo). */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export class PresignUploadDto {
  /**
   * Object key within the bucket. Must start with tournaments/{tid}/
   * to prevent unauthorized upload into arbitrary paths.
   * Validated by regex at service layer (not DTO) to give a clear DomainError code.
   */
  @IsString()
  key!: string;

  /**
   * MIME type sent as Content-Type constraint in the presigned PUT.
   * Restricted to image types only — prevents arbitrary file hosting via public-read ACL.
   */
  @IsIn(ALLOWED_IMAGE_TYPES, {
    message:
      'contentType không hợp lệ. Chỉ chấp nhận image/jpeg, image/png, image/webp.',
  })
  contentType!: AllowedImageType;
}
