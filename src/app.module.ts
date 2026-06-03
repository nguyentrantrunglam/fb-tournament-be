import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration, { type AppConfig } from './config/configuration';
import { AuthenticatedGuard } from './common/guards/authenticated.guard';
import { HealthModule } from './modules/health/health.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CourtsModule } from './modules/courts/courts.module';
import { StorageModule } from './modules/storage/storage.module';
import { FeesModule } from './modules/fees/fees.module';
import { RefereesModule } from './modules/referees/referees.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        uri: config.get('mongoUri', { infer: true }),
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    TournamentsModule,
    CategoriesModule,
    CourtsModule,
    StorageModule,
    FeesModule,
    RefereesModule,
  ],
  providers: [
    // Rate limit everything.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Deny-by-default: every route requires a session UNLESS marked @Public(). Replaces firestore.rules.
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
  ],
})
export class AppModule {}
