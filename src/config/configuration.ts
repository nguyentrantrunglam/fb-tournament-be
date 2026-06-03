/**
 * Typed configuration loaded from environment.
 * Single source of truth for env access — inject ConfigService and read `config.get('...')`.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  session: {
    secret: string;
    sameSite: 'lax' | 'strict' | 'none';
    secure: boolean;
  };
  webOrigin: string;
  spaces: {
    endpoint: string;
    region: string;
    key: string;
    secret: string;
    bucket: string;
    forcePathStyle: boolean; // true for MinIO (path-style); false for DigitalOcean Spaces (virtual-hosted)
    publicBaseUrl: string; // base URL objects are served from (MinIO: http://localhost:9000/{bucket})
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  mongoUri:
    process.env.MONGO_URI ??
    'mongodb://localhost:27017/badminton?replicaSet=rs0&directConnection=true',
  session: {
    secret: process.env.SESSION_SECRET ?? 'change-me-in-prod',
    sameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') ?? 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
  },
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  spaces: {
    endpoint: process.env.SPACES_ENDPOINT ?? '',
    region: process.env.SPACES_REGION ?? '',
    key: process.env.SPACES_KEY ?? '',
    secret: process.env.SPACES_SECRET ?? '',
    bucket: process.env.SPACES_BUCKET ?? '',
    forcePathStyle: process.env.SPACES_FORCE_PATH_STYLE === 'true',
    publicBaseUrl: process.env.SPACES_PUBLIC_BASE_URL ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'no-reply@badminton.local',
  },
});
