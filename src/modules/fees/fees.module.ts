import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tournament, TournamentSchema } from '../../schemas/tournament.schema';
import { Category, CategorySchema } from '../../schemas/category.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { FeesService } from './fees.service';
import { FeesController } from './fees.controller';

/**
 * Fees module — aggregates paymentConfig (on Tournament) + per-category fees
 * into a single organizer-facing surface.
 *
 * Imports Tournament + Category models directly (no re-export needed).
 * TournamentRolesModule provides TournamentRoleGuard for the organizer check.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
    TournamentRolesModule,
  ],
  providers: [FeesService],
  controllers: [FeesController],
})
export class FeesModule {}
