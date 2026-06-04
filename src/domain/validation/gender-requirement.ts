/**
 * Pure domain validation — no framework or persistence imports.
 * Validates that the primary (and optional partner) user satisfies the
 * category's gender requirement before a registration is created.
 */

export type GenderReq =
  | 'men_only'
  | 'women_only'
  | 'mixed_pair'
  | 'unrestricted';

export interface PlayerRef {
  userId: string;
  gender: 'male' | 'female';
}

export interface CategoryConfig {
  playerCount: 1 | 2;
  genderRequirement: GenderReq;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const ok: ValidationResult = { ok: true };
const reject = (error: string): ValidationResult => ({ ok: false, error });

/**
 * Validates the gender requirement for a registration attempt.
 *
 * Singles (playerCount=1): partner must be absent; gender rule applied to primary only.
 * Doubles (playerCount=2): partner must be present and must differ from primary.
 * mixed_pair on singles is a category config error and throws synchronously.
 */
export function validateGenderRequirement(
  category: CategoryConfig,
  primary: PlayerRef,
  partner?: PlayerRef,
): ValidationResult {
  if (category.playerCount === 1) {
    if (partner !== undefined) {
      return reject('Đơn không có partner.');
    }
    switch (category.genderRequirement) {
      case 'men_only':
        return primary.gender === 'male'
          ? ok
          : reject('Nội dung chỉ dành cho nam.');
      case 'women_only':
        return primary.gender === 'female'
          ? ok
          : reject('Nội dung chỉ dành cho nữ.');
      case 'unrestricted':
        return ok;
      case 'mixed_pair':
        // mixed_pair on singles is an invalid category configuration — categories.service
        // blocks creation of such configs. Throw so the caller (service) surfaces INVALID_CATEGORY_CONFIG.
        throw new Error('INVALID_CATEGORY_CONFIG');
    }
  }

  // playerCount === 2
  if (!partner) {
    return reject('Đôi cần partner.');
  }
  if (primary.userId === partner.userId) {
    return reject('Không tự ghép đôi.');
  }
  switch (category.genderRequirement) {
    case 'men_only':
      if (primary.gender !== 'male' || partner.gender !== 'male') {
        return reject('Nội dung đôi nam yêu cầu cả hai đều là nam.');
      }
      return ok;
    case 'women_only':
      if (primary.gender !== 'female' || partner.gender !== 'female') {
        return reject('Nội dung đôi nữ yêu cầu cả hai đều là nữ.');
      }
      return ok;
    case 'mixed_pair': {
      const genders = [primary.gender, partner.gender];
      const hasMale = genders.includes('male');
      const hasFemale = genders.includes('female');
      if (!hasMale || !hasFemale) {
        return reject('Đôi nam-nữ yêu cầu một nam và một nữ.');
      }
      return ok;
    }
    case 'unrestricted':
      return ok;
  }
}
