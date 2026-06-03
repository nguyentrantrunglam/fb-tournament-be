import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TournamentRole, TournamentRoleSchema } from '../../schemas/tournament-role.schema';
import { TournamentRoleGuard } from '../../common/guards/tournament-role.guard';

/**
 * Shared module that registers the TournamentRole Mongoose model and exports:
 *  - MongooseModule (so consumers can @InjectModel the TournamentRole model)
 *  - TournamentRoleGuard (the guard that reads tournamentRoles per-request)
 *
 * Import this module in TournamentsModule, CategoriesModule, and CourtsModule.
 * Do NOT register TournamentRoleGuard as a global APP_GUARD — it must remain
 * scoped so that @InjectModel DI works correctly within each feature module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TournamentRole.name, schema: TournamentRoleSchema },
    ]),
  ],
  providers: [TournamentRoleGuard],
  exports: [MongooseModule, TournamentRoleGuard],
})
export class TournamentRolesModule {}
