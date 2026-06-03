/**
 * Tournaments + Categories + Courts e2e tests.
 *
 * Uses MongoMemoryServer in replica-set mode so unique compound indexes work
 * (autoIndex / syncIndexes requires a real index build, not just metadata).
 *
 * Session wiring mirrors auth.e2e-spec.ts: express-session MemoryStore (in-process),
 * no connect-mongo dependency.
 *
 * Test flow:
 *  1. Register two users: alice (gets organizer_capable) and bob (stays athlete).
 *  2. Alice creates a tournament → 201, becomes organizer, gets id.
 *  3. Alice creates a category → 201.
 *  4. Duplicate code → 409 CATEGORY_CODE_DUPLICATE.
 *  5. mixed_pair + playerCount=1 → 400 INVALID_CATEGORY_CONFIG.
 *  6. Bob tries to PATCH alice's tournament → 403.
 *  7. Alice: lifecycle open → close → reopen.
 *  8. Alice creates a court → 201.
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
import { Category, type CategoryDocument } from '../src/schemas/category.schema';
import { Tournament, type TournamentDocument } from '../src/schemas/tournament.schema';
import { TournamentRole, type TournamentRoleDocument } from '../src/schemas/tournament-role.schema';

// ---------------------------------------------------------------------------
// Test user fixtures
// ---------------------------------------------------------------------------

const ALICE = {
  email: 'alice-tournament@example.com',
  password: 'password123',
  displayName: 'Alice Organizer',
  nationalId: '111111111111',
  gender: 'female',
  dob: '1990-01-01',
  phone: '0900000001',
} as const;

const BOB = {
  email: 'bob-athlete@example.com',
  password: 'password123',
  displayName: 'Bob Athlete',
  nationalId: '222222222222',
  gender: 'male',
  dob: '1992-05-10',
  phone: '0900000002',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Tournaments + Categories + Courts (e2e)', () => {
  let app: INestApplication;
  let replSet: MongoMemoryReplSet;
  let userModel: Model<UserDocument>;
  let categoryModel: Model<CategoryDocument>;
  let tournamentModel: Model<TournamentDocument>;
  let roleModel: Model<TournamentRoleDocument>;

  let aliceAgent: ReturnType<typeof request.agent>;
  let bobAgent: ReturnType<typeof request.agent>;

  let tournamentId: string;
  let categoryId: string;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    // Replica set is required so Mongoose autoIndex builds compound unique indexes.
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = replSet.getUri('badminton_tournament_test');
    process.env.SESSION_SECRET = 'e2e-tournament-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const sessionMiddleware = session({
      secret: 'e2e-tournament-secret',
      resave: true,
      saveUninitialized: true,
      cookie: { httpOnly: true },
    });
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new DomainExceptionFilter());

    await app.init();

    // Resolve models and ensure all unique indexes are built before tests run.
    userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    categoryModel = moduleFixture.get<Model<CategoryDocument>>(getModelToken(Category.name));
    tournamentModel = moduleFixture.get<Model<TournamentDocument>>(getModelToken(Tournament.name));
    roleModel = moduleFixture.get<Model<TournamentRoleDocument>>(getModelToken(TournamentRole.name));

    await Promise.all([
      userModel.syncIndexes(),
      categoryModel.syncIndexes(),
      tournamentModel.syncIndexes(),
      roleModel.syncIndexes(),
    ]);

    // Register alice and bob.
    await request(app.getHttpServer()).post('/auth/register').send(ALICE).expect(201);
    await request(app.getHttpServer()).post('/auth/register').send(BOB).expect(201);

    // Elevate alice to organizer_capable directly in DB (mirrors documented bootstrap).
    await userModel.updateOne(
      { email: ALICE.email },
      { $set: { globalRole: 'organizer_capable' } },
    );

    // Create persistent agents (cookies persist between calls).
    aliceAgent = request.agent(app.getHttpServer());
    bobAgent = request.agent(app.getHttpServer());

    await aliceAgent.post('/auth/login').send({ email: ALICE.email, password: ALICE.password }).expect(200);
    await bobAgent.post('/auth/login').send({ email: BOB.email, password: BOB.password }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------
  // 1. Create tournament
  // ---------------------------------------------------------------------------

  it('POST /tournaments → 201 + tournament id + slug', async () => {
    const res = await aliceAgent
      .post('/tournaments')
      .send({
        name: 'Test Open 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        location: 'Hà Nội',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toMatch(/test-open-2026/);
    tournamentId = res.body.id as string;

    // Organizer role must be auto-granted.
    const alice = await userModel.findOne({ email: ALICE.email }).lean().exec();
    const roleDoc = await roleModel
      .findOne({ tournamentId, userId: alice!._id.toHexString(), role: 'organizer' })
      .lean()
      .exec();
    expect(roleDoc).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 2. athlete cannot create tournament
  // ---------------------------------------------------------------------------

  it('POST /tournaments → 403 for athlete (bob)', async () => {
    await bobAgent
      .post('/tournaments')
      .send({
        name: 'Bob Unauthorized',
        startDate: '2026-10-01',
        endDate: '2026-10-05',
        location: 'TP HCM',
      })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // 3. Create category — happy path
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/categories → 201', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'MS',
        name: 'Men\'s Singles',
        playerCount: 1,
        genderRequirement: 'men_only',
        bestOf: 3,
        fee: 100000,
        maxTeams: 32,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    categoryId = res.body.id as string;
  });

  // ---------------------------------------------------------------------------
  // 4. Duplicate category code → 409 CATEGORY_CODE_DUPLICATE
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/categories → 409 CATEGORY_CODE_DUPLICATE on duplicate code', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'MS',
        name: 'Men\'s Singles Duplicate',
        playerCount: 1,
        genderRequirement: 'men_only',
        bestOf: 3,
        fee: 0,
        maxTeams: 16,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(409);

    expect(res.body.code).toBe('CATEGORY_CODE_DUPLICATE');
  });

  // ---------------------------------------------------------------------------
  // 5. mixed_pair + playerCount=1 → 400 INVALID_CATEGORY_CONFIG
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/categories → 400 INVALID_CATEGORY_CONFIG for mixed_pair + playerCount=1', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'XD',
        name: 'Mixed Doubles Wrong',
        playerCount: 1, // Should be 2 for mixed_pair
        genderRequirement: 'mixed_pair',
        bestOf: 3,
        fee: 0,
        maxTeams: 16,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(400);

    expect(res.body.code).toBe('INVALID_CATEGORY_CONFIG');
  });

  // ---------------------------------------------------------------------------
  // 6. Non-organizer PATCH others' tournament → 403
  // ---------------------------------------------------------------------------

  it('PATCH /tournaments/:tid → 403 for bob (not organizer)', async () => {
    await bobAgent
      .patch(`/tournaments/${tournamentId}`)
      .send({ description: 'Bob tries to hack' })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // 7. Lifecycle: open → close → reopen
  // ---------------------------------------------------------------------------

  it('POST /categories/:cid/registration/open → 200', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/registration/open`)
      .expect(200);
    expect(res.body.registrationStatus).toBe('open');
  });

  it('POST /categories/:cid/registration/close → 200', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/registration/close`)
      .expect(200);
    expect(res.body.registrationStatus).toBe('closed');
  });

  it('POST /categories/:cid/registration/reopen → 200', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/registration/reopen`)
      .expect(200);
    expect(res.body.registrationStatus).toBe('open');
  });

  // ---------------------------------------------------------------------------
  // 8. Create court
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/courts → 201', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/courts`)
      .send({ name: 'Sân 1' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Sân 1');
    expect(res.body.status).toBe('available');
  });
});
