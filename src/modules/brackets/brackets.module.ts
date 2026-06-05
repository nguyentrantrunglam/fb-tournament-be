import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bracket, BracketSchema } from '../../schemas/bracket.schema';
import { Match, MatchSchema } from '../../schemas/match.schema';
import { Category, CategorySchema } from '../../schemas/category.schema';
import {
  Registration,
  RegistrationSchema,
} from '../../schemas/registration.schema';
import { User, UserSchema } from '../../schemas/user.schema';
import { CategoriesModule } from '../categories/categories.module';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BracketsService } from './brackets.service';
import { BracketsController } from './brackets.controller';

/**
 * BracketsModule — skeleton/draw/read endpoints.
 * Imports CategoriesModule to reuse CategoryTournamentRoleGuard (already exported).
 * Imports RealtimeModule for post-commit push events.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bracket.name, schema: BracketSchema },
      { name: Match.name, schema: MatchSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Registration.name, schema: RegistrationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CategoriesModule,
    TournamentRolesModule,
    RealtimeModule,
  ],
  providers: [BracketsService],
  controllers: [BracketsController],
})
export class BracketsModule {}
