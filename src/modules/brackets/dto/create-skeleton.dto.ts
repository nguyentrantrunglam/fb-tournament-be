import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Body for POST /categories/:cid/bracket/skeleton.
 * groupCount and qualifyPerGroup are required when category.format === 'group_ko';
 * for other formats they must be absent. Validation is enforced in the service.
 */
export class CreateSkeletonDto {
  @IsOptional()
  @IsInt()
  @Min(2)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  qualifyPerGroup?: number;
}
