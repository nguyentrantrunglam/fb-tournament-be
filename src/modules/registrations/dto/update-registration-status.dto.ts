import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Statuses an organizer may set via the free-edit PATCH endpoint.
 * Intentionally a literal list — NOT the schema's RegistrationStatus enum,
 * which also includes 'withdrawn'. Allowing 'withdrawn' here would bypass the
 * ownership check and withdrawnAt bookkeeping that the dedicated withdraw flow enforces.
 */
export const EDITABLE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type EditableStatus = (typeof EDITABLE_STATUSES)[number];

export class UpdateRegistrationStatusDto {
  @IsIn(EDITABLE_STATUSES)
  status!: EditableStatus;

  /** Optional reason, stored when transitioning to 'rejected'. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
