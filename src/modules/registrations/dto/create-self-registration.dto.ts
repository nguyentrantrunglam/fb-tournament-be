import { IsOptional, IsString, IsMongoId } from 'class-validator';

/** Payload for a self-registration. primaryUserId is resolved from the session. */
export class CreateSelfRegistrationDto {
  /** Partner's userId — required for doubles categories, must be absent for singles. */
  @IsOptional()
  @IsString()
  @IsMongoId()
  partnerUserId?: string;
}
