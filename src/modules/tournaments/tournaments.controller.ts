import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { TournamentVisibilityDto } from './dto/tournament-visibility.dto';
import { GrantTournamentRoleDto } from './dto/grant-tournament-role.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';
import type { SessionUser } from '../../schemas/user.schema';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  /**
   * Create a new tournament.
   * Requires globalRole = admin | organizer_capable (checked by RolesGuard).
   * The creator is automatically granted the organizer role on the new tournament.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin', 'organizer_capable')
  @UseGuards(RolesGuard)
  create(@Body() dto: CreateTournamentDto, @CurrentUser() user: SessionUser) {
    return this.tournamentsService.create(dto, user.id);
  }

  /**
   * List tournaments visible to the caller.
   * Admin sees all; others see owned + role-granted tournaments.
   * Global AuthenticatedGuard already enforces a session.
   */
  @Get('mine')
  listMine(@CurrentUser() user: SessionUser) {
    return this.tournamentsService.listMine(user.id, user.globalRole);
  }

  /**
   * Get a single tournament by id.
   * Visibility: owner / any tournament role / admin always; others only if isPublic.
   */
  @Get(':tid')
  getOne(@Param('tid') tid: string, @CurrentUser() user: SessionUser) {
    return this.tournamentsService.getOne(tid, user.id, user.globalRole);
  }

  /**
   * Update tournament detail (name, dates, location, banner, logo, rules, sponsors, payment).
   * Requires organizer role on this tournament (checked by TournamentRoleGuard).
   */
  @Patch(':tid')
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  update(@Param('tid') tid: string, @Body() dto: UpdateTournamentDto) {
    return this.tournamentsService.update(tid, dto);
  }

  /**
   * Toggle public visibility of the tournament.
   * Requires organizer role on this tournament.
   */
  @Patch(':tid/visibility')
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  setVisibility(
    @Param('tid') tid: string,
    @Body() dto: TournamentVisibilityDto,
  ) {
    return this.tournamentsService.setVisibility(tid, dto);
  }

  /**
   * Grant a user an organizer or referee role on this tournament.
   * Allowed for existing organizers (TournamentRoleGuard) and admins (bypass in guard).
   */
  @Post(':tid/roles')
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  grantRole(
    @Param('tid') tid: string,
    @Body() dto: GrantTournamentRoleDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.tournamentsService.grantRole(tid, dto, user.id);
  }
}
