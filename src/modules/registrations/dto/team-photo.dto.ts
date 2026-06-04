import { IsString, IsUrl } from 'class-validator';

export class TeamPhotoDto {
  /** Public URL returned by the Spaces presign flow. Validated at service layer
   * to confirm it contains the correct tournament/teams path prefix. */
  @IsString()
  @IsUrl()
  url!: string;
}
