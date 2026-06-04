/**
 * Pure domain validation — no framework or persistence imports.
 * Checks structural eligibility of a partner assignment before any DB lookup.
 * Existence in the system is validated at the service layer via DB query.
 */

export interface EligibilityResult {
  ok: boolean;
  error?: string;
}

/**
 * Asserts that the partner selection is structurally valid:
 * - A player cannot nominate themselves as their own partner.
 *
 * Remaining checks (partner account exists, partner not already registered
 * in a conflicting category) are handled by the service layer where the DB
 * is available.
 */
export function assertPartnerEligible(
  primaryUserId: string,
  partnerUserId: string,
): EligibilityResult {
  if (primaryUserId === partnerUserId) {
    return { ok: false, error: 'Không tự ghép đôi.' };
  }
  return { ok: true };
}
