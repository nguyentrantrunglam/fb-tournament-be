/**
 * Internal helpers for fill-draw.ts — format-specific fill logic.
 * Kept separate to hold fill-draw.ts under 200 LOC.
 */
import { resolveSeeds } from './resolve-seeds';
import { placeIntoSlots } from './place-into-slots';
import { advanceByeWinners } from './advance-bye-winners';
import type { DrawReg, MatchPlan, SidePlan, SkeletonPlan } from './types';

function toSide(
  regOrBye: DrawReg | 'BYE',
  regToSeed: Map<string, number>,
): SidePlan | null {
  if (regOrBye === 'BYE') return null;
  return {
    seed: regToSeed.get(regOrBye.registrationId) ?? null,
    registrationId: regOrBye.registrationId,
    name: regOrBye.name,
    partnerName: regOrBye.partnerName ?? null,
    score: null,
  };
}

export function fillSingleElim(
  skeleton: SkeletonPlan,
  matches: MatchPlan[],
  regs: DrawReg[],
  rng: () => number,
): SkeletonPlan {
  const bracketSize = skeleton.bracketSize as number;
  const N = regs.length;

  const seedMap = resolveSeeds(regs, rng);
  const slotToReg = placeIntoSlots(bracketSize, N, seedMap);

  const regToSeed = new Map<string, number>();
  for (const [seed, reg] of seedMap) {
    regToSeed.set(reg.registrationId, seed);
  }

  const matchMap = new Map<string, MatchPlan>(matches.map((m) => [m.id, m]));
  const r1Matches = matches.filter((m) => m.round === 1);

  for (const m of r1Matches) {
    const i = m.slotIndex as number;
    const regA = slotToReg[2 * i] ?? 'BYE';
    const regB = slotToReg[2 * i + 1] ?? 'BYE';

    m.sideA = toSide(regA, regToSeed);
    m.sideB = toSide(regB, regToSeed);

    if (m.isBye) {
      m.winnerSide = m.sideA !== null ? 'A' : 'B';
      m.status = 'completed';
    }
  }

  advanceByeWinners(r1Matches, matchMap);
  return { ...skeleton, matches };
}

export function fillRoundRobin(
  skeleton: SkeletonPlan,
  matches: MatchPlan[],
  regs: DrawReg[],
  rng: () => number,
): SkeletonPlan {
  const N = regs.length;
  const seedMap = resolveSeeds(regs, rng);

  const orderedRegs: DrawReg[] = [];
  for (let s = 1; s <= N; s++) {
    const reg = seedMap.get(s);
    if (reg) orderedRegs.push(reg);
  }

  let matchIndex = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const m = matches[matchIndex];
      if (!m) break;
      const regA = orderedRegs[i];
      const regB = orderedRegs[j];
      if (regA) {
        m.sideA = {
          seed: regA.seed,
          registrationId: regA.registrationId,
          name: regA.name,
          partnerName: regA.partnerName ?? null,
          score: null,
        };
      }
      if (regB) {
        m.sideB = {
          seed: regB.seed,
          registrationId: regB.registrationId,
          name: regB.name,
          partnerName: regB.partnerName ?? null,
          score: null,
        };
      }
      matchIndex++;
    }
  }
  return { ...skeleton, matches };
}

export function fillGroupKo(
  skeleton: SkeletonPlan,
  matches: MatchPlan[],
  regs: DrawReg[],
  rng: () => number,
): SkeletonPlan {
  const groupCount = skeleton.groupCount as number;
  const N = regs.length;

  const seedMap = resolveSeeds(regs, rng);
  const orderedRegs: DrawReg[] = [];
  for (let s = 1; s <= N; s++) {
    const reg = seedMap.get(s);
    if (reg) orderedRegs.push(reg);
  }

  // Wrap-around distribution: seed1→A, seed2→B, ..., seed(groupCount+1)→A, etc.
  const groupRegs: DrawReg[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < orderedRegs.length; i++) {
    const gIdx = i % groupCount;
    const reg = orderedRegs[i];
    if (reg) (groupRegs[gIdx] as DrawReg[]).push(reg);
  }

  const groupKeys = Array.from({ length: groupCount }, (_, i) =>
    String.fromCharCode(65 + i),
  );

  const catPrefix = skeleton.categoryId;

  for (let g = 0; g < groupCount; g++) {
    const gKey = groupKeys[g] as string;
    const gRegs = groupRegs[g] as DrawReg[];
    let matchIndex = 0;

    for (let i = 0; i < gRegs.length; i++) {
      for (let j = i + 1; j < gRegs.length; j++) {
        const expectedId = `${catPrefix}-G${gKey}-M${matchIndex}`;
        const m = matches.find((x) => x.id === expectedId);
        if (!m) { matchIndex++; continue; }

        const regA = gRegs[i];
        const regB = gRegs[j];
        if (regA) {
          m.sideA = {
            seed: regA.seed,
            registrationId: regA.registrationId,
            name: regA.name,
            partnerName: regA.partnerName ?? null,
            score: null,
          };
        }
        if (regB) {
          m.sideB = {
            seed: regB.seed,
            registrationId: regB.registrationId,
            name: regB.name,
            partnerName: regB.partnerName ?? null,
            score: null,
          };
        }
        matchIndex++;
      }
    }
  }

  // KO match sides remain as placeholder labels set at skeleton build time
  return { ...skeleton, matches };
}
