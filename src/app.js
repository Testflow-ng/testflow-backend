import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import routes from './routes/index.js';
import shareRoutes from './routes/share.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { notFound, errorHandler } from './middleware/error.js';
import { csrfProtect } from './middleware/csrf.js';
import { isAllowedOrigin } from './utils/origins.js';

/**
 * Build the Express application. Pure and side-effect free (no DB connection,
 * no listen) so it can be imported directly by tests.
 */
const app = express();

// Trust the first proxy so client IPs (and rate limiting) are accurate behind a load balancer.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// CORS MUST come before Helmet and other middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // An unknown origin simply gets no CORS headers (the browser blocks the read). Unsafe
      // requests from it are then refused with 403 CSRF_ORIGIN by csrfProtect, instead of a 500.
      callback(null, !origin || isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token', 'Idempotency-Key', 'X-Tenant-Host'],
  }),
);

app.use(helmet());
app.use(compression());
app.use(
  express.json({
    limit: '5mb',
    // The payment webhook signature is computed over the exact raw bytes.
    verify: (req, _res, buf) => {
      const url = req.originalUrl;
      if (
        url.startsWith('/api/ads/payments/webhook') ||
        url.startsWith('/api/billing/ad-free/webhook') ||
        url.startsWith('/api/v1/public/payments/webhook') ||
        url.startsWith('/api/v1/everybody/subscriptions/webhook') ||
        url.startsWith('/api/webhooks/paystack')
      ) {
        req.rawBody = buf;
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/* -------------------------------------------------------------------- public sharing
 * The static share page (HTML 404 crawlers are rewritten to it, with OG and the app shell
 * inside) and the JSON that shell reads. Outside `/api`, so it never collides with a real
 * resource and never inherits the CSRF handshake that guards `/api`.
 * -------------------------------------------------------------------------- */
app.use('/r', shareRoutes);

/* -------------------------------------------------------------------- notifications
 * The notification bell is read on every page load for every signed-in account, so it is
 * mounted outside `/api` and therefore outside the `/api`-wide CSRF handshake that would
 * block a plain cross-origin GET before the session is read. The one mutating route (mark
 * read) carries csrfProtect itself, and the session cookie remains the real credential.
 * -------------------------------------------------------------------------- */
app.use('/notifications', csrfProtect, notificationRoutes);

app.use('/api', csrfProtect, routes);

app.use(notFound);
app.use(errorHandler);

export default app;
