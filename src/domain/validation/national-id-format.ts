/**
 * Pure validation — no framework imports (portable domain layer).
 * Vietnamese CCCD (post-2021) = exactly 12 digits. Renamed from the old cccd-format.
 */
export const NATIONAL_ID_REGEX = /^\d{12}$/;

export function isValidNationalId(value: string): boolean {
  return NATIONAL_ID_REGEX.test(value);
}
