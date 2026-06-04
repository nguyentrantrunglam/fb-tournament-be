import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';
import { CategoryTournamentRoleGuard } from '../categories/category-tournament-role.guard';
import { RegistrationTournamentRoleGuard } from './registration-tournament-role.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../schemas/user.schema';
import { CreateSelfRegistrationDto } from './dto/create-self-registration.dto';
import { CreateOrganizerRegistrationDto } from './dto/create-organizer-registration.dto';
import { BulkRegistrationDto } from './dto/bulk-registration.dto';
import { RejectRegistrationDto } from './dto/reject-registration.dto';
import { SetSeedDto } from './dto/set-seed.dto';
import { TeamPhotoDto } from './dto/team-photo.dto';

@Controller()
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  // ---------------------------------------------------------------------------
  // Organizer — tournament-level routes
  // ---------------------------------------------------------------------------

  /**
   * List all registrations for a tournament (organizer only).
   * Returns masked PII (cccdLast4, phoneMasked) — full identity never exposed.
   */
  @Get('tournaments/:tid/registrations')
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  listByTournament(@Param('tid') tid: string) {
    return this.registrationsService.listByTournament(tid);
  }

  /**
   * Search users for partner picker (authenticated — no organizer role required).
   * Athletes use this to find partners before submitting a doubles registration.
   */
  @Get('tournaments/:tid/registration-search-users')
  searchUsersForPartner(
    @Param('tid') tid: string,
    @Query('q') q: string = '',
    @Query('gender') gender?: string,
  ) {
    return this.registrationsService.searchUsersForPartner(tid, q, gender);
  }

  /**
   * Bulk organizer registration — up to 50 rows, partial-commit semantics.
   * Returns { success: [...], errors: [...] } regardless of partial failures.
   */
  @Post('tournaments/:tid/registrations/bulk')
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  bulk(
    @Param('tid') tid: string,
    @Body() dto: BulkRegistrationDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.registrationsService.bulk(tid, dto, user.id);
  }

  // ---------------------------------------------------------------------------
  // Athlete — category-level self-registration
  // ---------------------------------------------------------------------------

  /**
   * Self-registration (authenticated athlete). No organizer role required.
   * Global AuthenticatedGuard ensures session is present.
   */
  @Post('categories/:cid/registrations')
  @HttpCode(HttpStatus.CREATED)
  createSelf(
    @Param('cid') cid: string,
    @Body() dto: CreateSelfRegistrationDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.registrationsService.createSelf(cid, user.id, dto);
  }

  /**
   * Organizer single registration — registers an athlete on their behalf.
   * CategoryTournamentRoleGuard resolves the tournament from the category.
   */
  @Post('categories/:cid/registrations/organizer')
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  createOrganizer(
    @Param('cid') cid: string,
    @Body() dto: CreateOrganizerRegistrationDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.registrationsService.createOrganizer(cid, dto, user.id);
  }

  // ---------------------------------------------------------------------------
  // Registration-scoped actions — organizer via RegistrationTournamentRoleGuard
  // ---------------------------------------------------------------------------

  @Post('registrations/:rid/approve')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  approve(@Param('rid') rid: string) {
    return this.registrationsService.approve(rid);
  }

  @Post('registrations/:rid/reject')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  reject(@Param('rid') rid: string, @Body() dto: RejectRegistrationDto) {
    return this.registrationsService.reject(rid, dto);
  }

  /**
   * Withdraw — authenticated only at route level; service enforces owner-or-organizer.
   * Global AuthenticatedGuard is sufficient here; the service checks ownership/role.
   */
  @Post('registrations/:rid/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@Param('rid') rid: string, @CurrentUser() user: SessionUser) {
    return this.registrationsService.withdraw(rid, user);
  }

  @Post('registrations/:rid/mark-paid')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  markPaid(@Param('rid') rid: string, @CurrentUser() user: SessionUser) {
    return this.registrationsService.markPaid(rid, user.id);
  }

  @Post('registrations/:rid/unmark-paid')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  unmarkPaid(@Param('rid') rid: string) {
    return this.registrationsService.unmarkPaid(rid);
  }

  @Patch('registrations/:rid/seed')
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  setSeed(@Param('rid') rid: string, @Body() dto: SetSeedDto) {
    return this.registrationsService.setSeed(rid, dto);
  }

  @Patch('registrations/:rid/team-photo')
  @TournamentRoles('organizer')
  @UseGuards(RegistrationTournamentRoleGuard)
  setTeamPhoto(@Param('rid') rid: string, @Body() dto: TeamPhotoDto) {
    return this.registrationsService.setTeamPhoto(rid, dto);
  }
}
