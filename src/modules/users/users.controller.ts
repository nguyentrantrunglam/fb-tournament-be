import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { SessionUser } from '../../schemas/user.schema';
import { UpdateMeDto } from './dto/update-me.dto';
import { GrantRoleDto } from './dto/grant-role.dto';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Update the calling user's own mutable profile fields.
   * Global AuthenticatedGuard ensures a session exists.
   * ValidationPipe (global, whitelist:true) strips unlisted keys — no nationalId drift.
   */
  @Patch('users/me')
  updateMe(@CurrentUser() user: SessionUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  /**
   * Admin: paginated user list. No identity in response — use GET /admin/users/:id for PII.
   * RolesGuard runs AFTER global AuthenticatedGuard (order: Throttler → Authenticated → Roles).
   */
  @Get('admin/users')
  @Roles('admin')
  @UseGuards(RolesGuard)
  listUsers(
    @Query('skip') skip = '0',
    @Query('limit') limit = '50',
    @Query('q') search?: string,
  ) {
    return this.usersService.listUsers(
      parseInt(skip, 10),
      parseInt(limit, 10),
      search,
    );
  }

  /** Admin: single user detail including PII identity. */
  @Get('admin/users/:id')
  @Roles('admin')
  @UseGuards(RolesGuard)
  getUserAdmin(@Param('id') id: string) {
    return this.usersService.getUserAdmin(id);
  }

  /** Admin: set globalRole on any user. Body: { role: 'athlete'|'organizer_capable'|'admin' }. */
  @Patch('admin/users/:id/role')
  @Roles('admin')
  @UseGuards(RolesGuard)
  grantRole(@Param('id') id: string, @Body() dto: GrantRoleDto) {
    return this.usersService.grantGlobalRole(id, dto.role);
  }
}
