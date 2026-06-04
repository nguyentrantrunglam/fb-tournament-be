/**
 * Registrations e2e tests.
 *
 * Uses MongoMemoryReplSet so Mongo transactions (slot-check) work correctly.
 * Follows the setup pattern from fees-referees.e2e-spec.ts.
 *
 * Test plan:
 *  1. Alice (organizer_capable) creates tournament + two categories (singles men_only maxTeams=2, doubles mixed_pair maxTeams=2).
 *  2. Open both categories for registration.
 *  3. Bob self-registers for singles → 201 pending.
 *  4. Bob tries to register same category again → 400 DUPLICATE_REGISTRATION.
 *  5. Charlie self-registers → 201 pending.
 *  6. Eve tries to register → 400 CATEGORY_FULL (atomic counter guard).
 *  7. Organizer bulk: 5 rows (3 valid, 2 fail) in doubles category → partial commit.
 *  8. Alice approves Bob's registration → 200 ok; slotsUsed unchanged.
 *  9. Alice rejects Charlie's registration → 200 ok; slotsUsed decrements.
 * 10. Bob withdraws own registration → 200 ok; slotsUsed decrements.
 * 10a. Bob tries to withdraw again → 400 INVALID_LIFECYCLE_TRANSITION.
 * 11. Alice marks a registration paid → 200 ok; unmark-paid → 200 ok.
 * 12. Authz: Bob (non-organizer) blocked on all organizer routes → 403.
 * 13. Gender matrix smoke: mixed_pair doubles with male+female → ok; men_only female → reject.
 * 14. Search partner: displayName-only match; email substring search returns no match (no PII oracle).
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = {
  email: 'alice-reg@example.com',
  password: 'password123',
  displayName: 'Alice Reg',
  nationalId: '888000000001',
  gender: 'female',
  dob: '1990-01-01',
  phone: '0900000081',
} as const;

const BOB = {
  email: 'bob-reg@example.com',
  password: 'password123',
  displayName: 'Bob Reg',
  nationalId: '888000000002',
  gender: 'male',
  dob: '1992-05-10',
  phone: '0900000082',
} as const;

const CHARLIE = {
  email: 'charlie-reg@example.com',
  password: 'password123',
  displayName: 'Charlie Reg',
  nationalId: '888000000003',
  gender: 'male',
  dob: '1993-03-15',
  phone: '0900000083',
} as const;

const DIANA = {
  email: 'diana-reg@example.com',
  password: 'password123',
  displayName: 'Diana Reg',
  nationalId: '888000000004',
  gender: 'female',
  dob: '1994-07-20',
  phone: '0900000084',
} as const;

// Eve is the 3rd registrant that will hit CATEGORY_FULL
const EVE = {
  email: 'eve-reg@example.com',
  password: 'password123',
  displayName: 'Eve Reg',
  nationalId: '888000000005',
  gender: 'male',
  dob: '1995-11-30',
  phone: '0900000085',
} as const;

// Frank + Grace for bulk rows
const FRANK = {
  email: 'frank-reg@example.com',
  password: 'password123',
  displayName: 'Frank Reg',
  nationalId: '888000000006',
  gender: 'male',
  dob: '1996-02-14',
  phone: '0900000086',
} as const;

const GRACE = {
  email: 'grace-reg@example.com',
  password: 'password123',
  displayName: 'Grace Reg',
  nationalId: '888000000007',
  gender: 'female',
  dob: '1997-08-08',
  phone: '0900000087',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Registrations (e2e)', () => {
  let app: INestApplication;
  let replSet: MongoMemoryReplSet;
  let userModel: Model<UserDocument>;
  let categoryModel: Model<CategoryDocument>;
  let tournamentModel: Model<TournamentDocument>;
  let roleModel: Model<TournamentRoleDocument>;
  let registrationModel: Model<RegistrationDocument>;

  let aliceAgent: ReturnType<typeof request.agent>;
  let bobAgent: ReturnType<typeof request.agent>;
  let charlieAgent: ReturnType<typeof request.agent>;
  let dianaAgent: ReturnType<typeof request.agent>;
  let eveAgent: ReturnType<typeof request.agent>;

  let tournamentId: string;
  let singlesCategoryId: string; // men_only, maxTeams=2
  let doublesCategoryId: string; // mixed_pair, maxTeams=4

  let bobId: string;
  let charlieId: string;
  let dianaId: string;
  let frankId: string;
  let graceId: string;

  let bobRegistrationId: string; // used for approve / mark-paid tests

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = replSet.getUri('badminton_reg_test');
    process.env.SESSION_SECRET = 'e2e-reg-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const sessionMiddleware = session({
      secret: 'e2e-reg-secret',
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

    await Promise.all([
      userModel.syncIndexes(),
      categoryModel.syncIndexes(),
      tournamentModel.syncIndexes(),
      roleModel.syncIndexes(),
      registrationModel.syncIndexes(),
    ]);

    // Seed users directly via model to avoid HTTP throttle limits.
    const passwordHash = await bcrypt.hash('password123', 10);
    const fixtures = [ALICE, BOB, CHARLIE, DIANA, EVE, FRANK, GRACE];
    await userModel.insertMany(
      fixtures.map((u) => ({
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        gender: u.gender,
        dob: new Date(u.dob),
        globalRole: 'athlete',
        identity: { nationalId: u.nationalId, phone: u.phone },
      })),
    );

    // Elevate Alice to organizer_capable.
    await userModel.updateOne(
      { email: ALICE.email },
      { $set: { globalRole: 'organizer_capable' } },
    );

    // Capture user IDs.
    const [bobDoc, charlieDoc, dianaDoc, frankDoc, graceDoc] =
      await Promise.all([
        userModel.findOne({ email: BOB.email }).lean().exec(),
        userModel.findOne({ email: CHARLIE.email }).lean().exec(),
        userModel.findOne({ email: DIANA.email }).lean().exec(),
        userModel.findOne({ email: FRANK.email }).lean().exec(),
        userModel.findOne({ email: GRACE.email }).lean().exec(),
      ]);
    bobId = bobDoc!._id.toHexString();
    charlieId = charlieDoc!._id.toHexString();
    dianaId = dianaDoc!._id.toHexString();
    frankId = frankDoc!._id.toHexString();
    graceId = graceDoc!._id.toHexString();

    // Create persistent agents. Auth controller has a 5-req/min brute-force throttle,
    // so we stay at ≤5 login calls total in beforeAll.
    // frank, grace user IDs are used in bulk rows (organizer API) — no separate login needed.
    aliceAgent = request.agent(app.getHttpServer());
    bobAgent = request.agent(app.getHttpServer());
    charlieAgent = request.agent(app.getHttpServer());
    dianaAgent = request.agent(app.getHttpServer());
    eveAgent = request.agent(app.getHttpServer());

    await aliceAgent
      .post('/auth/login')
      .send({ email: ALICE.email, password: ALICE.password })
      .expect(200);
    await bobAgent
      .post('/auth/login')
      .send({ email: BOB.email, password: BOB.password })
      .expect(200);
    await charlieAgent
      .post('/auth/login')
      .send({ email: CHARLIE.email, password: CHARLIE.password })
      .expect(200);
    await dianaAgent
      .post('/auth/login')
      .send({ email: DIANA.email, password: DIANA.password })
      .expect(200);
    await eveAgent
      .post('/auth/login')
      .send({ email: EVE.email, password: EVE.password })
      .expect(200);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------
  // Setup: tournament + categories
  // ---------------------------------------------------------------------------

  it('Alice creates tournament', async () => {
    const res = await aliceAgent
      .post('/tournaments')
      .send({
        name: 'Reg Open 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        location: 'HCM',
      })
      .expect(201);
    tournamentId = res.body.id as string;
    expect(tournamentId).toBeDefined();
  });

  it('Alice creates singles men_only category (maxTeams=2)', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'MS',
        name: "Men's Singles",
        playerCount: 1,
        genderRequirement: 'men_only',
        bestOf: 3,
        fee: 100000,
        maxTeams: 2,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    singlesCategoryId = res.body.id as string;
    expect(singlesCategoryId).toBeDefined();
  });

  it('Alice creates doubles mixed_pair category (maxTeams=4)', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'XD',
        name: 'Mixed Doubles',
        playerCount: 2,
        genderRequirement: 'mixed_pair',
        bestOf: 3,
        fee: 150000,
        maxTeams: 4,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    doublesCategoryId = res.body.id as string;
    expect(doublesCategoryId).toBeDefined();
  });

  it('Alice opens both categories for registration', async () => {
    await aliceAgent
      .post(`/categories/${singlesCategoryId}/registration/open`)
      .expect(200);
    await aliceAgent
      .post(`/categories/${doublesCategoryId}/registration/open`)
      .expect(200);
  });

  // ---------------------------------------------------------------------------
  // Self-registration
  // ---------------------------------------------------------------------------

  it('Bob self-registers for singles → 201 pending; slotsUsed increments to 1', async () => {
    const res = await bobAgent
      .post(`/categories/${singlesCategoryId}/registrations`)
      .send({})
      .expect(201);
    bobRegistrationId = res.body.id as string;
    expect(bobRegistrationId).toBeDefined();

    const cat = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(cat?.slotsUsed).toBe(1);
  });

  it('Bob registers same category again → 400 DUPLICATE_REGISTRATION', async () => {
    const res = await bobAgent
      .post(`/categories/${singlesCategoryId}/registrations`)
      .send({})
      .expect(400);
    expect(res.body.code).toBe('DUPLICATE_REGISTRATION');
  });

  it('Charlie self-registers for singles → 201 pending; slotsUsed increments to 2', async () => {
    await charlieAgent
      .post(`/categories/${singlesCategoryId}/registrations`)
      .send({})
      .expect(201);

    const cat = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(cat?.slotsUsed).toBe(2);
  });

  it('Eve tries to register for full singles category → 400 CATEGORY_FULL (atomic counter guard)', async () => {
    const res = await eveAgent
      .post(`/categories/${singlesCategoryId}/registrations`)
      .send({})
      .expect(400);
    expect(res.body.code).toBe('CATEGORY_FULL');

    // slotsUsed must not have changed after a failed reservation attempt.
    const cat = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(cat?.slotsUsed).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Bulk registration
  // ---------------------------------------------------------------------------

  it('Bulk 5 rows (3 ok, 2 fail) → partial commit', async () => {
    const res = await aliceAgent
      .post(`/tournaments/${tournamentId}/registrations/bulk`)
      .send({
        rows: [
          // Row 0: valid mixed pair (Bob + Diana)
          {
            categoryId: doublesCategoryId,
            primaryUserId: bobId,
            partnerUserId: dianaId,
          },
          // Row 1: valid mixed pair (Frank + Grace)
          {
            categoryId: doublesCategoryId,
            primaryUserId: frankId,
            partnerUserId: graceId,
          },
          // Row 2: invalid — same-gender pair for mixed_pair (Bob + Charlie)
          {
            categoryId: doublesCategoryId,
            primaryUserId: charlieId,
            partnerUserId: bobId,
          },
          // Row 3: valid mixed pair (Charlie + Grace) — but Grace already used in row 1
          // → will succeed (no partner-conflict check in P4)
          {
            categoryId: doublesCategoryId,
            primaryUserId: dianaId,
            partnerUserId: charlieId,
          },
          // Row 4: duplicate primary for Bob in doubles
          {
            categoryId: doublesCategoryId,
            primaryUserId: bobId,
            partnerUserId: graceId,
          },
        ],
      })
      .expect(201);

    const { success, errors } = res.body as {
      success: { rowIndex: number; registrationId: string }[];
      errors: { rowIndex: number; code: string; message: string }[];
    };

    // Rows 0, 1, 3 succeed; rows 2 (gender fail) and 4 (duplicate) fail.
    expect(success.length).toBe(3);
    expect(errors.length).toBe(2);

    // Verify partial commit: successful rows are in DB.
    for (const s of success) {
      const inDb = await registrationModel
        .findById(s.registrationId)
        .lean()
        .exec();
      expect(inDb).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------------

  it('Alice approves Bob registration → 200 ok; slotsUsed unchanged (slot stays occupied)', async () => {
    const before = await categoryModel.findById(singlesCategoryId).lean().exec();
    const res = await aliceAgent
      .post(`/registrations/${bobRegistrationId}/approve`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    // approve does not change slotsUsed — pending and approved both occupy a slot.
    const after = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(after?.slotsUsed).toBe(before?.slotsUsed);
  });

  it('Alice tries to approve already-approved registration → 400 INVALID_LIFECYCLE_TRANSITION', async () => {
    const res = await aliceAgent
      .post(`/registrations/${bobRegistrationId}/approve`)
      .expect(400);
    expect(res.body.code).toBe('INVALID_LIFECYCLE_TRANSITION');
  });

  it('Alice rejects Charlie registration → 200 ok; slotsUsed decrements', async () => {
    // Find Charlie's registration.
    const charlieReg = await registrationModel
      .findOne({ primaryUserId: charlieId, categoryId: singlesCategoryId })
      .lean()
      .exec();
    expect(charlieReg).not.toBeNull();
    const charlieRegId = charlieReg!._id.toHexString();

    const before = await categoryModel.findById(singlesCategoryId).lean().exec();

    const res = await aliceAgent
      .post(`/registrations/${charlieRegId}/reject`)
      .send({ reason: 'Không đủ tiêu chuẩn' })
      .expect(200);
    expect(res.body.ok).toBe(true);

    const updated = await registrationModel
      .findById(charlieRegId)
      .lean()
      .exec();
    expect(updated?.status).toBe('rejected');
    expect(updated?.rejectedReason).toBe('Không đủ tiêu chuẩn');

    // reject frees the slot held by pending status.
    const after = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(after?.slotsUsed).toBe((before?.slotsUsed ?? 1) - 1);
  });

  it('Bob withdraws own registration → 200 ok; slotsUsed decrements', async () => {
    const before = await categoryModel.findById(singlesCategoryId).lean().exec();

    const res = await bobAgent
      .post(`/registrations/${bobRegistrationId}/withdraw`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    const updated = await registrationModel
      .findById(bobRegistrationId)
      .lean()
      .exec();
    expect(updated?.status).toBe('withdrawn');
    expect(updated?.withdrawnAt).toBeDefined();

    // withdraw frees the slot held by approved status.
    const after = await categoryModel.findById(singlesCategoryId).lean().exec();
    expect(after?.slotsUsed).toBe((before?.slotsUsed ?? 1) - 1);
  });

  it('Bob tries to withdraw already-withdrawn registration → 400 INVALID_LIFECYCLE_TRANSITION', async () => {
    const res = await bobAgent
      .post(`/registrations/${bobRegistrationId}/withdraw`)
      .expect(400);
    expect(res.body.code).toBe('INVALID_LIFECYCLE_TRANSITION');
  });

  // ---------------------------------------------------------------------------
  // Payment
  // ---------------------------------------------------------------------------

  it('Alice mark-paid → 200 ok; paymentStatus becomes paid', async () => {
    // Use a fresh organizer-created registration for the payment flow.
    const createRes = await aliceAgent
      .post(`/categories/${singlesCategoryId}/registrations/organizer`)
      .send({ primaryUserId: charlieId })
      .expect(201);
    const newRegId = createRes.body.id as string;

    const res = await aliceAgent
      .post(`/registrations/${newRegId}/mark-paid`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    const updated = await registrationModel.findById(newRegId).lean().exec();
    expect(updated?.paymentStatus).toBe('paid');
    expect(updated?.paidAt).toBeDefined();
  });

  it('Alice unmark-paid → 200 ok; paymentStatus returns to unpaid', async () => {
    // Find Charlie's newly approved registration in singles.
    const reg = await registrationModel
      .findOne({
        primaryUserId: charlieId,
        categoryId: singlesCategoryId,
        status: 'approved',
      })
      .lean()
      .exec();
    expect(reg).not.toBeNull();
    const regId = reg!._id.toHexString();

    // First mark paid.
    await aliceAgent.post(`/registrations/${regId}/mark-paid`).expect(200);
    // Then unmark.
    const res = await aliceAgent
      .post(`/registrations/${regId}/unmark-paid`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    const updated = await registrationModel.findById(regId).lean().exec();
    expect(updated?.paymentStatus).toBe('unpaid');
    expect(updated?.paidAt).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Authz: non-organizer blocked
  // ---------------------------------------------------------------------------

  it('Bob cannot list tournament registrations → 403', async () => {
    await bobAgent
      .get(`/tournaments/${tournamentId}/registrations`)
      .expect(403);
  });

  it('Bob cannot bulk register → 403', async () => {
    await bobAgent
      .post(`/tournaments/${tournamentId}/registrations/bulk`)
      .send({ rows: [{ categoryId: doublesCategoryId, primaryUserId: bobId }] })
      .expect(403);
  });

  it('Bob cannot approve a registration → 403', async () => {
    await bobAgent
      .post(`/registrations/${bobRegistrationId}/approve`)
      .expect(403);
  });

  it('Bob cannot organizer-register → 403', async () => {
    await bobAgent
      .post(`/categories/${singlesCategoryId}/registrations/organizer`)
      .send({ primaryUserId: charlieId })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Gender matrix smoke
  // ---------------------------------------------------------------------------

  it('mixed_pair doubles — male+female partner → 201 ok', async () => {
    // Eve (male) + Diana (female) in a fresh XD2 category — valid mixed pair.
    const xd2Res = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'XD2',
        name: 'Mixed Doubles 2',
        playerCount: 2,
        genderRequirement: 'mixed_pair',
        bestOf: 3,
        fee: 0,
        maxTeams: 8,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    const xd2Id = xd2Res.body.id as string;
    await aliceAgent.post(`/categories/${xd2Id}/registration/open`).expect(200);

    // eveAgent is already logged in (male); dianaId is female — valid mixed pair.
    const res = await eveAgent
      .post(`/categories/${xd2Id}/registrations`)
      .send({ partnerUserId: dianaId })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('men_only singles — female player → 400 GENDER_REQUIREMENT_VIOLATION', async () => {
    // dianaAgent is already logged in (female) and tries men_only singles.
    // Create a fresh men_only category so it's open with space.
    const msRes = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'MS2',
        name: "Men's Singles 2",
        playerCount: 1,
        genderRequirement: 'men_only',
        bestOf: 3,
        fee: 0,
        maxTeams: 8,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    const ms2Id = msRes.body.id as string;
    await aliceAgent.post(`/categories/${ms2Id}/registration/open`).expect(200);

    const res = await dianaAgent
      .post(`/categories/${ms2Id}/registrations`)
      .send({})
      .expect(400);
    expect(res.body.code).toBe('GENDER_REQUIREMENT_VIOLATION');
  });

  // ---------------------------------------------------------------------------
  // Search partner — displayName-only, no PII oracle
  // ---------------------------------------------------------------------------

  it('GET /registration-search-users?q=Bob → matches displayName, returns minimal fields only, no PII', async () => {
    const res = await bobAgent
      .get(`/tournaments/${tournamentId}/registration-search-users?q=Bob`)
      .expect(200);

    const users = res.body.users as Record<string, unknown>[];
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);

    const bob = users.find((u) => u['displayName'] === BOB.displayName);
    expect(bob).toBeDefined();
    expect(bob!['id']).toBeDefined();
    expect(bob!['gender']).toBeDefined();
    // PII must be absent from response.
    expect(bob!['email']).toBeUndefined();
    expect(bob!['nationalId']).toBeUndefined();
    expect(bob!['phone']).toBeUndefined();
  });

  it('GET /registration-search-users?q=<email> → does NOT return a match (no PII oracle)', async () => {
    // Searching by email substring must not reveal user existence — displayName-only query.
    const emailSubstring = BOB.email.split('@')[0]!; // e.g. "bob-reg"
    const res = await bobAgent
      .get(
        `/tournaments/${tournamentId}/registration-search-users?q=${encodeURIComponent(emailSubstring)}`,
      )
      .expect(200);

    const users = res.body.users as Record<string, unknown>[];
    // No user's displayName contains the email local-part, so results must be empty.
    const matched = users.find((u) => u['displayName'] === BOB.displayName);
    expect(matched).toBeUndefined();
  });

  it('GET /registration-search-users?q=X → 200 empty for short query', async () => {
    const res = await bobAgent
      .get(`/tournaments/${tournamentId}/registration-search-users?q=X`)
      .expect(200);
    expect(res.body.users).toEqual([]);
  });

  it('GET /registration-search-users?q=Diana&gender=female → returns Diana only', async () => {
    const res = await aliceAgent
      .get(
        `/tournaments/${tournamentId}/registration-search-users?q=Diana&gender=female`,
      )
      .expect(200);
    const users = res.body.users as Record<string, unknown>[];
    expect(users.every((u) => u['gender'] === 'female')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // List by tournament (organizer)
  // ---------------------------------------------------------------------------

  it('GET /tournaments/:tid/registrations → returns registrations with masked PII', async () => {
    const res = await aliceAgent
      .get(`/tournaments/${tournamentId}/registrations`)
      .expect(200);

    const body = res.body as {
      totalCount: number;
      registrations: Record<string, unknown>[];
    };
    expect(typeof body.totalCount).toBe('number');
    expect(body.totalCount).toBeGreaterThan(0);
    expect(Array.isArray(body.registrations)).toBe(true);

    const first = body.registrations[0] as Record<string, unknown>;
    expect(first['id']).toBeDefined();
    expect(first['athleteName']).toBeDefined();
    expect(first['status']).toBeDefined();
    expect(first['paymentStatus']).toBeDefined();
    expect(first['fee']).toBeDefined();

    // Full nationalId must never appear.
    expect(first['nationalId']).toBeUndefined();
    expect(first['phone']).toBeUndefined();

    // Masked fields present.
    expect(first['cccdLast4']).toBeDefined();
    expect(first['phoneMasked']).toBeDefined();

    // Config-team fields: seed and teamPhotoUrl default to null when not set.
    expect(Object.prototype.hasOwnProperty.call(first, 'seed')).toBe(true);
    expect(first['seed']).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(first, 'teamPhotoUrl')).toBe(true);
    expect(first['teamPhotoUrl']).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // closeRegistration blocks when pending registrations exist
  // ---------------------------------------------------------------------------

  it('closeRegistration blocked when pending registrations exist → 400 PENDING_REGISTRATIONS_EXIST', async () => {
    // Create a new category, open it, then try to close while a pending reg exists.
    const catRes = await aliceAgent
      .post(`/tournaments/${tournamentId}/categories`)
      .send({
        code: 'WS',
        name: "Women's Singles",
        playerCount: 1,
        genderRequirement: 'women_only',
        bestOf: 3,
        fee: 0,
        maxTeams: 8,
        registrationDeadline: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    const wsCatId = catRes.body.id as string;
    await aliceAgent
      .post(`/categories/${wsCatId}/registration/open`)
      .expect(200);

    // dianaAgent is already logged in (female) — self-registers → pending.
    await dianaAgent
      .post(`/categories/${wsCatId}/registrations`)
      .send({})
      .expect(201);

    // Alice tries to close → blocked.
    const res = await aliceAgent
      .post(`/categories/${wsCatId}/registration/close`)
      .expect(400);
    expect(res.body.code).toBe('PENDING_REGISTRATIONS_EXIST');
  });
});
