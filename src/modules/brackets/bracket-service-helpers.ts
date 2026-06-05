/**
 * Pure helper utilities for BracketsService — split out to keep service under 200 LOC.
 * No NestJS decorators here, just functions.
 */
import type { MatchDocument } from '../../schemas/match.schema';
import type { MatchPlan, SkeletonConfig } from '../../domain/bracket/types';
import { DomainError } from '../../common/domain-error';
import type { CreateSkeletonDto } from './dto/create-skeleton.dto';

/**
 * Converts a domain MatchPlan to a Mongoose match insert object.
 * All sides are null at skeleton creation time — filled during draw.
 */
export function matchPlanToDoc(
  plan: MatchPlan,
  bracketId: string,
  categoryId: string,
  format: string,
): Record<string, unknown> {
  return {
    bracketId,
    categoryId,
    format,
    round: plan.round,
    slotIndex: plan.slotIndex,
    groupKey: plan.groupKey,
    matchIndex: plan.matchIndex,
    isBye: plan.isBye,
    status: plan.status,
    nextMatchId: plan.nextMatchId,
    winnerSide: plan.winnerSide,
    sideA: null,
    sideB: null,
  };
}

/**
 * Maps domain MatchPlan ids → stored MongoDB _id strings.
 * Matches by structural position:
 *   - round + slotIndex  → single_elim / group_ko KO rounds
 *   - groupKey + matchIndex → group_ko group-stage matches
 *   - matchIndex alone   → pure round_robin (round and groupKey both undefined)
 */
export function buildPlanToStoredMapping(
  planMatches: MatchPlan[],
  storedMatches: MatchDocument[],
): Map<string, string> {
  const map = new Map<string, string>();

  for (const plan of planMatches) {
    let stored: MatchDocument | undefined;

    if (plan.round !== undefined && plan.slotIndex !== undefined) {
      // KO match (single_elim or group_ko KO round)
      stored = storedMatches.find(
        (m) => m.round === plan.round && m.slotIndex === plan.slotIndex,
      );
    } else if (plan.groupKey !== undefined && plan.matchIndex !== undefined) {
      // Group-stage match (group_ko)
      stored = storedMatches.find(
        (m) => m.groupKey === plan.groupKey && m.matchIndex === plan.matchIndex,
      );
    } else if (plan.round === undefined && plan.groupKey === undefined && plan.matchIndex !== undefined) {
      // Pure round_robin — keyed by matchIndex alone
      stored = storedMatches.find(
        (m) => m.round === undefined && m.groupKey === undefined && m.matchIndex === plan.matchIndex,
      );
    }

    if (stored) {
      map.set(plan.id, stored._id.toHexString());
    }
  }

  return map;
}

/**
 * Validates group_ko config from the DTO and returns a typed SkeletonConfig.
 * Throws DomainError(INVALID_GROUP_CONFIG) on any constraint violation.
 */
export function validateAndExtractGroupConfig(dto: CreateSkeletonDto, N: number): SkeletonConfig {
  const { groupCount, qualifyPerGroup } = dto;
  if (!groupCount || !qualifyPerGroup) {
    throw new DomainError('INVALID_GROUP_CONFIG', 'Thể thức group_ko yêu cầu groupCount và qualifyPerGroup.');
  }
  if (groupCount < 2) throw new DomainError('INVALID_GROUP_CONFIG', 'groupCount phải >= 2.');
  if (qualifyPerGroup < 1) throw new DomainError('INVALID_GROUP_CONFIG', 'qualifyPerGroup phải >= 1.');
  if (groupCount * qualifyPerGroup > N) {
    throw new DomainError('INVALID_GROUP_CONFIG', 'groupCount × qualifyPerGroup không được vượt quá số đội đã duyệt.');
  }
  return { groupCount, qualifyPerGroup };
}

/**
 * Translates domain Error messages (plain strings thrown by domain functions)
 * into typed DomainErrors with the correct HTTP status code.
 * Returns void if the error is not a known domain message (caller should re-throw).
 */
export function mapDomainError(err: unknown): never | void {
  if (!(err instanceof Error)) return;
  switch (err.message) {
    case 'NOT_ENOUGH_PARTICIPANTS':
      throw new DomainError(
        'NOT_ENOUGH_PARTICIPANTS',
        'Cần ít nhất 2 đội để tạo lịch thi đấu.',
        409,
      );
    case 'INVALID_SEED':
      throw new DomainError('INVALID_SEED', 'Seed không hợp lệ.', 400);
    case 'INVALID_GROUP_CONFIG':
      throw new DomainError(
        'INVALID_GROUP_CONFIG',
        'Cấu hình nhóm không hợp lệ.',
        400,
      );
  }
}
