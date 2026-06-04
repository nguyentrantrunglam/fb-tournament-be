import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { FeesService } from './fees.service';
import { PatchFeesDto } from './dto/patch-fees.dto';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';

/**
 * Fees management endpoints — surface for the tournament organizer to view and
 * update payment configuration + per-category entry fees in one place.
 *
 * Both routes are organizer-only. The global AuthenticatedGuard already requires
 * a valid session; TournamentRoleGuard adds the per-tournament role check.
 */
@Controller('tournaments/:tid/fees')
@TournamentRoles('organizer')
@UseGuards(TournamentRoleGuard)
export class FeesController {
  constructor(private readonly feesService: FeesService) {}

  /**
   * Aggregate read: tournament paymentConfig + all category fee/status snapshots.
   * Mirrors the Firebase GET /tournaments/[id]/fees response shape.
   */
  @Get()
  getFeesOverview(@Param('tid') tid: string) {
    return this.feesService.getFeesOverview(tid);
  }

  /**
   * Atomic update: paymentConfig + bulk category fees in a single Mongo transaction.
   * Mirrors the Firebase PUT /tournaments/[id]/fees behaviour (renamed to PATCH
   * to follow REST partial-update convention used throughout this API).
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  patchFees(@Param('tid') tid: string, @Body() dto: PatchFeesDto) {
    return this.feesService.patchFees(tid, dto);
  }
}
