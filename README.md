> **Note:** this is a fresh repository with clean history, created 2026-11-04. The previous history
> contained hidden malicious code and is archived privately as `testflow-backend-DANGER`. Do not use that one.

# TestFlow Backend

The REST API for TestFlow, a computer-based testing platform. It provides authentication, student and administrator workflows, examination delivery, results, question banks, image uploads, email, and related platform services.

## Stack

- Node.js and Express
- MongoDB and Mongoose
- JWT authentication and secure cookies
- Resend for transactional email
- S2

## Run locally

Requirements: Node.js 20 or later, npm, and a MongoDB instance.

```bash
git clone https://github.com/Testflow-ng/testflow-backend.git
cd testflow-backend
npm install
cp .env.example .env
npm run dev
```

The API listens on `http://localhost:5000` by default.

## Configuration

Update `.env` before starting the service. At minimum, configure:

```env
PORT=5000
CLIENT_URL=http://localhost:5173
MONGODB_URI=mongodb://127.0.0.1:27017/testflow
JWT_ACCESS_SECRET=replace-with-a-unique-secret-of-at-least-32-characters
JWT_REFRESH_SECRET=replace-with-a-different-secret-of-at-least-32-characters
```

SMTP variables are optional in development; verification and reset emails are logged if SMTP is not configured.

## Useful commands

```bash
npm run dev          # Start with automatic reload
npm start            # Start normally
npm run lint         # Run ESLint
npm run format       # Format source files
npm run seed         # Seed the database
npm run create-admin # Create an administrator account
```

## Related repositories

- [Frontend](https://github.com/Testflow-ng/testflow-frontend)
- [Mobile app](https://github.com/Testflow-ng/testflow-mobile)

## Local testing (MongoDB integration)

Backend integration tests use Node's built-in test runner (`node --test`) and **real MongoDB**. Integration suites (`tests/*.integration.test.js`) require `MONGODB_URI_TEST` pointing at a **disposable** database and they **drop that database** at the end of each suite. Never point `MONGODB_URI_TEST` at development or production data.

### 1. Provision a persistent local test MongoDB (Docker)

This repo includes `docker-compose.test.yml`, which starts MongoDB 7 on `127.0.0.1:27018` with a named Docker volume (`testflow_mongo_test_data`). The container uses `restart: unless-stopped`, so it comes back after reboot while Docker is running.

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm run test:db:status
```

Container: `testflow-mongo-test`  
URI: `mongodb://127.0.0.1:27018/testflow_test?directConnection=true`  
Volume: `testflow_mongo_test_data`

The setup is intentionally local-only (`127.0.0.1` bind). Do not expose this test database publicly.

> Transactions/replica sets: the current backend test/application code does not use MongoDB multi-document transactions, so a standalone MongoDB instance is sufficient for the existing suite.

### 2. Local test environment file

`npm test` scripts auto-load `.env.test` via `node --env-file=.env.test`. `.env.test` contains **local-only placeholder/test values** (test JWT secrets, disabled external services, local Mongo URIs). It is gitignored by `.env.*` rules; do not commit it and do not copy production credentials into it.

Key variables:
- `MONGODB_URI_TEST` — dedicated disposable integration DB (required for `*.integration.test.js`).
- `MONGODB_URI` — kept separate from `MONGODB_URI_TEST` in `.env.test`.
- `NODE_ENV=test`, `ADS_JOBS_ENABLED=false`, `RESEND_API_KEY`/SMTP unset, safe payment placeholders.

### 3. Test commands

```bash
npm run test:db:up          # Start/wait for test MongoDB
npm run test:db:status      # Ping test DB and show stats
npm run test:db:reset       # Drop ONLY the dedicated local test DB (safety guards)
npm run test:unit           # Unit tests (no DB required)
npm run test:integration    # Real MongoDB integration tests
npm test                    # Unit + integration (serial)
npm run test:db:down        # Stop test MongoDB container
```

`test:db:reset` refuses non-local hosts, refuses DB names that do not look like dedicated test databases, and refuses if `MONGODB_URI_TEST === MONGODB_URI`.

### 4. Integration coverage areas

Integration suites exercise real MongoDB flows including: identity/auth, organizations/everybody, memberships/students, subscriptions/entitlements, payments/webhook dispatch, domains/org console flows, exam attempts/org exam flow/live CBT, library, ads/advertising, study/leaderboard/feedback (see `tests/*.integration.test.js`).
