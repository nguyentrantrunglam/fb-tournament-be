import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';

/**
 * CRUD for courts under a tournament.
 * All write operations require the caller to be an organizer of :tid.
 * GET (list) is open to any authenticated user (global AuthenticatedGuard covers it).
 * Guards are per-route so that the read endpoint is not gated by role.
 */
@Controller('tournaments/:tid/courts')
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  /** List courts — open to any authenticated session. */
  @Get()
  listByTournament(@Param('tid') tid: string) {
    return this.courtsService.listByTournament(tid);
  }

  /** Create a court. Organizer only. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  create(@Param('tid') tid: string, @Body() dto: CreateCourtDto) {
    return this.courtsService.create(tid, dto);
  }

  /** Update court name. Organizer only. */
  @Patch(':cid')
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  update(
    @Param('tid') tid: string,
    @Param('cid') cid: string,
    @Body() dto: UpdateCourtDto,
  ) {
    return this.courtsService.update(tid, cid, dto);
  }

  /** Delete court. Blocked if currentMatchId is set (match in progress). Organizer only. */
  @Delete(':cid')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  delete(@Param('tid') tid: string, @Param('cid') cid: string) {
    return this.courtsService.delete(tid, cid);
  }
}
