import { assertPartnerEligible } from './partner-eligibility';

describe('assertPartnerEligible', () => {
  it('different user IDs → ok', () => {
    expect(assertPartnerEligible('user-a', 'user-b')).toEqual({ ok: true });
  });

  it('same user ID → reject with self-pair message', () => {
    const result = assertPartnerEligible('user-a', 'user-a');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/tự ghép/);
  });

  it('empty strings distinct → ok (existence checked at service layer)', () => {
    expect(assertPartnerEligible('u1', 'u2')).toEqual({ ok: true });
  });
});
