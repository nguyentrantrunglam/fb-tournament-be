import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PresignUploadDto } from './dto/presign-upload.dto';

/**
 * Storage presign endpoint.
 * Global AuthenticatedGuard ensures only authenticated users can generate upload URLs.
 * Further scoping (tournaments/{tid}/...) is enforced by the service key validation.
 */
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /storage/presign
   * Returns { uploadUrl, publicUrl } for a client-side PUT to DigitalOcean Spaces.
   * Client uploads directly, then confirms the publicUrl via PATCH /tournaments/:tid.
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  presign(@Body() dto: PresignUploadDto) {
    return this.storageService.presign(dto);
  }
}
