import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RefereesService } from './referees.service';
import { GrantRefereeDto } from './dto/grant-referee.dto';
import { InviteRefereeDto } from './dto/invite-referee.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';
import type { SessionUser } from '../../schemas/user.schema';

/**
 * Referee management endpoints — all organizer-only.
 * The global AuthenticatedGuard enforces a valid session on every route.
 * TournamentRoleGuard adds the per-tournament organizer check.
 *
 * Route layout:
 *   GET    /tournaments/:tid/referees           — list referees with court snapshot
 *   POST   /tournaments/:tid/referees           — grant referee by userId
 *   POST   /tournaments/:tid/referees/invite    — grant referee by email lookup
 *   DELETE /tournaments/:tid/referees/:userId   — revoke referee role
 *   GET    /tournaments/:tid/search-users?q=    — search users for add-referee flow
 */
@Controller('tournaments/:tid')
@TournamentRoles('organizer')
@UseGuards(TournamentRoleGuard)
export class RefereesController {
  constructor(private readonly refereesService: RefereesService) {}

  @Get('referees')
  listReferees(@Param('tid') tid: string) {
    return this.refereesService.listReferees(tid);
  }

  @Post('referees')
  @HttpCode(HttpStatus.CREATED)
  grantReferee(
    @Param('tid') tid: string,
    @Body() dto: GrantRefereeDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.refereesService.grantReferee(tid, dto, user.id);
  }

  /**
   * Invite by email — separate sub-route so the DTO validation is scoped
   * correctly and the route is unambiguous (not conflated with grant-by-id).
   */
  @Post('referees/invite')
  @HttpCode(HttpStatus.CREATED)
  inviteReferee(
    @Param('tid') tid: string,
    @Body() dto: InviteRefereeDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.refereesService.inviteRefereeByEmail(tid, dto, user.id);
  }

  @Delete('referees/:userId')
  @HttpCode(HttpStatus.OK)
  removeReferee(@Param('tid') tid: string, @Param('userId') userId: string) {
    return this.refereesService.removeReferee(tid, userId);
  }

  /**
   * Search users for the add-referee flow.
   * Returns minimal fields only — no email/nationalId/phone (PII rules).
   * Minimum query length of 2 chars is enforced in the service.
   */
  @Get('search-users')
  searchUsers(@Param('tid') tid: string, @Query('q') q: string = '') {
    return this.refereesService.searchUsers(tid, q);
  }
}
