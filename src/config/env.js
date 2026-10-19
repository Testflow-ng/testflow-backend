import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.preprocess((val) => (val === '' ? undefined : val), z.coerce.number().int().positive().default(5000)),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/testflow'),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  COOKIE_DOMAIN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess((val) => (val === '' ? undefined : val), z.coerce.number().int().positive().optional()),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
  // --- Centralized identity ---
  // Extra browser origins allowed to call the API (comma-separated), e.g. https://ads.testflow.com.ng
  ALLOWED_ORIGINS: z.string().optional(),
  // CSRF double-submit token: off | log (warn only) | enforce. Origin checking is always on.
  CSRF_TOKEN_MODE: z.enum(['off', 'log', 'enforce']).default('log'),
  // Other-domain clients for the code+PKCE exchange: JSON [{"id":"x","redirectUris":["https://..."]}]
  AUTH_CLIENTS: z.string().optional(),
  // --- Ads Manager (testflow.com.ng/ads) ---
  ADS_CLIENT_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  ADS_JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  ADS_EVENT_SECRET: z.string().min(32).optional(),
  PAYMENT_PROVIDER: z.enum(['paystack', 'none']).default('paystack'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  ADS_PAYMENT_CALLBACK_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

  // --- Advertising (provider selection + Google AdSense) ---
  // The internal Testflow Ads marketplace has its own switches; this only controls whether the
  // advertising eligibility service offers it as an option. Kept separate so a Google problem
  // can never take Testflow Ads down, and vice versa.
  ADVERTISING_TESTFLOW_ENABLED: z.enum(['true', 'false']).default('true'),
  GOOGLE_ADSENSE_ENABLED: z.enum(['true', 'false']).default('false'),
  // Public identifier (it ships in the page anyway). Not a secret, not a credential.
  GOOGLE_ADSENSE_PUBLISHER_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^ca-pub-\d{10,20}$/, 'Expected a publisher id like ca-pub-1234567890123456').optional(),
  ),
  // "placement:slotId" pairs, comma separated. e.g. content_feed:1234567890,desktop_sidebar:2345678901
  GOOGLE_ADSENSE_AD_UNITS: z.string().optional(),
  // Regional/marketing requirement for personalized advertising. Off by default: without a real
  // consent-management signal the backend only ever enforces a refusal, never infers one.
  GOOGLE_ADSENSE_REQUIRE_CONSENT: z.enum(['true', 'false']).default('false'),
  // AdSense Management API reporting. Off until OAuth credentials exist (see docs/advertising.md).
  GOOGLE_ADSENSE_REPORTING_ENABLED: z.enum(['true', 'false']).default('false'),
  // Approved placements. Empty allow list = the registry defaults. A sensitive placement can never
  // be enabled, whatever this says.
  ADVERTISING_PLACEMENTS_ENABLED: z.string().optional(),
  ADVERTISING_PLACEMENTS_DISABLED: z.string().optional(),
  AD_FREE_CALLBACK_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

  // Cloudflare R2 object storage (S3-compatible). Optional at boot; required to upload files.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
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
