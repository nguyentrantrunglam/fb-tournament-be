import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  type UserDocument,
  type SessionUser,
} from '../../schemas/user.schema';

/**
 * Serialize: store only the user id in the session cookie (no PII).
 * Deserialize: reload from DB on each request and attach a minimal SessionUser
 * to req.user — just id + globalRole, which is all guards need.
 */
@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  serializeUser(
    user: SessionUser,
    done: (err: unknown, id?: string) => void,
  ): void {
    done(null, user.id);
  }

  async deserializeUser(
    id: string,
    done: (err: unknown, user?: SessionUser | null) => void,
  ): Promise<void> {
    try {
      const user = await this.userModel
        .findById(id)
        .select('globalRole')
        .lean()
        .exec();
      if (!user) {
        done(null, null);
        return;
      }
      // Attach minimal session shape — guards read globalRole, controllers read id.
      const sessionUser: SessionUser = {
        id,
        globalRole: user.globalRole,
      };
      done(null, sessionUser);
    } catch (err) {
      done(err);
    }
  }
}
