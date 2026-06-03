import { isValidNationalId } from './national-id-format';

describe('isValidNationalId', () => {
  it('accepts exactly 12 digits', () => {
    expect(isValidNationalId('012345678901')).toBe(true);
  });

  it.each(['', '1234567890', '0123456789012', 'abcdefghijkl', '01234567890a'])(
    'rejects invalid %p',
    (v) => {
      expect(isValidNationalId(v)).toBe(false);
    },
  );
});
