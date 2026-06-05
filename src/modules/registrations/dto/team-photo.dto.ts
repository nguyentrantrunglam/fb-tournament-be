import { IsString, IsUrl } from 'class-validator';

export class TeamPhotoDto {
  /** Public URL returned by the Spaces presign flow. Validated at service layer
   * to confirm it contains the correct tournament/teams path prefix.
   * require_tld:false so local MinIO hosts (http://localhost:9000/...) pass — the
   * real guard is the prefix check in setTeamPhoto, not the URL shape. */
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;
}
