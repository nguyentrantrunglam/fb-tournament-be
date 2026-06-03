import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Triggers passport-local strategy (email + password validation).
 * Apply only on POST /auth/login — NOT a global guard.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
