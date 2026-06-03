import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}

  /** Liveness + Mongo connectivity. No-auth (used by web smoke test + uptime checks). */
  @Public()
  @Get()
  check() {
    // mongoose readyState: 1 = connected
    return {
      ok: true,
      ts: new Date().toISOString(),
      mongo: this.mongo.readyState === 1 ? 'up' : 'down',
    };
  }
}
