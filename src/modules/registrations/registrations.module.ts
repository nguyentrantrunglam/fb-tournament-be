import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Registration,
  RegistrationSchema,
} from '../../schemas/registration.schema';
import { Category, CategorySchema } from '../../schemas/category.schema';
import { User, UserSchema } from '../../schemas/user.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CategoriesModule } from '../categories/categories.module';
import { RegistrationsService } from './registrations.service';
import { RegistrationsController } from './registrations.controller';
import { RegistrationTournamentRoleGuard } from './registration-tournament-role.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Registration.name, schema: RegistrationSchema },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
      // TournamentRole model is exported by TournamentRolesModule below.
    ]),
    // Provides TournamentRole model + TournamentRoleGuard for organizer authz.
    TournamentRolesModule,
    // Provides RealtimeGateway for post-commit push events.
    RealtimeModule,
    // Provides CategoryTournamentRoleGuard used on /categories/:cid/registrations/organizer.
    CategoriesModule,
  ],
  providers: [RegistrationsService, RegistrationTournamentRoleGuard],
  controllers: [RegistrationsController],
})
export class RegistrationsModule {}
