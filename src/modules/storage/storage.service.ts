import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config/configuration';
import { DomainError } from '../../common/domain-error';
import type { PresignUploadDto } from './dto/presign-upload.dto';

/** Presigned PUT URL TTL in seconds. Short window limits exposure if URL leaks. */
const PRESIGN_TTL_SECONDS = 300; // 5 minutes

/**
 * DigitalOcean Spaces presign service.
 * Client uploads directly to Spaces via presigned PUT URL, then confirms
 * the public URL back to the API via PATCH /tournaments/:tid (bannerUrl, logoUrl, etc.).
 *
 * If Spaces credentials are not configured (local dev without Spaces), the service
 * throws SPACES_NOT_CONFIGURED (501) instead of crashing or returning an invalid URL.
 */
@Injectable()
export class StorageService {
  private client: S3Client | null = null;
  private bucket = '';
  private endpoint = '';

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const spaces = this.config.get('spaces', { infer: true });

    if (spaces.key && spaces.secret && spaces.endpoint && spaces.bucket) {
      this.client = new S3Client({
        endpoint: spaces.endpoint,
        region: spaces.region || 'us-east-1',
        credentials: { accessKeyId: spaces.key, secretAccessKey: spaces.secret },
        forcePathStyle: false, // Spaces uses virtual-hosted-style URLs.
      });
      this.bucket = spaces.bucket;
      this.endpoint = spaces.endpoint;
    }
  }

  /**
   * Generate a presigned PUT URL for a client-side upload.
   * Key must be prefixed with tournaments/{tid}/ to scope uploads to a tournament.
   * Content-Type is constrained so the bucket cannot be used for arbitrary file types.
   *
   * Returns { uploadUrl, publicUrl } — client PUTs to uploadUrl, then POSTs publicUrl
   * back to the tournament/category API to persist the reference.
   */
  async presign(dto: PresignUploadDto): Promise<{ uploadUrl: string; publicUrl: string }> {
    if (!this.client) {
      throw new DomainError(
        'SPACES_NOT_CONFIGURED',
        'File storage (DigitalOcean Spaces) is not configured in this environment.',
        501,
      );
    }

    // Key must be scoped to tournaments/{tid}/... to prevent cross-tournament writes.
    if (!/^tournaments\/[^/]+\//.test(dto.key)) {
      throw new DomainError(
        'INVALID_STORAGE_KEY',
        'Storage key phải có prefix "tournaments/{tid}/...".',
      );
    }

    // Block path traversal.
    if (dto.key.includes('..')) {
      throw new DomainError('INVALID_STORAGE_KEY', 'Storage key không hợp lệ.');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: dto.key,
      ContentType: dto.contentType,
      ACL: 'public-read',
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });

    // Public URL — Spaces serves objects at {endpoint}/{bucket}/{key}.
    const publicUrl = `${this.endpoint}/${this.bucket}/${dto.key}`;

    return { uploadUrl, publicUrl };
  }
}
