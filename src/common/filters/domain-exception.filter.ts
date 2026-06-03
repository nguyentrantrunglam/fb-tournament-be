import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../domain-error';

/**
 * Maps thrown errors to a consistent JSON shape `{ statusCode, code, message }`.
 * - DomainError    → its own status + code (business errors)
 * - Mongo E11000   → 409 with a code derived from the duplicated index
 * - HttpException  → passthrough
 * - anything else  → 500 (logged)
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('DomainExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      res.status(exception.status).json({
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    if (this.isCastError(exception)) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_ID',
        message: 'Mã không hợp lệ.',
      });
      return;
    }

    if (this.isDuplicateKey(exception)) {
      const code = this.duplicateCode(exception);
      res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        code,
        message: 'Giá trị đã tồn tại.',
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Đã có lỗi xảy ra.',
    });
  }

  /** Mongoose CastError: malformed :id param (e.g. "not-an-id" where ObjectId expected). */
  private isCastError(e: unknown): boolean {
    if (typeof e !== 'object' || e === null) return false;
    const err = e as Record<string, unknown>;
    return err['name'] === 'CastError' && (err['kind'] !== undefined || err['path'] !== undefined);
  }

  private isDuplicateKey(e: unknown): e is { code: number; keyPattern?: Record<string, unknown> } {
    return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
  }

  private duplicateCode(e: { keyPattern?: Record<string, unknown> }): string {
    const keys = e.keyPattern ? Object.keys(e.keyPattern) : [];
    const key = keys[0];
    if (key === 'email') return 'EMAIL_ALREADY_USED';
    if (key && key.includes('nationalId')) return 'NATIONAL_ID_ALREADY_REGISTERED';
    if (key === 'slug') return 'SLUG_ALREADY_USED';
    // Compound index {tournamentId, code} on categories collection.
    if (keys.includes('code') && keys.includes('tournamentId')) return 'CATEGORY_CODE_DUPLICATE';
    // Compound index {tournamentId, userId, role} on tournamentRoles collection.
    if (keys.includes('role') && keys.includes('userId') && keys.includes('tournamentId'))
      return 'TOURNAMENT_ROLE_ALREADY_GRANTED';
    return 'DUPLICATE_KEY';
  }
}
