import { Module } from '@nestjs/common';
import { TournamentRolesModule } from '../tournament-roles/tournament-roles.module';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

@Module({
  // TournamentRolesModule provides the TournamentRole model used for organizer authz (C1).
  imports: [TournamentRolesModule],
  providers: [StorageService],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
