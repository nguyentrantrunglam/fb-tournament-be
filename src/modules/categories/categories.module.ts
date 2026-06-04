import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../../schemas/category.schema';
import {
  Registration,
  RegistrationSchema,
} from '../../schemas/registration.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoryTournamentRoleGuard } from './category-tournament-role.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      // Registration model needed to enforce pending-count guard on closeRegistration
      // and to block deletion when registrations exist.
      { name: Registration.name, schema: RegistrationSchema },
    ]),
    // Provides TournamentRole model (for CategoryTournamentRoleGuard) + TournamentRoleGuard.
    TournamentRolesModule,
  ],
  providers: [CategoriesService, CategoryTournamentRoleGuard],
  controllers: [CategoriesController],
  exports: [CategoriesService, CategoryTournamentRoleGuard],
})
export class CategoriesModule {}
