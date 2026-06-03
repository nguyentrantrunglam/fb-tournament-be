import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';
import type { SessionUser } from '../../schemas/user.schema';

/**
 * Passport local strategy using email + password.
 * On success, returns a SessionUser that Passport serialises into the session.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    // Override passport-local's default 'username' field to 'email'.
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<SessionUser> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    return user;
  }
}
