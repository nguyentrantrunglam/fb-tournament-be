/**
 * Auth + Users e2e tests.
 *
 * Uses MongoMemoryServer (standalone — NOT replica set) because auth requires no
 * multi-document transactions. Standalone mode avoids the ClientMetadataMissingField
 * error that the rs variant triggers on this machine.
 *
 * Session wiring: we apply session + passport middleware BEFORE app.init() via
 * app.use(). This is equivalent to what main.ts does. We use an in-memory session
 * store (express-session MemoryStore default) so the same process handles both
 * set and get without needing connect-mongo for tests.
 *
 * Unique indexes must exist before duplicate-key tests run — syncIndexes() in beforeAll.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  type INestApplication,
  ValidationPipe,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import session from 'express-session';
import passport from 'passport';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getModelToken } from '@nestjs/mongoose';
import { type Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { User, type UserDocument } from '../src/schemas/user.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_REG = {
  email: 'alice@example.com',
  password: 'password123',
  displayName: 'Alice Test',
  nationalId: '123456789012',
  gender: 'female',
  dob: '1995-06-15',
  phone: '0912345678',
} as const;

function reg(overrides: Record<string, unknown> = {}) {
  return { ...BASE_REG, ...overrides };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Auth & Users (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let userModel: Model<UserDocument>;

  // supertest agent persists cookies between requests (simulates a browser session).
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    // Standalone mode — no replica set needed for auth.
    mongo = await MongoMemoryServer.create();
    // Override MONGO_URI before AppModule initialises.
    process.env.MONGO_URI = mongo.getUri('badminton_test');
    // connect-mongo reads MONGO_URI from ConfigService — override before module compile.
    process.env.SESSION_SECRET = 'e2e-test-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply session + passport middleware BEFORE init so they wrap every request.
    // Use MemoryStore (express-session default) — no connect-mongo dependency in tests.
    // resave:true + saveUninitialized:true are required so passport can write session
    // data on login (passport's internal req.login may not trigger save otherwise).
    const sessionMiddleware = session({
      secret: 'e2e-test-secret',
      resave: true,
      saveUninitialized: true,
      // No `store` option → defaults to express-session MemoryStore (in-process).
      cookie: { httpOnly: true },
    });
    const passportInit = passport.initialize();
    const passportSession = passport.session();

    app.use(sessionMiddleware);
    app.use(passportInit);
    app.use(passportSession);

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new DomainExceptionFilter());

    await app.init();

    // Ensure unique indexes are built before any duplicate-key tests run.
    userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    await userModel.syncIndexes();

    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  // -------------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------------

  describe('POST /auth/register', () => {
    it('201 — creates user, sets cookie, returns safe user (no passwordHash/identity)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(reg())
        .expect(201);

      expect(res.body.email).toBe('alice@example.com');
      expect(res.body.displayName).toBe('Alice Test');
      expect(res.body.globalRole).toBe('athlete');
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.identity).toBeUndefined();
      // Session cookie must be present.
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('409 NATIONAL_ID_ALREADY_REGISTERED on duplicate nationalId', async () => {
      // Same nationalId, different email.
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(reg({ email: 'other@example.com' }))
        .expect(409);

      expect(res.body.code).toBe('NATIONAL_ID_ALREADY_REGISTERED');
    });

    it('409 EMAIL_ALREADY_USED on duplicate email', async () => {
      // Same email, different nationalId.
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(reg({ nationalId: '999999999999' }))
        .expect(409);

      expect(res.body.code).toBe('EMAIL_ALREADY_USED');
    });
  });

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  describe('POST /auth/login', () => {
    it('200 — correct credentials return safe user', async () => {
      const res = await agent
        .post('/auth/login')
        .send({ email: BASE_REG.email, password: BASE_REG.password })
        .expect(200);

      expect(res.body.email).toBe(BASE_REG.email);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('401 — wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: BASE_REG.email, password: 'wrongpassword' })
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /auth/me
  // -------------------------------------------------------------------------

  describe('GET /auth/me', () => {
    it('200 with valid session cookie', async () => {
      // agent already has the cookie from the login step above.
      const res = await agent.get('/auth/me').expect(200);
      expect(res.body.email).toBe(BASE_REG.email);
    });

    it('401 without session cookie', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /users/me
  // -------------------------------------------------------------------------

  describe('PATCH /users/me', () => {
    it('updates displayName but silently ignores nationalId (whitelist strips it)', async () => {
      const res = await agent
        .patch('/users/me')
        .send({ displayName: 'Alice Updated', nationalId: '000000000000' })
        .expect(200);

      expect(res.body.displayName).toBe('Alice Updated');
      // nationalId change must not appear (whitelist stripped the field).
      const dbUser = await userModel.findOne({ email: BASE_REG.email }).lean().exec();
      expect(dbUser?.identity?.nationalId).toBe(BASE_REG.nationalId);
    });
  });

  // -------------------------------------------------------------------------
  // Admin routes — need an admin user
  // -------------------------------------------------------------------------

  describe('Admin routes', () => {
    let adminAgent: ReturnType<typeof request.agent>;

    beforeAll(async () => {
      // Register a new user then elevate them to admin directly in DB
      // (mirrors the documented bootstrap procedure via mongosh).
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(
          reg({
            email: 'admin@example.com',
            nationalId: '888888888888',
          }),
        )
        .expect(201);

      await userModel.updateOne(
        { email: 'admin@example.com' },
        { $set: { globalRole: 'admin' } },
      );

      adminAgent = request.agent(app.getHttpServer());
      await adminAgent
        .post('/auth/login')
        .send({ email: 'admin@example.com', password: BASE_REG.password })
        .expect(200);
    });

    it('403 — non-admin GET /admin/users', async () => {
      // `agent` is logged in as alice (athlete).
      await agent.get('/admin/users').expect(403);
    });

    it('200 — admin GET /admin/users returns list without identity', async () => {
      const res = await adminAgent.get('/admin/users').expect(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      // No user in the list should expose identity.
      for (const u of res.body.users as Record<string, unknown>[]) {
        expect(u['identity']).toBeUndefined();
        expect(u['passwordHash']).toBeUndefined();
      }
    });

    it('200 — admin GET /admin/users/:id includes identity', async () => {
      const alice = await userModel.findOne({ email: BASE_REG.email }).lean().exec();
      expect(alice).not.toBeNull();

      const res = await adminAgent.get(`/admin/users/${alice!._id.toHexString()}`).expect(200);
      expect(res.body.identity).toBeDefined();
      expect(res.body.identity.nationalId).toBe(BASE_REG.nationalId);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('200 — admin PATCH /admin/users/:id/role grants organizer_capable', async () => {
      const alice = await userModel.findOne({ email: BASE_REG.email }).lean().exec();
      const res = await adminAgent
        .patch(`/admin/users/${alice!._id.toHexString()}/role`)
        .send({ role: 'organizer_capable' })
        .expect(200);

      expect(res.body.globalRole).toBe('organizer_capable');
    });
  });
});
