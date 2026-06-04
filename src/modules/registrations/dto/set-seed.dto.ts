import { IsInt, IsOptional, Min } from 'class-validator';

export class SetSeedDto {
  /**
   * Seed value (integer ≥ 1) or null to clear.
   * Uniqueness across registrations is NOT enforced here — only validated
   * at bracket generation time to allow flexible pre-draw seed assignment.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  seed?: number | null;
}
