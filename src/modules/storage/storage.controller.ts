import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../schemas/user.schema';

/**
 * Storage presign endpoint.
 * Global AuthenticatedGuard ensures only authenticated users can generate upload URLs.
 * Per-tournament organizer check (C1) is enforced in the service.
 */
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /storage/presign
   * Returns { uploadUrl, publicUrl } for a client-side PUT to DigitalOcean Spaces.
   * Caller must be organizer of the tournament whose id is in the key prefix (admin bypasses).
   * Only image/jpeg, image/png, image/webp are accepted (C2).
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  presign(@Body() dto: PresignUploadDto, @CurrentUser() caller: SessionUser) {
    return this.storageService.presign(dto, caller);
  }
}
