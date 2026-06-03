import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { sanitizeUser } from '../../schemas/user.schema';
import type { SessionUser } from '../../schemas/user.schema';
import { InjectModel } from '@nestjs/mongoose';
import { User, type UserDocument } from '../../schemas/user.schema';
import { Model } from 'mongoose';

/** Promisify req.login so we can await it cleanly in async handlers. */
function promisifyLogin(req: Request, user: SessionUser): Promise<void> {
  return new Promise((resolve, reject) => {
    req.login(user, (err: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Promisify req.logout (passport v0.6+ requires callback). */
function promisifyLogout(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.logout((err: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Auth routes are brute-force sensitive — tighten to 5 req/min (global is 100/min). */
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Register + auto-login in one step.
   * @Public bypasses the global AuthenticatedGuard.
   * On success, sets connect.sid session cookie and returns the sanitized user (no PII).
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { safeUser, sessionUser } = await this.authService.register(dto);
    await promisifyLogin(req, sessionUser);
    return safeUser;
  }

  /**
   * Login via email + password.
   * LocalAuthGuard runs passport-local which validates credentials via AuthService.validateUser
   * and sets req.user. We then explicitly call req.login() to serialize the user into the
   * session — this is required because passport's internal req.login() inside authenticate()
   * does not reliably trigger session.save() across all passport versions.
   */
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@CurrentUser() sessionUser: SessionUser, @Req() req: Request) {
    // Explicitly establish the session (req.user is already set by LocalAuthGuard,
    // but calling req.login() ensures serializeUser + session.save() complete).
    await promisifyLogin(req, sessionUser);
    const user = await this.userModel.findById(sessionUser.id).lean().exec();
    if (!user) return sessionUser; // Defensive: user deleted between validate and here.
    return sanitizeUser(user, { includeIdentity: false });
  }

  /**
   * Destroy the server-side session and clear the client cookie.
   * Authenticated route — global AuthenticatedGuard already checked.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await promisifyLogout(req);
    // Destroy session store entry so the cookie cannot be replayed.
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie('connect.sid');
    return { ok: true };
  }

  /**
   * Return the current authenticated user (no PII — use GET /admin/users/:id for identity).
   * 401 is returned automatically by AuthenticatedGuard when no valid session exists.
   */
  @Get('me')
  async me(@CurrentUser() sessionUser: SessionUser) {
    const user = await this.userModel.findById(sessionUser.id).lean().exec();
    if (!user) return sessionUser; // Defensive: session references deleted user.
    return sanitizeUser(user, { includeIdentity: false });
  }

  /** Initiates the password reset flow — always returns 200 (never reveal email existence). */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true };
  }

  /** Validates the raw token and sets a new bcrypt-hashed password. */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }
}
