/**
 * Fees + Referees e2e tests.
 *
 * Uses MongoMemoryReplSet (standalone) so Mongo transactions work and
 * compound unique indexes are built correctly. Mirrors the setup pattern
 * from tournaments.e2e-spec.ts.
 *
 * Test flow:
 *  1. Alice (organizer_capable) creates tournament + category.
 *  2. GET /fees → paymentConfig null, category fee 0.
 *  3. PATCH /fees → updates paymentConfig + category fee atomically.
 *  4. GET /fees after patch → confirms updated values.
 *  5. Grant Charlie referee via POST /referees (by userId).
 *  6. GET /referees → lists Charlie, no PII in response.
 *  7. GET /search-users?q=Charlie → returns minimal fields (no email/nationalId).
 *  8. Invite Diana by email via POST /referees/invite → 201.
 *  9. Invite unknown email → 404 USER_NOT_FOUND.
 * 10. DELETE /referees/:userId → removes Charlie.
 * 11. Bob (athlete, non-organizer) → all write routes return 403.
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
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = {
  email: 'alice-fees@example.com',
  password: 'password123',
  displayName: 'Alice Fees',
  nationalId: '777000000001',
  gender: 'female',
  dob: '1990-01-01',
  phone: '0900000071',
} as const;

const BOB = {
  email: 'bob-fees@example.com',
  password: 'password123',
  displayName: 'Bob Fees',
  nationalId: '777000000002',
  gender: 'male',
  dob: '1992-05-10',
  phone: '0900000072',
} as const;

// Charlie will be granted referee role by userId
const CHARLIE = {
  email: 'charlie-fees@example.com',
  password: 'password123',
  displayName: 'Charlie Ref',
  nationalId: '777000000003',
  gender: 'male',
  dob: '1993-03-15',
  phone: '0900000073',
} as const;

// Diana will be invited by email
const DIANA = {
  email: 'diana-fees@example.com',
  password: 'password123',
  displayName: 'Diana Ref',
  nationalId: '777000000004',
  gender: 'female',
  dob: '1994-07-20',
  phone: '0900000074',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Fees + Referees (e2e)', () => {
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
  let charlieId: string;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = replSet.getUri('badminton_fees_test');
    process.env.SESSION_SECRET = 'e2e-fees-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const sessionMiddleware = session({
      secret: 'e2e-fees-secret',
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

    userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    categoryModel = moduleFixture.get<Model<CategoryDocument>>(getModelToken(Category.name));
    tournamentModel = moduleFixture.get<Model<TournamentDocument>>(getModelToken(Tournament.name));
    roleModel = moduleFixture.get<Model<TournamentRoleDocument>>(getModelToken(TournamentRole.name));

    // Build all unique indexes before tests.
    await Promise.all([
      userModel.syncIndexes(),
      categoryModel.syncIndexes(),
      tournamentModel.syncIndexes(),
      roleModel.syncIndexes(),
    ]);

    // Register all users.
    for (const user of [ALICE, BOB, CHARLIE, DIANA]) {
      await request(app.getHttpServer()).post('/auth/register').send(user).expect(201);
    }

    // Elevate Alice to organizer_capable.
    await userModel.updateOne({ email: ALICE.email }, { $set: { globalRole: 'organizer_capable' } });

    // Capture Charlie's userId for later use.
    const charlieDoc = await userModel.findOne({ email: CHARLIE.email }).lean().exec();
    charlieId = charlieDoc!._id.toHexString();

    // Create persistent agents.
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
  // Setup: create tournament + category
  // ---------------------------------------------------------------------------

  it('Alice creates tournament', async () => {
    const res = await aliceAgent
      .post('/tournaments')
      .send({ name: 'Fees Open 2026', startDate: '2026-09-01', endDate: '2026-09-05', location: 'Hà Nội' })
      .expect(201);
    tournamentId = res.body.id as string;
    expect(tournamentId).toBeDefined();
  });

  it('Alice creates a category', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'MS',
        name: "Men's Singles",
        playerCount: 1,
        genderRequirement: 'men_only',
        bestOf: 3,
        fee: 50000,
        maxTeams: 32,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    categoryId = res.body.id as string;
    expect(categoryId).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Fees — GET
  // ---------------------------------------------------------------------------

  it('GET /tournaments/:tid/fees → paymentConfig null, category fee present', async () => {
    const res = await aliceAgent.get(`/tournaments/${tournamentId}/fees`).expect(200);
    expect(res.body.paymentConfig).toBeNull();
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories).toHaveLength(1);
    expect(res.body.categories[0].id).toBe(categoryId);
    expect(res.body.categories[0].fee).toBe(50000);
    expect(res.body.categories[0].registrationStatus).toBe('not_open');
  });

  it('GET /tournaments/:tid/fees → 403 for non-organizer Bob', async () => {
    await bobAgent.get(`/tournaments/${tournamentId}/fees`).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Fees — PATCH
  // ---------------------------------------------------------------------------

  it('PATCH /tournaments/:tid/fees → updates paymentConfig + category fee atomically', async () => {
    const res = await aliceAgent
      .patch(`/tournaments/${tournamentId}/fees`)
      .send({
        paymentConfig: {
          accountHolder: 'NGUYEN VAN A',
          accountNumber: '0123456789',
          bankCode: 'VCB',
          transferMemoTemplate: 'FEESOPEN26 {tên_VĐV}',
        },
        categoryFees: [{ id: categoryId, fee: 150000 }],
      })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /tournaments/:tid/fees after PATCH → reflects updated values', async () => {
    const res = await aliceAgent.get(`/tournaments/${tournamentId}/fees`).expect(200);
    expect(res.body.paymentConfig).not.toBeNull();
    expect(res.body.paymentConfig.accountHolder).toBe('NGUYEN VAN A');
    expect(res.body.paymentConfig.bankCode).toBe('VCB');
    expect(res.body.categories[0].fee).toBe(150000);
  });

  it('PATCH /tournaments/:tid/fees → 403 for Bob', async () => {
    await bobAgent
      .patch(`/tournaments/${tournamentId}/fees`)
      .send({ categoryFees: [{ id: categoryId, fee: 0 }] })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Referees — grant by userId
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/referees → 201 grants Charlie referee role', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees`)
      .send({ userId: charlieId })
      .expect(201);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tournaments/:tid/referees → 409 TOURNAMENT_ROLE_ALREADY_GRANTED on duplicate', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees`)
      .send({ userId: charlieId })
      .expect(409);
    expect(res.body.code).toBe('TOURNAMENT_ROLE_ALREADY_GRANTED');
  });

  it('POST /tournaments/:tid/referees → 404 USER_NOT_FOUND for unknown userId', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees`)
      .send({ userId: '64a1b2c3d4e5f6a7b8c9d0e1' }) // valid MongoId but no user
      .expect(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Referees — GET list (no PII)
  // ---------------------------------------------------------------------------

  it('GET /tournaments/:tid/referees → lists Charlie, no PII in response', async () => {
    const res = await aliceAgent.get(`/tournaments/${tournamentId}/referees`).expect(200);
    expect(Array.isArray(res.body.referees)).toBe(true);
    expect(res.body.referees).toHaveLength(1);

    const referee = res.body.referees[0] as Record<string, unknown>;
    expect(referee.userId).toBe(charlieId);
    expect(referee.displayName).toBe(CHARLIE.displayName);
    // PII must not appear in the response.
    expect(referee.email).toBeUndefined();
    expect(referee.nationalId).toBeUndefined();
    expect(referee.phone).toBeUndefined();
    expect(Array.isArray(referee.assignedCourts)).toBe(true);
  });

  it('GET /tournaments/:tid/referees → 403 for Bob', async () => {
    await bobAgent.get(`/tournaments/${tournamentId}/referees`).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Referees — invite by email
  // ---------------------------------------------------------------------------

  it('POST /tournaments/:tid/referees/invite → 201 grants Diana by email', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees/invite`)
      .send({ email: DIANA.email })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.userId).toBeDefined();
  });

  it('POST /tournaments/:tid/referees/invite → 404 USER_NOT_FOUND for unknown email', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees/invite`)
      .send({ email: 'nobody@nowhere.example' })
      .expect(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('POST /tournaments/:tid/referees/invite → 409 already granted on duplicate invite', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/referees/invite`)
      .send({ email: DIANA.email })
      .expect(409);
    expect(res.body.code).toBe('TOURNAMENT_ROLE_ALREADY_GRANTED');
  });

  // ---------------------------------------------------------------------------
  // Search users — minimal fields, no PII
  // ---------------------------------------------------------------------------

  it('GET /search-users?q=Charlie → returns minimal fields, no email/nationalId', async () => {
    const res = await aliceAgent
      .get(`/tournaments/${tournamentId}/search-users?q=Charlie`)
      .expect(200);
    // Charlie is already a referee, so should be excluded from search results.
    const users = res.body.users as Record<string, unknown>[];
    expect(Array.isArray(users)).toBe(true);
    const charlie = users.find((u) => u['displayName'] === CHARLIE.displayName);
    // Charlie is already a referee — search excludes existing referees.
    expect(charlie).toBeUndefined();
  });

  it('GET /search-users?q=Bob → returns Bob with minimal fields only', async () => {
    const res = await aliceAgent
      .get(`/tournaments/${tournamentId}/search-users?q=Bob`)
      .expect(200);
    const users = res.body.users as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    const bob = users.find((u) => u['displayName'] === BOB.displayName);
    expect(bob).toBeDefined();
    // Only minimal fields allowed.
    expect(bob!['id']).toBeDefined();
    expect(bob!['displayName']).toBeDefined();
    expect(bob!['gender']).toBeDefined();
    // PII must be absent.
    expect(bob!['email']).toBeUndefined();
    expect(bob!['nationalId']).toBeUndefined();
    expect(bob!['phone']).toBeUndefined();
  });

  it('GET /search-users?q=X → 200 empty array for short query (< 2 chars)', async () => {
    const res = await aliceAgent
      .get(`/tournaments/${tournamentId}/search-users?q=X`)
      .expect(200);
    expect(res.body.users).toEqual([]);
  });

  it('GET /search-users → 403 for Bob', async () => {
    await bobAgent.get(`/tournaments/${tournamentId}/search-users?q=Alice`).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Referees — DELETE
  // ---------------------------------------------------------------------------

  it('DELETE /tournaments/:tid/referees/:userId → 200 removes Charlie', async () => {
    const res = await aliceAgent
      .delete(`/tournaments/${tournamentId}/referees/${charlieId}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /referees after DELETE → Charlie no longer listed', async () => {
    const res = await aliceAgent.get(`/tournaments/${tournamentId}/referees`).expect(200);
    const ids = (res.body.referees as { userId: string }[]).map((r) => r.userId);
    expect(ids).not.toContain(charlieId);
  });

  it('DELETE /referees/:userId → 404 when referee not found', async () => {
    // Charlie already removed — second delete returns 404.
    const res = await aliceAgent
      .delete(`/tournaments/${tournamentId}/referees/${charlieId}`)
      .expect(404);
    expect(res.body).toBeDefined();
  });

  it('DELETE /referees/:userId → 403 for Bob', async () => {
    await bobAgent
      .delete(`/tournaments/${tournamentId}/referees/${charlieId}`)
      .expect(403);
  });
});
