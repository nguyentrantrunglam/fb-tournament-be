import {
  validateGenderRequirement,
  type CategoryConfig,
  type PlayerRef,
} from './gender-requirement';

const male: PlayerRef = { userId: 'u1', gender: 'male' };
const female: PlayerRef = { userId: 'u2', gender: 'female' };
const male2: PlayerRef = { userId: 'u3', gender: 'male' };
const female2: PlayerRef = { userId: 'u4', gender: 'female' };

// ---------------------------------------------------------------------------
// Singles (playerCount === 1)
// ---------------------------------------------------------------------------

describe('singles playerCount=1', () => {
  it('men_only + male primary → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'men_only',
    };
    expect(validateGenderRequirement(cat, male)).toEqual({ ok: true });
  });

  it('men_only + female primary → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'men_only',
    };
    const result = validateGenderRequirement(cat, female);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('women_only + female primary → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'women_only',
    };
    expect(validateGenderRequirement(cat, female)).toEqual({ ok: true });
  });

  it('women_only + male primary → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'women_only',
    };
    const result = validateGenderRequirement(cat, male);
    expect(result.ok).toBe(false);
  });

  it('unrestricted + any gender → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'unrestricted',
    };
    expect(validateGenderRequirement(cat, male)).toEqual({ ok: true });
    expect(validateGenderRequirement(cat, female)).toEqual({ ok: true });
  });

  it('mixed_pair on singles → throws INVALID_CATEGORY_CONFIG', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'mixed_pair',
    };
    expect(() => validateGenderRequirement(cat, male)).toThrow(
      'INVALID_CATEGORY_CONFIG',
    );
  });

  it('men_only + male primary + partner present → reject (singles cannot have partner)', () => {
    const cat: CategoryConfig = {
      playerCount: 1,
      genderRequirement: 'men_only',
    };
    const result = validateGenderRequirement(cat, male, female);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/partner/);
  });
});

// ---------------------------------------------------------------------------
// Doubles (playerCount === 2)
// ---------------------------------------------------------------------------

describe('doubles playerCount=2', () => {
  it('men_only + both male → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'men_only',
    };
    expect(validateGenderRequirement(cat, male, male2)).toEqual({ ok: true });
  });

  it('men_only + one female → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'men_only',
    };
    const result = validateGenderRequirement(cat, male, female);
    expect(result.ok).toBe(false);
  });

  it('women_only + both female → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'women_only',
    };
    expect(validateGenderRequirement(cat, female, female2)).toEqual({
      ok: true,
    });
  });

  it('women_only + one male → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'women_only',
    };
    const result = validateGenderRequirement(cat, female, male);
    expect(result.ok).toBe(false);
  });

  it('mixed_pair + male+female → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'mixed_pair',
    };
    expect(validateGenderRequirement(cat, male, female)).toEqual({ ok: true });
  });

  it('mixed_pair + female+male (reversed) → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'mixed_pair',
    };
    expect(validateGenderRequirement(cat, female, male)).toEqual({ ok: true });
  });

  it('mixed_pair + both male → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'mixed_pair',
    };
    const result = validateGenderRequirement(cat, male, male2);
    expect(result.ok).toBe(false);
  });

  it('mixed_pair + both female → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'mixed_pair',
    };
    const result = validateGenderRequirement(cat, female, female2);
    expect(result.ok).toBe(false);
  });

  it('unrestricted + any combination → ok', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'unrestricted',
    };
    expect(validateGenderRequirement(cat, male, female)).toEqual({ ok: true });
    expect(validateGenderRequirement(cat, male, male2)).toEqual({ ok: true });
    expect(validateGenderRequirement(cat, female, female2)).toEqual({
      ok: true,
    });
  });

  it('doubles + no partner → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'men_only',
    };
    const result = validateGenderRequirement(cat, male);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/partner/);
  });

  it('doubles + self-pair (same userId) → reject', () => {
    const cat: CategoryConfig = {
      playerCount: 2,
      genderRequirement: 'unrestricted',
    };
    const result = validateGenderRequirement(cat, male, male); // same object = same userId
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tự ghép/);
  });
});
