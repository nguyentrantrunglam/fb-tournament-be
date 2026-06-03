import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCourtDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
