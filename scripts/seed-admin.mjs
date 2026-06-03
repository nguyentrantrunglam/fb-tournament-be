// Seed 1 tài khoản admin vào MongoDB (stack mới NestJS).
// Idempotent: upsert theo email. Chạy: node scripts/seed-admin.mjs  (hoặc: pnpm seed:admin)
// Yêu cầu: Mongo đang chạy (docker compose up -d mongo). Đọc MONGO_URI từ .env.
import { readFileSync, existsSync } from 'node:fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// ── Load .env (đơn giản) ─────────────────────────────────────────────────────
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/badminton?replicaSet=rs0&directConnection=true';

const EMAIL = 'nguyentrantrunglam@gmail.com';
const PASSWORD = '12345678';
const DISPLAY_NAME = 'Nguyễn Trần Trung Lâm';
const NATIONAL_ID = '000000000001'; // 12 số, unique (schema bắt buộc nationalId)

async function run() {
  await mongoose.connect(MONGO_URI);
  const users = mongoose.connection.collection('users');
  // Đảm bảo unique index tồn tại (giống schema) — chống trùng email / nationalId.
  await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await users.createIndex({ 'identity.nationalId': 1 }, { unique: true }).catch(() => {});

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await users.updateOne(
    { email: EMAIL },
    {
      $set: {
        email: EMAIL,
        passwordHash,
        displayName: DISPLAY_NAME,
        gender: 'male',
        dob: new Date('1990-01-01'),
        avatarUrl: null,
        globalRole: 'admin',
        identity: { nationalId: NATIONAL_ID, phone: null },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  console.log(`✓ Admin sẵn sàng: ${EMAIL} / ${PASSWORD}  (globalRole=admin)`);
  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error('✗ Seed lỗi:', e?.message ?? e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
