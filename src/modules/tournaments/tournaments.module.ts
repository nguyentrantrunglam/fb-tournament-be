import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tournament, TournamentSchema } from '../../schemas/tournament.schema';
import { User, UserSchema } from '../../schemas/user.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      // User model is needed by TournamentsService.grantRole to verify target user exists (H2).
      { name: User.name, schema: UserSchema },
    ]),
    // Provides TournamentRole model (for TournamentsService) + TournamentRoleGuard.
    TournamentRolesModule,
  ],
  providers: [TournamentsService],
  controllers: [TournamentsController],
  // Export MongooseModule so CategoriesModule and CourtsModule can reuse the
  // Tournament model token without re-registering the schema.
  exports: [MongooseModule, TournamentsService],
})
export class TournamentsModule {}
