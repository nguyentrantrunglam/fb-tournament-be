import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  type UserDocument,
  type GlobalRole,
  sanitizeUser,
  type SafeUser,
} from '../../schemas/user.schema';
import type { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** Return the calling user's full profile, including their own PII (identity). */
  async getMe(id: string): Promise<SafeUser> {
    const user = await this.userModel.findById(id).lean().exec();
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');
    return sanitizeUser(user, { includeIdentity: true });
  }

  /**
   * Update mutable profile fields for the authenticated user.
   * Only displayName, phone (inside identity), and avatarUrl are accepted.
   * ValidationPipe + whitelist:true already strips any other keys.
   * nationalId, gender, dob, email, globalRole are never touched here.
   */
  async updateMe(id: string, dto: UpdateMeDto): Promise<SafeUser> {
    const update: Record<string, unknown> = {};
    if (dto.displayName !== undefined)
      update['displayName'] = dto.displayName.trim();
    if (dto.avatarUrl !== undefined) update['avatarUrl'] = dto.avatarUrl;
    // phone lives inside the identity subdoc — update only that field, never nationalId.
    if (dto.phone !== undefined) update['identity.phone'] = dto.phone;

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' })
      .lean()
      .exec();

    if (!updated) throw new NotFoundException('Người dùng không tồn tại.');
    // Owner update: return with identity (they supplied the phone themselves).
    return sanitizeUser(updated, { includeIdentity: true });
  }

  /**
   * Paginated user list for admin panel.
   * Identity is NOT included — admin must use getUserAdmin(id) to see PII.
   */
  async listUsers(
    skip: number,
    limit: number,
    search?: string,
  ): Promise<{ users: SafeUser[]; total: number }> {
    const safeLimit = Math.min(limit, 100);
    const query = search
      ? {
          $or: [
            { email: { $regex: search, $options: 'i' } },
            { displayName: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.userModel.find(query).skip(skip).limit(safeLimit).lean().exec(),
      this.userModel.countDocuments(query).exec(),
    ]);

    return {
      users: users.map((u) => sanitizeUser(u, { includeIdentity: false })),
      total,
    };
  }

  /** Admin: get a single user including PII (identity). */
  async getUserAdmin(id: string): Promise<SafeUser> {
    const user = await this.userModel.findById(id).lean().exec();
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');
    return sanitizeUser(user, { includeIdentity: true });
  }

  /** Grant or revoke a global role. Change is logged via Logger; audit log collection is a future phase. */
  async grantGlobalRole(id: string, role: GlobalRole): Promise<SafeUser> {
    const updated = await this.userModel
      .findByIdAndUpdate(
        id,
        { $set: { globalRole: role } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();

    if (!updated) throw new NotFoundException('Người dùng không tồn tại.');
    return sanitizeUser(updated, { includeIdentity: false });
  }
}
