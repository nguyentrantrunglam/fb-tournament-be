import { IsString, MinLength } from 'class-validator';

export class CreateCourtDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
