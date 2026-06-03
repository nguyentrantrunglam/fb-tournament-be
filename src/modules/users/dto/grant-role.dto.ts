import { IsEnum } from 'class-validator';
import type { GlobalRole } from '../../../schemas/user.schema';

export class GrantRoleDto {
  @IsEnum(['athlete', 'organizer_capable', 'admin'])
  role!: GlobalRole;
}
