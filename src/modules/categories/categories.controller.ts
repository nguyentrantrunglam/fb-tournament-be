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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { TournamentRoles } from '../../common/decorators/tournament-roles.decorator';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';
import { CategoryTournamentRoleGuard } from './category-tournament-role.guard';

@Controller()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * Create a category in a tournament.
   * :tid is the tournament param — TournamentRoleGuard reads it directly.
   */
  @Post('tournaments/:tid/categories')
  @HttpCode(HttpStatus.CREATED)
  @TournamentRoles('organizer')
  @UseGuards(TournamentRoleGuard)
  create(@Param('tid') tid: string, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(tid, dto);
  }

  /** List all categories for a tournament. Authenticated (global guard). */
  @Get('tournaments/:tid/categories')
  listByTournament(@Param('tid') tid: string) {
    return this.categoriesService.listByTournament(tid);
  }

  /**
   * Update category config.
   * CategoryTournamentRoleGuard resolves the tournament from the category document
   * and then delegates to TournamentRoleGuard logic.
   */
  @Patch('categories/:cid')
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  update(@Param('cid') cid: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(cid, dto);
  }

  /** Delete a category. Blocked if registrations exist (TODO Phase 4). */
  @Delete('categories/:cid')
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  delete(@Param('cid') cid: string) {
    return this.categoriesService.delete(cid);
  }

  /** Open registration: not_open → open. */
  @Post('categories/:cid/registration/open')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  openRegistration(@Param('cid') cid: string) {
    return this.categoriesService.openRegistration(cid);
  }

  /** Close registration: open → closed. Guard: 0 pending registrations. */
  @Post('categories/:cid/registration/close')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  closeRegistration(@Param('cid') cid: string) {
    return this.categoriesService.closeRegistration(cid);
  }

  /** Reopen registration: closed → open. Guard: no active bracket (TODO Phase 5). */
  @Post('categories/:cid/registration/reopen')
  @HttpCode(HttpStatus.OK)
  @TournamentRoles('organizer')
  @UseGuards(CategoryTournamentRoleGuard)
  reopenRegistration(@Param('cid') cid: string) {
    return this.categoriesService.reopenRegistration(cid);
  }
}
