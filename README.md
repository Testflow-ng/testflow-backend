# TestFlow Backend

The REST API for TestFlow, a computer-based testing platform. It provides authentication, student and administrator workflows, examination delivery, results, question banks, image uploads, email, and related platform services.

## Stack

- Node.js and Express
- MongoDB and Mongoose
- JWT authentication and secure cookies
- Nodemailer for transactional email
- ImageKit and Multer for image uploads

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
