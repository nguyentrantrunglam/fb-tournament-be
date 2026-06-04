/**
 * Security fixes e2e tests.
 *
 * Covers:
 *   C1 — presign cross-tenant IDOR: non-organizer of a tournament → 403;
 *         organizer of that tournament → NOT 403 (may be 501 if Spaces unconfigured).
 *   C2 — presign non-image contentType → 400.
 *   H1 — malformed ObjectId route param → 400 INVALID_ID (not 500).
 *   H2 — grantRole with non-existent userId → 404 USER_NOT_FOUND.
 *   H3 — extra unknown fields in request body → 400 (forbidNonWhitelisted).
 *
 * Uses MongoMemoryReplSet (replica set) so compound unique indexes build correctly
 * (same pattern as tournaments.e2e-spec.ts).
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
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getModelToken } from '@nestjs/mongoose';
import { type Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { User, type UserDocument } from '../src/schemas/user.schema';
import {
  TournamentRole,
  type TournamentRoleDocument,
} from '../src/schemas/tournament-role.schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = {
  email: 'alice-sec@example.com',
  password: 'password123',
  displayName: 'Alice Security',
  nationalId: '300000000001',
  gender: 'female',
  dob: '1990-01-01',
  phone: '0900000011',
} as const;

const BOB = {
  email: 'bob-sec@example.com',
  password: 'password123',
  displayName: 'Bob Security',
  nationalId: '300000000002',
  gender: 'male',
  dob: '1992-05-10',
  phone: '0900000012',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Security fixes (e2e)', () => {
  let app: INestApplication;
  let replSet: MongoMemoryReplSet;
  let userModel: Model<UserDocument>;
  let roleModel: Model<TournamentRoleDocument>;

  let aliceAgent: ReturnType<typeof request.agent>;
  let bobAgent: ReturnType<typeof request.agent>;

  let tournamentId: string;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = replSet.getUri('badminton_sec_test');
    process.env.SESSION_SECRET = 'e2e-security-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const sessionMiddleware = session({
      secret: 'e2e-security-secret',
      resave: true,
      saveUninitialized: true,
      cookie: { httpOnly: true },
    });
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    // forbidNonWhitelisted: true is set in main.ts — mirror it here for H3.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new DomainExceptionFilter());

    await app.init();

    userModel = moduleFixture.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    roleModel = moduleFixture.get<Model<TournamentRoleDocument>>(
      getModelToken(TournamentRole.name),
    );

    await Promise.all([userModel.syncIndexes(), roleModel.syncIndexes()]);

    // Register users.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(ALICE)
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(BOB)
      .expect(201);

    // Alice → organizer_capable so she can create tournaments.
    await userModel.updateOne(
      { email: ALICE.email },
      { $set: { globalRole: 'organizer_capable' } },
    );

    aliceAgent = request.agent(app.getHttpServer());
    bobAgent = request.agent(app.getHttpServer());

    await aliceAgent
      .post('/auth/login')
      .send({ email: ALICE.email, password: ALICE.password })
      .expect(200);
    await bobAgent
      .post('/auth/login')
      .send({ email: BOB.email, password: BOB.password })
      .expect(200);

    // Alice creates a tournament — she becomes organizer automatically.
    const res = await aliceAgent
      .post('/tournaments')
      .send({
        name: 'Security Test Open 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        location: 'Hà Nội',
      })
      .expect(201);

    tournamentId = res.body.id as string;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------
  // C1 — Cross-tenant IDOR on presign
  // ---------------------------------------------------------------------------

  describe('C1 — presign cross-tenant IDOR', () => {
    it("403 — bob (non-organizer) cannot presign into alice's tournament prefix", async () => {
      const res = await bobAgent
        .post('/storage/presign')
        .send({
          key: `tournaments/${tournamentId}/banner.jpg`,
          contentType: 'image/jpeg',
        })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('organizer (alice) passes the authz check — not 403 (may be 501 if Spaces unconfigured)', async () => {
      const res = await aliceAgent.post('/storage/presign').send({
        key: `tournaments/${tournamentId}/banner.jpg`,
        contentType: 'image/jpeg',
      });

      // Auth check passes before Spaces check — response must NOT be 403.
      expect(res.status).not.toBe(403);
      // In test env without Spaces creds the service returns 501 SPACES_NOT_CONFIGURED.
      // Either 200 (Spaces configured) or 501 (not configured) is acceptable.
      expect([200, 501]).toContain(res.status);
    });

    it('400 — key with no valid tournament prefix is rejected before authz', async () => {
      const res = await aliceAgent
        .post('/storage/presign')
        .send({
          key: 'uploads/banner.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_STORAGE_KEY');
    });
  });

  // ---------------------------------------------------------------------------
  // C2 — presign content-type whitelist
  // ---------------------------------------------------------------------------

  describe('C2 — presign content-type whitelist', () => {
    it('400 — non-image contentType (application/javascript) is rejected by DTO validation', async () => {
      const res = await aliceAgent
        .post('/storage/presign')
        .send({
          key: `tournaments/${tournamentId}/script.js`,
          contentType: 'application/javascript',
        })
        .expect(400);

      // ValidationPipe rejects with standard 400 body (message array).
      expect(res.status).toBe(400);
    });

    it('400 — non-image contentType (text/html) is rejected', async () => {
      const res = await aliceAgent
        .post('/storage/presign')
        .send({
          key: `tournaments/${tournamentId}/index.html`,
          contentType: 'text/html',
        })
        .expect(400);

      expect(res.status).toBe(400);
    });

    it('allowed image types pass DTO validation (image/png)', async () => {
      const res = await aliceAgent.post('/storage/presign').send({
        key: `tournaments/${tournamentId}/logo.png`,
        contentType: 'image/png',
      });

      // Passes DTO and authz — Spaces may or may not be configured in test env.
      expect([200, 501]).toContain(res.status);
    });
  });

  // ---------------------------------------------------------------------------
  // H1 — Malformed ObjectId route param → 400 INVALID_ID
  // ---------------------------------------------------------------------------

  describe('H1 — malformed ObjectId → 400 INVALID_ID', () => {
    it('GET /tournaments/not-an-id → 400 INVALID_ID (not 500)', async () => {
      const res = await aliceAgent.get('/tournaments/not-an-id').expect(400);

      expect(res.body.code).toBe('INVALID_ID');
    });
  });

  // ---------------------------------------------------------------------------
  // H2 — grantRole orphan: non-existent userId → 404 USER_NOT_FOUND
  // ---------------------------------------------------------------------------

  describe('H2 — grantRole non-existent userId → 404 USER_NOT_FOUND', () => {
    it('404 USER_NOT_FOUND when target user does not exist', async () => {
      // Use a syntactically valid but non-existent ObjectId.
      const fakeUserId = '000000000000000000000099';

      const res = await aliceAgent
        .post(`/tournaments/${tournamentId}/roles`)
        .send({ userId: fakeUserId, role: 'referee' })
        .expect(404);

      expect(res.body.code).toBe('USER_NOT_FOUND');
    });

    it('400 when userId is not a valid MongoId', async () => {
      const res = await aliceAgent
        .post(`/tournaments/${tournamentId}/roles`)
        .send({ userId: 'not-a-mongo-id', role: 'referee' })
        .expect(400);

      // ValidationPipe rejects with 400 for @IsMongoId failure.
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // H3 — forbidNonWhitelisted: unknown fields → 400
  // ---------------------------------------------------------------------------

  describe('H3 — forbidNonWhitelisted: extra fields rejected', () => {
    it('400 — unknown field in POST /auth/register body is rejected', async () => {
      // /auth/register uses RegisterDto processed by ValidationPipe before any guard,
      // so forbidNonWhitelisted fires on the unknown `isAdmin` field.
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'h3-test@example.com',
          password: 'password123',
          displayName: 'H3 Test',
          nationalId: '400000000099',
          gender: 'male',
          dob: '1990-01-01',
          phone: '0900000099',
          isAdmin: true, // unknown field — must be rejected
        })
        .expect(400);

      expect(res.status).toBe(400);
    });

    it('400 — unknown field in PATCH /tournaments/:tid body is rejected', async () => {
      const res = await aliceAgent
        .patch(`/tournaments/${tournamentId}`)
        .send({
          description: 'Updated',
          unknownField: 'injected', // not in UpdateTournamentDto
        })
        .expect(400);

      expect(res.status).toBe(400);
    });
  });
});
