import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/testflow'),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  COOKIE_DOMAIN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

// JWT secrets: mandatory (and strong) in production. In dev/test, fall back to
// ephemeral secrets with a loud warning so the server runs out of the box.
let { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } = env;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  if (isProduction) {
    console.error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production (min 32 chars each).',
    );
    process.exit(1);
  }
  JWT_ACCESS_SECRET = JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me-0123456789';
  JWT_REFRESH_SECRET = JWT_REFRESH_SECRET ?? 'dev-only-refresh-secret-change-me-9876543210';
  console.warn(
    '[env] Using ephemeral development JWT secrets. Set JWT_ACCESS_SECRET and ' +
      'JWT_REFRESH_SECRET in your .env for stable sessions.',
  );
}

if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) {
  console.error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  process.exit(1);
}

export const config = Object.freeze({
  ...env,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  isProduction,
  isTest: env.NODE_ENV === 'test',
});
