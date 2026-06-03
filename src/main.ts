import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import MongoStore from 'connect-mongo';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { SessionIoAdapter } from './common/adapters/session-io.adapter';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.set('trust proxy', 1); // behind Nginx in prod (correct proto for Secure cookies)

  const sessionConf = config.get('session', { infer: true });
  const mongoUri = config.get('mongoUri', { infer: true });
  const webOrigin = config.get('webOrigin', { infer: true });

  // Fail fast on a prod deploy that would silently break cross-origin auth.
  // Web (Vercel) ↔ api (own domain) is cross-origin → cookie MUST be SameSite=None;Secure,
  // and SameSite=None without Secure is rejected by browsers. Also block the placeholder secret.
  if (config.get('nodeEnv', { infer: true }) === 'production') {
    const problems: string[] = [];
    if (sessionConf.secret === 'change-me-in-prod') problems.push('SESSION_SECRET is the placeholder');
    if (!sessionConf.secure) problems.push('COOKIE_SECURE must be true');
    if (sessionConf.sameSite !== 'none') problems.push("COOKIE_SAMESITE must be 'none' (cross-origin web)");
    if (problems.length) throw new Error(`Invalid production session config: ${problems.join('; ')}`);
  }

  // ONE instance of each middleware, shared by REST (express) AND Socket.IO — connect.sid reused.
  const sessionMiddleware = session({
    secret: sessionConf.secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: mongoUri, collectionName: 'sessions' }),
    cookie: {
      httpOnly: true,
      sameSite: sessionConf.sameSite,
      secure: sessionConf.secure,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  });
  const passportInit = passport.initialize();
  const passportSession = passport.session();

  app.use(sessionMiddleware);
  app.use(passportInit);
  app.use(passportSession);

  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new DomainExceptionFilter());

  // Same middleware references on Socket.IO so connect.sid authenticates sockets too.
  app.useWebSocketAdapter(
    new SessionIoAdapter(app, [sessionMiddleware, passportInit, passportSession], webOrigin),
  );

  const port = config.get('port', { infer: true });
  await app.listen(port);
  logger.log(`badminton-api listening on :${port} (web origin: ${webOrigin})`);
}
void bootstrap();
