import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import {
  User,
  type UserDocument,
  type SessionUser,
  sanitizeUser,
  type SafeUser,
} from '../../schemas/user.schema';
import type { AppConfig } from '../../config/configuration';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Create a new user account with a bcrypt-hashed password.
   * nationalId + email uniqueness is enforced by MongoDB unique indexes (E11000).
   * The DomainExceptionFilter maps E11000 → NATIONAL_ID_ALREADY_REGISTERED / EMAIL_ALREADY_USED.
   * Returns a sanitized user (no passwordHash, no identity) for the HTTP response.
   */
  async register(
    dto: RegisterDto,
  ): Promise<{ safeUser: SafeUser; sessionUser: SessionUser }> {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const created = await this.userModel.create({
      email: dto.email.toLowerCase().trim(),
      passwordHash,
      displayName: dto.displayName.trim(),
      gender: dto.gender,
      dob: new Date(dto.dob),
      avatarUrl: dto.avatarUrl,
      globalRole: 'athlete',
      identity: {
        nationalId: dto.nationalId,
        phone: dto.phone,
      },
    });

    const safeUser = sanitizeUser(created, { includeIdentity: false });
    const sessionUser: SessionUser = {
      id: created._id.toHexString(),
      globalRole: created.globalRole,
    };

    return { safeUser, sessionUser };
  }

  /**
   * Validate email + password for passport-local.
   * Selects passwordHash explicitly (field has select:false) and compares via bcrypt.
   * Returns a minimal SessionUser on success, null on failure.
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<SessionUser | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash')
      .lean()
      .exec();

    if (!user) return null;

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return null;

    return { id: user._id.toHexString(), globalRole: user.globalRole };
  }

  /**
   * Sends a password-reset email if the account exists.
   * Always returns OK to the caller — never reveal whether the email is registered.
   * Token: 32 random bytes (hex) → sha256 hash stored in DB, raw token emailed.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .exec();
    if (!user) {
      // Silent — don't leak account existence.
      this.logger.log(
        `Password reset requested for unknown email (suppressed)`,
      );
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.userModel.updateOne(
      { _id: user._id },
      { $set: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt } },
    );

    const smtpHost = this.config.get('smtp', { infer: true }).host;
    const resetLink = `${this.config.get('webOrigin', { infer: true })}/reset-password?token=${rawToken}`;

    if (!smtpHost) {
      // Dev mode: log the reset link so developers can test without SMTP.
      this.logger.log(
        `[DEV] Password reset link for ${user.email}: ${resetLink}`,
      );
      return;
    }

    await this.sendResetEmail(user.email, resetLink);
  }

  /**
   * Verify the raw token, set a new bcrypt password, and invalidate the token.
   * Token is single-use: cleared immediately after use.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const user = await this.userModel
      .findOne({
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { $gt: new Date() },
      })
      .select('+resetTokenHash +resetTokenExpiresAt')
      .exec();

    if (!user) {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash },
        $unset: { resetTokenHash: 1, resetTokenExpiresAt: 1 },
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendResetEmail(to: string, resetLink: string): Promise<void> {
    const smtp = this.config.get('smtp', { infer: true });

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    await transporter.sendMail({
      from: smtp.from,
      to,
      subject: 'Đặt lại mật khẩu',
      text: `Nhấn vào link sau để đặt lại mật khẩu (hết hạn sau 1 giờ):\n\n${resetLink}`,
      html: `<p>Nhấn vào link sau để đặt lại mật khẩu (hết hạn sau 1 giờ):</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });
  }
}
