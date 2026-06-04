import { IsString, IsMongoId, IsOptional } from 'class-validator';

/** Payload for organizer-created single registration. Status auto-set to approved. */
export class CreateOrganizerRegistrationDto {
  @IsString()
  @IsMongoId()
  primaryUserId!: string;

  /** Required for doubles categories, must be absent for singles. */
  @IsOptional()
  @IsString()
  @IsMongoId()
  partnerUserId?: string;
}
