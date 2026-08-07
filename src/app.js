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
import { notFound, errorHandler } from './middleware/error.js';

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
      const allowed = config.CLIENT_URL.replace(/\/$/, ''); // Remove trailing slash for comparison
      if (!origin || origin === allowed) {
        callback(null, true);
      } else {
        callback(new Error('CORS blocked: Origin mismatch'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  }),
);

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '5mb' }));
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

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
