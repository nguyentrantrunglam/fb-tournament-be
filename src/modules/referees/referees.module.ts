import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tournament, TournamentSchema } from '../../schemas/tournament.schema';
import { TournamentRole, TournamentRoleSchema } from '../../schemas/tournament-role.schema';
import { User, UserSchema } from '../../schemas/user.schema';
import { Court, CourtSchema } from '../../schemas/court.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { RefereesService } from './referees.service';
import { RefereesController } from './referees.controller';

/**
 * Referees module — manages referee role grants on a tournament.
 *
 * Imports all four models the service needs:
 *  - Tournament: existence check before any mutation
 *  - TournamentRole: role grants/revokes (reuses existing collection)
 *  - User: existence check + search
 *  - Court: court-assignment snapshot for GET /referees response
 *
 * TournamentRolesModule provides TournamentRoleGuard for the organizer check.
 * Note: TournamentRolesModule already registers TournamentRole model, but
 * we re-register it here so RefereesService can @InjectModel it directly
 * without depending on the module's export internals.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: TournamentRole.name, schema: TournamentRoleSchema },
      { name: User.name, schema: UserSchema },
      { name: Court.name, schema: CourtSchema },
    ]),
    TournamentRolesModule,
  ],
  providers: [RefereesService],
  controllers: [RefereesController],
})
export class RefereesModule {}
