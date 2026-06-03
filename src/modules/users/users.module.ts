import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  // AuthModule exports MongooseModule (forFeature User) — reuse that registration.
  imports: [AuthModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
