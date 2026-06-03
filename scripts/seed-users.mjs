// Seed 100 VĐV vào MongoDB (stack mới NestJS): test1@fbshop.vn .. test100@fbshop.vn / 12345678
// Họ tên theo các VĐV cầu lông nổi tiếng. Idempotent: upsert theo email.
// Chạy: node scripts/seed-users.mjs  (hoặc: pnpm seed:users). Yêu cầu Mongo đang chạy.
import { readFileSync, existsSync } from 'node:fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/badminton?replicaSet=rs0&directConnection=true';
const COUNT = 100;
const PASSWORD = '12345678';

// VĐV cầu lông nổi tiếng (name + giới tính)
const PLAYERS = [
  ['Lin Dan', 'male'], ['Lee Chong Wei', 'male'], ['Viktor Axelsen', 'male'], ['Kento Momota', 'male'],
  ['Chen Long', 'male'], ['Taufik Hidayat', 'male'], ['Peter Gade', 'male'], ['Lee Yong-dae', 'male'],
  ['Hendra Setiawan', 'male'], ['Mohammad Ahsan', 'male'], ['Anthony Ginting', 'male'], ['Jonatan Christie', 'male'],
  ['Kevin Sanjaya', 'male'], ['Marcus Gideon', 'male'], ['Loh Kean Yew', 'male'], ['Anders Antonsen', 'male'],
  ['Lakshya Sen', 'male'], ['Shi Yuqi', 'male'], ['Lee Zii Jia', 'male'], ['Kidambi Srikanth', 'male'],
  ['Chou Tien-chen', 'male'], ['Ng Ka Long', 'male'], ['Jan Jorgensen', 'male'], ['Tommy Sugiarto', 'male'],
  ['Son Wan-ho', 'male'], ['Zheng Siwei', 'male'], ['Wang Yilyu', 'male'], ['Fu Haifeng', 'male'],
  ['Cai Yun', 'male'], ['Zhang Nan', 'male'], ['Praveen Jordan', 'male'], ['Mathias Boe', 'male'],
  ['Carsten Mogensen', 'male'], ['Vladimir Ivanov', 'male'],
  ['Carolina Marin', 'female'], ['Tai Tzu-ying', 'female'], ['Akane Yamaguchi', 'female'], ['Chen Yufei', 'female'],
  ['Ratchanok Intanon', 'female'], ['P.V. Sindhu', 'female'], ['Saina Nehwal', 'female'], ['Nozomi Okuhara', 'female'],
  ['He Bingjiao', 'female'], ['An Se-young', 'female'], ['Wang Yihan', 'female'], ['Li Xuerui', 'female'],
  ['Zhang Ning', 'female'], ['Wang Shixian', 'female'], ['Sung Ji-hyun', 'female'], ['Busanan Ongbamrung', 'female'],
  ['Pornpawee Chochuwong', 'female'], ['Mia Blichfeldt', 'female'], ['Michelle Li', 'female'], ['Beiwen Zhang', 'female'],
  ['Gregoria Tunjung', 'female'], ['Supanida Katethong', 'female'], ['Greysia Polii', 'female'], ['Apriyani Rahayu', 'female'],
  ['Misaki Matsutomo', 'female'], ['Ayaka Takahashi', 'female'], ['Huang Yaqiong', 'female'], ['Chen Qingchen', 'female'],
  ['Jia Yifan', 'female'], ['Zhao Yunlei', 'female'], ['Yui Hashimoto', 'female'], ['Pusarla Sindhu', 'female'],
];

const pad = (n, len) => String(n).padStart(len, '0');

// bcrypt cost 10 mất ~70ms/hash; hash 1 lần dùng chung (cùng password) để seed nhanh.
let sharedHash;
let usersCol;

async function seedOne(i) {
  const email = `test${i}@fbshop.vn`;
  const [baseName, gender] = PLAYERS[(i - 1) % PLAYERS.length];
  const cycle = Math.floor((i - 1) / PLAYERS.length);
  const displayName = cycle > 0 ? `${baseName} ${cycle + 1}` : baseName;
  const nationalId = String(100000000000 + i); // 12 số, unique
  const dob = new Date(`${1985 + (i % 15)}-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`);
  const phone = `09${pad(10000000 + i, 8).slice(-8)}`;

  await usersCol.updateOne(
    { email },
    {
      $set: {
        email,
        passwordHash: sharedHash,
        displayName,
        gender,
        dob,
        avatarUrl: null,
        globalRole: 'athlete',
        identity: { nationalId, phone },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return displayName;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  usersCol = mongoose.connection.collection('users');
  await usersCol.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await usersCol.createIndex({ 'identity.nationalId': 1 }, { unique: true }).catch(() => {});
  sharedHash = await bcrypt.hash(PASSWORD, 10);

  let done = 0;
  const CONCURRENCY = 10;
  for (let start = 1; start <= COUNT; start += CONCURRENCY) {
    const batch = [];
    for (let i = start; i < start + CONCURRENCY && i <= COUNT; i++) batch.push(seedOne(i));
    await Promise.all(batch);
    done += batch.length;
    console.log(`  …${done}/${COUNT}`);
  }
  console.log(`✓ Đã seed ${COUNT} VĐV: test1..test${COUNT}@fbshop.vn / ${PASSWORD}  (globalRole=athlete)`);
  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error('✗ Seed lỗi:', e?.message ?? e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
