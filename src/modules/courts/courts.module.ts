import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Court, CourtSchema } from '../../schemas/court.schema';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { CourtsService } from './courts.service';
import { CourtsController } from './courts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Court.name, schema: CourtSchema }]),
    // Provides TournamentRole model + TournamentRoleGuard for write-route authorization.
    TournamentRolesModule,
  ],
  providers: [CourtsService],
  controllers: [CourtsController],
  exports: [CourtsService],
})
export class CourtsModule {}
