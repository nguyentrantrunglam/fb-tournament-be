import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BracketsService } from './brackets.service';
import { CreateSkeletonDto } from './dto/create-skeleton.dto';
import { DrawBracketDto } from './dto/draw-bracket.dto';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { CategoryTournamentRoleGuard } from '../categories/category-tournament-role.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../schemas/user.schema';

@Controller()
export class BracketsController {
  constructor(private readonly bracketsService: BracketsService) {}

  /**
   * Build the bracket skeleton (empty frame) for a closed category.
   * Organizer-only. Body required for group_ko format (groupCount, qualifyPerGroup).
   */
  @Post('categories/:cid/bracket/skeleton')
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  createSkeleton(
    @Param('cid') cid: string,
    @Body() dto: CreateSkeletonDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.bracketsService.createSkeleton(cid, dto, user);
  }

  /**
   * Run the draw — fill team assignments into the existing skeleton.
   * Mode auto-detected from Registration.seed. Re-draw safe (idempotent structure).
   */
  @Post('categories/:cid/bracket/draw')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  draw(
    @Param('cid') cid: string,
    @Body() _dto: DrawBracketDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.bracketsService.draw(cid, user);
  }

  /**
   * Get the active bracket for a category (authenticated, no extra role check).
   * Global AuthenticatedGuard applied by AppModule is sufficient.
   */
  @Get('categories/:cid/bracket')
  getActive(@Param('cid') cid: string) {
    return this.bracketsService.getActive(cid);
  }
}
