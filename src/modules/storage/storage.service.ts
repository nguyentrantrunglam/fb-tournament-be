import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config/configuration';
import { DomainError } from '../../common/domain-error';
import { TournamentRole, type TournamentRoleDocument } from '../../schemas/tournament-role.schema';
import type { SessionUser } from '../../schemas/user.schema';
import { ALLOWED_IMAGE_TYPES } from './dto/presign-upload.dto';
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

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @InjectModel(TournamentRole.name)
    private readonly roleModel: Model<TournamentRoleDocument>,
  ) {
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
   *
   * Authorization (C1): caller must be organizer of the tournament whose id is embedded
   * in the key prefix tournaments/{tid}/... — admin bypasses this check.
   *
   * Content-type restriction (C2): only image/* types are accepted to prevent arbitrary
   * file hosting through the public-read ACL on the bucket.
   *
   * Returns { uploadUrl, publicUrl } — client PUTs to uploadUrl, then POSTs publicUrl
   * back to the tournament/category API to persist the reference.
   */
  async presign(
    dto: PresignUploadDto,
    caller: SessionUser,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    // C2 — whitelist image types (DTO @IsIn already blocks this, service enforces as well).
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(dto.contentType)) {
      throw new DomainError(
        'INVALID_CONTENT_TYPE',
        'Loại file không được hỗ trợ. Chỉ chấp nhận image/jpeg, image/png, image/webp.',
      );
    }

    // Block path traversal before any further parsing.
    if (dto.key.includes('..')) {
      throw new DomainError('INVALID_STORAGE_KEY', 'Storage key không hợp lệ.');
    }

    // C1 — extract tournament id from key prefix tournaments/{tid}/...
    const tidMatch = /^tournaments\/([^/]+)\//.exec(dto.key);
    if (!tidMatch) {
      throw new DomainError(
        'INVALID_STORAGE_KEY',
        'Storage key phải có prefix "tournaments/{tid}/...".',
      );
    }
    const tid = tidMatch[1];

    // C1 — admin bypasses per-tournament role check; others must be organizer.
    if (caller.globalRole !== 'admin') {
      const hasRole = await this.roleModel.exists({
        tournamentId: tid,
        userId: caller.id,
        role: 'organizer',
      });
      if (!hasRole) {
        throw new DomainError(
          'FORBIDDEN',
          'Bạn không phải organizer của giải đấu này.',
          403,
        );
      }
    }

    if (!this.client) {
      throw new DomainError(
        'SPACES_NOT_CONFIGURED',
        'File storage (DigitalOcean Spaces) is not configured in this environment.',
        501,
      );
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
