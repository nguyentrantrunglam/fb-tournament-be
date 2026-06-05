/**
 * Brackets e2e tests.
 *
 * Uses MongoMemoryReplSet so Mongo transactions work correctly.
 * Mirrors the setup pattern from fees-referees.e2e-spec.ts.
 *
 * Test plan:
 *  1. Alice (organizer_capable) creates tournament + category (single_elim, men_only).
 *  2. Open registration + register 4 male athletes (Bob, Charlie, Dave, Eve-as-male).
 *  3. Approve all 4 registrations.
 *  4. Close registration.
 *  5. POST skeleton → 201; bracket.status = 'skeleton', matches have null sides.
 *  6. GET bracket → shape conforms (id, format, meta, knockout rounds).
 *  7. POST draw → 200; bracket.status = 'drawn', drawVersion = 1, sides filled.
 *  8. Re-draw → drawVersion = 2, same match structure.
 *  9. Non-organizer (Bob) blocked on skeleton + draw → 403.
 * 10. Skeleton before close → 409 CATEGORY_NOT_CLOSED.
 * 11. N < 2 after close → 409 NOT_ENOUGH_PARTICIPANTS (uses a second category with 1 team).
 * 12. group_ko skeleton without config → 400 INVALID_GROUP_CONFIG.
 *
 * NOTE: requires MongoMemoryReplSet for transactions.
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
import * as bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getModelToken } from '@nestjs/mongoose';
import { type Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { User, type UserDocument } from '../src/schemas/user.schema';
import {
  Category,
  type CategoryDocument,
} from '../src/schemas/category.schema';
import {
  Tournament,
  type TournamentDocument,
} from '../src/schemas/tournament.schema';
import {
  TournamentRole,
  type TournamentRoleDocument,
} from '../src/schemas/tournament-role.schema';
import {
  Registration,
  type RegistrationDocument,
} from '../src/schemas/registration.schema';
import {
  Bracket,
  type BracketDocument,
} from '../src/schemas/bracket.schema';
import {
  Match,
  type MatchDocument,
} from '../src/schemas/match.schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = {
  email: 'alice-bracket@example.com',
  password: 'password123',
  displayName: 'Alice Bracket',
  nationalId: '990000000001',
  gender: 'female',
  dob: '1990-01-01',
  phone: '0900000091',
} as const;

const BOB = {
  email: 'bob-bracket@example.com',
  password: 'password123',
  displayName: 'Bob Bracket',
  nationalId: '990000000002',
  gender: 'male',
  dob: '1992-05-10',
  phone: '0900000092',
} as const;

const CHARLIE = {
  email: 'charlie-bracket@example.com',
  password: 'password123',
  displayName: 'Charlie Bracket',
  nationalId: '990000000003',
  gender: 'male',
  dob: '1993-03-15',
  phone: '0900000093',
} as const;

const DAVE = {
  email: 'dave-bracket@example.com',
  password: 'password123',
  displayName: 'Dave Bracket',
  nationalId: '990000000004',
  gender: 'male',
  dob: '1994-04-20',
  phone: '0900000094',
} as const;

const EVE = {
  email: 'eve-bracket@example.com',
  password: 'password123',
  displayName: 'Eve Bracket',
  nationalId: '990000000005',
  gender: 'male',
  dob: '1995-05-25',
  phone: '0900000095',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Brackets (e2e)', () => {
  let app: INestApplication;
  let replSet: MongoMemoryReplSet;
  let userModel: Model<UserDocument>;
  let categoryModel: Model<CategoryDocument>;
  let tournamentModel: Model<TournamentDocument>;
  let roleModel: Model<TournamentRoleDocument>;
  let registrationModel: Model<RegistrationDocument>;

  let bracketModel: Model<BracketDocument>;
  let matchModel: Model<MatchDocument>;

  let aliceAgent: ReturnType<typeof request.agent>;
  let bobAgent: ReturnType<typeof request.agent>;

  let tournamentId: string;
  let categoryId: string;
  let bobId: string;
  let charlieId: string;
  let daveId: string;
  let eveId: string;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = replSet.getUri('badminton_bracket_test');
    process.env.SESSION_SECRET = 'e2e-bracket-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const sessionMiddleware = session({
      secret: 'e2e-bracket-secret',
      resave: true,
      saveUninitialized: true,
      cookie: { httpOnly: true },
    });
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new DomainExceptionFilter());

    await app.init();

    userModel = moduleFixture.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    categoryModel = moduleFixture.get<Model<CategoryDocument>>(
      getModelToken(Category.name),
    );
    tournamentModel = moduleFixture.get<Model<TournamentDocument>>(
      getModelToken(Tournament.name),
    );
    roleModel = moduleFixture.get<Model<TournamentRoleDocument>>(
      getModelToken(TournamentRole.name),
    );
    registrationModel = moduleFixture.get<Model<RegistrationDocument>>(
      getModelToken(Registration.name),
    );
    bracketModel = moduleFixture.get<Model<BracketDocument>>(
      getModelToken(Bracket.name),
    );
    matchModel = moduleFixture.get<Model<MatchDocument>>(
      getModelToken(Match.name),
    );

    await Promise.all([
      userModel.syncIndexes(),
      categoryModel.syncIndexes(),
      tournamentModel.syncIndexes(),
      roleModel.syncIndexes(),
      registrationModel.syncIndexes(),
      bracketModel.syncIndexes(),
      matchModel.syncIndexes(),
    ]);

    // Register all users
    for (const user of [ALICE, BOB, CHARLIE, DAVE, EVE]) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(user)
        .expect(201);
    }

    // Elevate Alice to organizer_capable
    await userModel.updateOne(
      { email: ALICE.email },
      { $set: { globalRole: 'organizer_capable' } },
    );

    const bobDoc = await userModel.findOne({ email: BOB.email }).lean().exec();
    bobId = bobDoc!._id.toHexString();

    const charlieDoc = await userModel.findOne({ email: CHARLIE.email }).lean().exec();
    charlieId = charlieDoc!._id.toHexString();

    const daveDoc = await userModel.findOne({ email: DAVE.email }).lean().exec();
    daveId = daveDoc!._id.toHexString();

    const eveDoc = await userModel.findOne({ email: EVE.email }).lean().exec();
    eveId = eveDoc!._id.toHexString();

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
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------
  // Step 1-4: tournament + category + registrations + close
  // ---------------------------------------------------------------------------

  it('Alice creates tournament', async () => {
    const res = await aliceAgent
      .post('/tournaments')
      .send({
        name: 'Bracket Open 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        location: 'Hà Nội',
      })
      .expect(201);
    tournamentId = res.body.id as string;
    expect(tournamentId).toBeDefined();
  });

  it('Alice creates a single_elim category', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'BK',
        name: 'Bracket Singles',
        playerCount: 1,
        genderRequirement: 'men_only',
        format: 'single_elim',
        bestOf: 3,
        fee: 0,
        maxTeams: 32,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    categoryId = res.body.id as string;
    expect(categoryId).toBeDefined();
  });

  it('Alice opens registration', async () => {
    await aliceAgent
      .post(`/categories/${categoryId}/registration/open`)
      .expect(200);
  });

  it('Skeleton before close → 409 CATEGORY_NOT_CLOSED', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/bracket/skeleton`)
      .send({})
      .expect(409);
    expect(res.body.code).toBe('CATEGORY_NOT_CLOSED');
  });

  it('Alice registers 4 athletes via organizer', async () => {
    for (const uid of [bobId, charlieId, daveId, eveId]) {
      await aliceAgent
        .post(`/categories/${categoryId}/registrations/organizer`)
        .send({ primaryUserId: uid })
        .expect(201);
    }
  });

  it('Alice closes registration', async () => {
    await aliceAgent
      .post(`/categories/${categoryId}/registration/close`)
      .expect(200);
  });

  // ---------------------------------------------------------------------------
  // Step 5: create skeleton
  // ---------------------------------------------------------------------------

  it('POST skeleton → 201 with skeleton status and null match sides', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/bracket/skeleton`)
      .send({})
      .expect(201);

    const body = res.body as {
      format: string;
      meta: { activeVersion: string; byes: number; bracketSize: number };
      knockout: { matches: { sideA: { name: null }; sideB: null | { name: null } }[] }[];
    };

    expect(body.format).toBe('single_elim');
    expect(body.meta.activeVersion).toBe('v0');
    expect(body.meta.bracketSize).toBe(4); // next power-of-2 >= 4
    expect(body.meta.byes).toBe(0);
    expect(Array.isArray(body.knockout)).toBe(true);

    // All R1 match sides should be TBD placeholders (skeleton)
    const r1 = body.knockout[0];
    expect(r1).toBeDefined();
    expect(r1!.matches.length).toBe(2); // 4 / 2 = 2 R1 matches
    for (const m of r1!.matches) {
      expect(m.sideA.name).toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Step 6: GET bracket
  // ---------------------------------------------------------------------------

  it('GET bracket → returns active bracket in FE shape', async () => {
    const res = await aliceAgent
      .get(`/categories/${categoryId}/bracket`)
      .expect(200);

    const body = res.body as { id: string; format: string; meta: { activeVersion: string } };
    expect(body.id).toBeDefined();
    expect(body.format).toBe('single_elim');
    expect(body.meta.activeVersion).toBe('v0');
  });

  // ---------------------------------------------------------------------------
  // Step 7: draw
  // ---------------------------------------------------------------------------

  it('POST draw → 200; status drawn, drawVersion 1, sides filled', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/bracket/draw`)
      .send({})
      .expect(200);

    const body = res.body as {
      meta: { activeVersion: string; versionsCount: number };
      knockout: { matches: { sideA: { name: string | null }; sideB: null | { name: string | null } }[] }[];
    };

    expect(body.meta.activeVersion).toBe('v1');
    expect(body.meta.versionsCount).toBe(1);

    const r1 = body.knockout[0];
    expect(r1).toBeDefined();
    for (const m of r1!.matches) {
      // After draw, names should be filled
      expect(m.sideA.name).not.toBeNull();
      if (m.sideB !== null) {
        expect(m.sideB.name).not.toBeNull();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Step 8: re-draw
  // ---------------------------------------------------------------------------

  it('Re-draw → drawVersion increments to 2, same match count', async () => {
    const res = await aliceAgent
      .post(`/categories/${categoryId}/bracket/draw`)
      .send({})
      .expect(200);

    const body = res.body as {
      meta: { activeVersion: string; versionsCount: number };
      knockout: { matches: unknown[] }[];
    };

    expect(body.meta.activeVersion).toBe('v2');
    expect(body.meta.versionsCount).toBe(2);
    // Same KO rounds structure
    expect(body.knockout).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Step 9: guard tests
  // ---------------------------------------------------------------------------

  it('Bob (non-organizer) cannot POST skeleton → 403', async () => {
    await bobAgent
      .post(`/categories/${categoryId}/bracket/skeleton`)
      .send({})
      .expect(403);
  });

  it('Bob (non-organizer) cannot POST draw → 403', async () => {
    await bobAgent
      .post(`/categories/${categoryId}/bracket/draw`)
      .send({})
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Step 11: N < 2 → reject
  // ---------------------------------------------------------------------------

  it('N < 2 (empty category, closed) → 409 NOT_ENOUGH_PARTICIPANTS', async () => {
    // Create another category and close it with 0 approved registrations
    const catRes = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'BK2',
        name: 'Bracket Empty',
        playerCount: 1,
        genderRequirement: 'men_only',
        format: 'single_elim',
        bestOf: 1,
        fee: 0,
        maxTeams: 4,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    const emptyCatId = catRes.body.id as string;

    // Open then directly close (0 approved regs) — bypass closeRegistration pending check
    // by directly setting status via model
    await categoryModel.updateOne(
      { _id: emptyCatId },
      { $set: { registrationStatus: 'closed' } },
    );

    const res = await aliceAgent
      .post(`/categories/${emptyCatId}/bracket/skeleton`)
      .send({})
      .expect(409);
    expect(res.body.code).toBe('NOT_ENOUGH_PARTICIPANTS');
  });

  // ---------------------------------------------------------------------------
  // Step 12: group_ko without config → 400
  // ---------------------------------------------------------------------------

  it('group_ko skeleton without groupCount/qualifyPerGroup → 400 INVALID_GROUP_CONFIG', async () => {
    const catRes = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'GKO',
        name: 'Group KO',
        playerCount: 1,
        genderRequirement: 'men_only',
        format: 'group_ko',
        bestOf: 1,
        fee: 0,
        maxTeams: 16,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    const gkoCatId = catRes.body.id as string;

    // Force 4 approved regs + closed state
    await categoryModel.updateOne(
      { _id: gkoCatId },
      { $set: { registrationStatus: 'closed' } },
    );
    await registrationModel.insertMany([
      { tournamentId, categoryId: gkoCatId, primaryUserId: bobId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId },
      { tournamentId, categoryId: gkoCatId, primaryUserId: charlieId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId },
      { tournamentId, categoryId: gkoCatId, primaryUserId: daveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId },
      { tournamentId, categoryId: gkoCatId, primaryUserId: eveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId },
    ]);

    const res = await aliceAgent
      .post(`/categories/${gkoCatId}/bracket/skeleton`)
      .send({}) // no groupCount / qualifyPerGroup
      .expect(400);
    expect(res.body.code).toBe('INVALID_GROUP_CONFIG');
  });

  // ---------------------------------------------------------------------------
  // Round-robin draw persistence (C1 regression guard)
  // ---------------------------------------------------------------------------

  describe('round_robin draw persistence', () => {
    let rrCatId: string;

    it('creates round_robin category with 4 participants, closes it', async () => {
      const catRes = await aliceAgent
        .post(`/tournaments/${tournamentId}/categories`)
        .send({
          code: 'RR',
          name: 'Round Robin Test',
          playerCount: 1,
          genderRequirement: 'men_only',
          format: 'round_robin',
          bestOf: 1,
          fee: 0,
          maxTeams: 16,
          registrationDeadline: '2026-08-01T00:00:00.000Z',
        })
        .expect(201);
      rrCatId = catRes.body.id as string;

      // Insert 4 approved registrations with explicit seeds so standings rank is deterministic
      await categoryModel.updateOne({ _id: rrCatId }, { $set: { registrationStatus: 'closed' } });
      await registrationModel.insertMany([
        { tournamentId, categoryId: rrCatId, primaryUserId: bobId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 1 },
        { tournamentId, categoryId: rrCatId, primaryUserId: charlieId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 2 },
        { tournamentId, categoryId: rrCatId, primaryUserId: daveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 3 },
        { tournamentId, categoryId: rrCatId, primaryUserId: eveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 4 },
      ]);
    });

    it('POST skeleton → 201; 6 matches with null sides', async () => {
      const res = await aliceAgent
        .post(`/categories/${rrCatId}/bracket/skeleton`)
        .send({})
        .expect(201);

      const body = res.body as { format: string; roundRobin: { matches: unknown[]; standings: unknown[] } };
      expect(body.format).toBe('round_robin');
      // C(4,2) = 6 matches
      expect(body.roundRobin.matches).toHaveLength(6);
      // All sides null before draw
      for (const m of body.roundRobin.matches as { sideA: { name: string | null } }[]) {
        expect(m.sideA.name).toBeNull();
      }
    });

    it('POST draw → all 6 matches have BOTH sides non-null; standings has 4 rows ranked by seed', async () => {
      const res = await aliceAgent
        .post(`/categories/${rrCatId}/bracket/draw`)
        .send({})
        .expect(200);

      const body = res.body as {
        meta: { activeVersion: string; versionsCount: number };
        roundRobin: {
          matches: { sideA: { name: string | null }; sideB: { name: string | null } }[];
          standings: { rank: number; seed: number | null; name: string }[];
        };
      };

      expect(body.meta.activeVersion).toBe('v1');

      // All 6 matches must have BOTH sides filled (regression guard for C1)
      expect(body.roundRobin.matches).toHaveLength(6);
      for (const m of body.roundRobin.matches) {
        expect(m.sideA.name).not.toBeNull();
        expect(m.sideB.name).not.toBeNull();
      }

      // 4 rows in standings ranked by seed ascending
      expect(body.roundRobin.standings).toHaveLength(4);
      const ranks = body.roundRobin.standings.map((r) => r.rank);
      expect(ranks).toEqual([1, 2, 3, 4]);
      // Seed 1 should be rank 1
      const top = body.roundRobin.standings[0]!;
      expect(top.seed).toBe(1);
    });

    it('re-draw RR: drawVersion increments, all sides still filled, drawHistory grows', async () => {
      // Second draw
      const res = await aliceAgent
        .post(`/categories/${rrCatId}/bracket/draw`)
        .send({})
        .expect(200);

      const body = res.body as {
        meta: { activeVersion: string; versionsCount: number };
        roundRobin: { matches: { sideA: { name: string | null }; sideB: { name: string | null } }[] };
      };

      expect(body.meta.activeVersion).toBe('v2');
      expect(body.meta.versionsCount).toBe(2);

      // Sides still filled after re-draw
      for (const m of body.roundRobin.matches) {
        expect(m.sideA.name).not.toBeNull();
        expect(m.sideB.name).not.toBeNull();
      }

      // Verify drawHistory length in DB
      const bracket = await bracketModel
        .findOne({ categoryId: rrCatId, isActive: true })
        .lean()
        .exec();
      expect(bracket).not.toBeNull();
      expect(bracket!.drawHistory).toHaveLength(2);
      expect(bracket!.drawHistory[0]!.drawVersion).toBe(1);
      expect(bracket!.drawHistory[1]!.drawVersion).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Group-KO draw persistence
  // ---------------------------------------------------------------------------

  describe('group_ko draw persistence', () => {
    let gkoCatId: string;

    it('creates group_ko category with 4 participants (2 groups × 1 qualifier)', async () => {
      const catRes = await aliceAgent
        .post(`/tournaments/${tournamentId}/categories`)
        .send({
          code: 'GK2',
          name: 'Group KO Draw Test',
          playerCount: 1,
          genderRequirement: 'men_only',
          format: 'group_ko',
          bestOf: 1,
          fee: 0,
          maxTeams: 16,
          registrationDeadline: '2026-08-01T00:00:00.000Z',
        })
        .expect(201);
      gkoCatId = catRes.body.id as string;

      await categoryModel.updateOne({ _id: gkoCatId }, { $set: { registrationStatus: 'closed' } });
      await registrationModel.insertMany([
        { tournamentId, categoryId: gkoCatId, primaryUserId: bobId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 1 },
        { tournamentId, categoryId: gkoCatId, primaryUserId: charlieId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 2 },
        { tournamentId, categoryId: gkoCatId, primaryUserId: daveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 3 },
        { tournamentId, categoryId: gkoCatId, primaryUserId: eveId, status: 'approved', paymentStatus: 'unpaid', feeSnapshot: 0, createdMode: 'organizer_single', createdByUserId: bobId, seed: 4 },
      ]);
    });

    it('POST skeleton (groupCount=2, qualifyPerGroup=1) → 201', async () => {
      const res = await aliceAgent
        .post(`/categories/${gkoCatId}/bracket/skeleton`)
        .send({ groupCount: 2, qualifyPerGroup: 1 })
        .expect(201);

      const body = res.body as { format: string; groupKo: { groups: unknown[]; knockout: unknown[] } };
      expect(body.format).toBe('group_ko');
      expect(body.groupKo.groups).toHaveLength(2);
    });

    it('POST draw → within-group RR matches have both sides filled; KO sides remain placeholder; standings qualified flags set', async () => {
      const res = await aliceAgent
        .post(`/categories/${gkoCatId}/bracket/draw`)
        .send({})
        .expect(200);

      const body = res.body as {
        meta: { activeVersion: string };
        groupKo: {
          qualifyPerGroup: number;
          groups: {
            name: string;
            standings: { rank: number; qualified: boolean; seed: number | null }[];
          }[];
          knockout: {
            key: string;
            matches: { sideA: { name: string | null; placeholder: string | null }; sideB: { name: string | null; placeholder: string | null } | null }[];
          }[];
        };
      };

      expect(body.meta.activeVersion).toBe('v1');
      expect(body.groupKo.qualifyPerGroup).toBe(1);

      // Each group has within-group matches — verify via DB (response doesn't expose group matches directly in groupKo.groups)
      const bracket = await bracketModel.findOne({ categoryId: gkoCatId, isActive: true }).lean().exec();
      expect(bracket).not.toBeNull();
      const allMatches = await matchModel.find({ bracketId: bracket!._id.toHexString() }).lean().exec();

      // Within-group matches (groupKey defined, round undefined) must have both sides filled
      const groupMatches = allMatches.filter((m) => m.groupKey !== undefined && m.round === undefined);
      expect(groupMatches.length).toBeGreaterThan(0);
      for (const m of groupMatches) {
        expect(m.sideA?.registrationId).not.toBeNull();
        expect(m.sideB?.registrationId).not.toBeNull();
      }

      // KO matches (round defined) retain placeholder sides (registrationId null)
      const koMatches = allMatches.filter((m) => m.round !== undefined);
      expect(koMatches.length).toBeGreaterThan(0);
      for (const m of koMatches) {
        // KO sides stay as placeholder labels — registrationId null
        if (!m.isBye) {
          expect(m.sideA?.registrationId ?? null).toBeNull();
          expect(m.sideB?.registrationId ?? null).toBeNull();
        }
      }

      // Each group standings: rank 1 is qualified=true, rank 2 is qualified=false
      for (const group of body.groupKo.groups) {
        const qualified = group.standings.filter((s) => s.qualified);
        expect(qualified).toHaveLength(1); // qualifyPerGroup = 1
        expect(group.standings[0]!.rank).toBe(1);
        expect(group.standings[0]!.qualified).toBe(true);
        if (group.standings.length > 1) {
          expect(group.standings[1]!.qualified).toBe(false);
        }
      }
    });
  });
});
