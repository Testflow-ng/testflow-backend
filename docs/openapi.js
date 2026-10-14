const api = '/api';
const json = (schema, example) => ({
  required: true,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});
const response = (description, schema) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});
const id = { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } };
const auth = [{ cookieAuth: [] }];
const operation = (summary, options = {}) => ({
  summary,
  ...(options.description ? { description: options.description } : {}),
  ...(options.security === false ? {} : { security: auth }),
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.body ? { requestBody: json(options.body, options.example) } : {}),
  responses: {
    '200': response('Successful response', options.response),
    ...(options.created ? { '201': response('Created successfully', options.response) } : {}),
    ...(options.security === false ? {} : { '401': { $ref: '#/components/responses/Unauthenticated' } }),
    ...(options.admin ? { '403': { $ref: '#/components/responses/Forbidden' } } : {}),
    ...(options.errors ? { '400': { $ref: '#/components/responses/BadRequest' } } : {}),
  },
});

window.testflowOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'TestFlow API',
    version: '1.0.0',
    description: `# TestFlow API Reference\n\nAPI for TestFlow's OAU CBT practice platform.\n\n## Authentication\nSign in with **POST /api/auth/login**. The server sets secure, HTTP-only cookies; Swagger routes requests through this documentation site's Vercel proxy so authenticated requests stay first-party.\n\n## Centralized identity\nOne account per person (unique email) with one **membership** per product (\`student\`, \`ads\`, …). \`me\` returns \`memberships\`, \`activeProduct\` and \`profiles\`; add a product with **POST /api/auth/memberships**; change context with **POST /api/auth/switch-product**. A login that names a product the account does not have returns \`403 NO_MEMBERSHIP\` with \`details.canJoin\`.\n\n## CSRF\nUnsafe requests (POST/PATCH/PUT/DELETE) must come from an allow-listed \`Origin\`. While a session cookie is present, also send the \`X-CSRF-Token\` header with the value of the readable \`tf_csrf\` cookie (also returned as \`csrfToken\`). Bearer-token calls are exempt.\n\n## Other domains\nNo shared cookie? Use **POST /api/auth/oauth/authorize** + **/oauth/token** (authorization code with PKCE S256, allow-listed redirect URIs) to obtain a short-lived \`Authorization: Bearer\` token.\n\n## Roles\n- **Student**: account with a \`student\` membership\n- **Advertiser**: Ads Manager account (create/pay for/track ad campaigns)\n- **Admin**: content, users, settings, verification and ad-moderation operations\n- **Super admin**: administrator roster management`,
  },
  servers: [{ url: '/', description: 'Swagger documentation proxy' }],
  tags: [
    { name: 'Health', description: 'Service availability' },
    { name: 'Public', description: 'Unauthenticated public data and shared questions' },
    { name: 'Authentication', description: 'Account and session management' },
    { name: 'Subjects', description: 'Course catalogue and student subject actions' },
    { name: 'Questions', description: 'Admin question bank management' },
    { name: 'Exam sessions', description: 'Standard CBT sessions' },
    { name: 'Post-UTME', description: 'Post-UTME mock sessions' },
    { name: 'Verifications', description: 'Payment receipt verification' },
    { name: 'Administration', description: 'Admin and super-admin operations' },
    { name: 'Identity', description: 'Centralized account: memberships, product switching, cross-domain code + PKCE exchange' },
    { name: 'Ads: Advertiser account', description: 'Advertiser registration, login and profile (same cookie session as the rest of the API)' },
    { name: 'Ads: Campaigns', description: 'Create, edit and manage campaigns; images; analytics' },
    { name: 'Ads: Checkout & payments', description: 'Server-priced checkout, payment verification and provider webhook' },
    { name: 'Ads: Student serving', description: 'Ad slot shown to students after a completed CBT session, and engagement events' },
    { name: 'Ads: Administration', description: 'Moderation, pricing/settings, payments, refunds and job logs' },
  ],
  paths: {
    '/health': {
      get: operation('Check service health', { security: false, response: { $ref: '#/components/schemas/Health' } }),
    },
    [`${api}/public/stats`]: {
      get: operation('Get public platform statistics', { security: false, response: { $ref: '#/components/schemas/PublicStats' } }),
    },
    [`${api}/public/config`]: {
      get: operation('Get public platform configuration', { security: false, response: { $ref: '#/components/schemas/PublicConfig' } }),
    },
    [`${api}/public/questions/{id}`]: {
      get: operation('Get a shareable public question', { security: false, parameters: [id], response: { $ref: '#/components/schemas/PublicQuestionResponse' } }),
    },
    [`${api}/public/questions/{id}/respond`]: {
      post: operation('Submit a response to a shared question', { security: false, parameters: [id], body: { type: 'object', required: ['selectedOption'], properties: { selectedOption: { type: 'integer', minimum: 0 } } }, example: { selectedOption: 1 }, response: { $ref: '#/components/schemas/PublicResponseResult' }, errors: true }),
    },
    [`${api}/public/questions/{id}/share`]: {
      get: operation('Get share metadata page for a public question', { security: false, parameters: [id], response: { type: 'string', description: 'HTML social share page' } }),
    },
    [`${api}/auth/register`]: {
      post: operation('Create an account for a product (default: student)', { security: false, body: { $ref: '#/components/schemas/RegisterInput' }, example: { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'Study2026', confirmPassword: 'Study2026' }, created: true, response: { $ref: '#/components/schemas/AuthResponse' }, errors: true }),
    },
    [`${api}/auth/login`]: {
      post: operation('Sign in and set authentication cookies', { security: false, description: 'Optional `product`: if the account has no membership for it, responds 403 NO_MEMBERSHIP (details: {product, canJoin}) and sets no session. Unknown email and wrong password are indistinguishable (same body, same bcrypt work). 10 attempts / 15 min per IP+email.', body: { $ref: '#/components/schemas/LoginInput' }, example: { email: 'ada@example.com', password: 'Study2026' }, response: { $ref: '#/components/schemas/AccountPayload' }, errors: true }),
    },
    [`${api}/auth/memberships`]: {
      post: operation('Add a product to an existing account', { security: false, description: 'Uses the current session when present; otherwise send `email` + `password` to prove ownership. `profile.businessName` is required for `ads`. Atomic: concurrent duplicates yield one 201 and the rest 409 ALREADY_MEMBER. Signs the account in with the new product as the active context.', body: { $ref: '#/components/schemas/MembershipInput' }, response: { $ref: '#/components/schemas/AccountPayload' }, created: true, errors: true }),
    },
    [`${api}/auth/switch-product`]: {
      post: operation('Switch the active product context without signing out', { description: 'Requires a membership for the product (else 403 NO_MEMBERSHIP). Re-issues the session cookies with the new context.', body: { type: 'object', required: ['product'], properties: { product: { $ref: '#/components/schemas/Product' } } }, response: { $ref: '#/components/schemas/AccountPayload' } }),
    },
    [`${api}/auth/oauth/authorize`]: {
      post: operation('Issue a one-time authorization code (code + PKCE) for an allow-listed client', { description: 'Requires a signed-in session. The code is valid 2 minutes and single-use. `redirectUri` must match an allow-listed URI for the client exactly.', body: { $ref: '#/components/schemas/OAuthAuthorizeInput' }, response: { type: 'object', properties: { redirectTo: { type: 'string', format: 'uri', description: 'redirectUri with ?code=…&state=…' } } }, errors: true }),
    },
    [`${api}/auth/oauth/token`]: {
      post: operation('Exchange code + PKCE verifier for a short-lived bearer token', { security: false, description: 'The code is burned on first use even if verification fails. Use the token as `Authorization: Bearer <accessToken>`; it is revoked by logout / password reset. 400 INVALID_GRANT | INVALID_CLIENT | INVALID_REDIRECT_URI.', body: { $ref: '#/components/schemas/OAuthTokenInput' }, response: { $ref: '#/components/schemas/OAuthTokenResponse' }, errors: true }),
    },
    [`${api}/auth/logout`]: { post: operation('Sign out and clear session cookies', { response: { $ref: '#/components/schemas/Message' } }) },
    [`${api}/auth/refresh`]: { post: operation('Refresh an expired access session', { security: false, description: 'Keeps the active product. Rate limited.', response: { $ref: '#/components/schemas/AccountPayload' } }) },
    [`${api}/auth/me`]: { get: operation('Get current account, memberships and profile summaries', { description: 'Also returns `csrfToken` for the X-CSRF-Token header.', response: { $ref: '#/components/schemas/AccountPayload' } }) },
    [`${api}/auth/username`]: { patch: operation('Set account username', { body: { type: 'object', required: ['username'], properties: { username: { type: 'string', pattern: '^[a-z0-9_]+$', minLength: 3, maxLength: 20 } } }, example: { username: 'ada_lovelace' }, response: { $ref: '#/components/schemas/UserResponse' }, errors: true }) },
    [`${api}/auth/verify-email`]: { post: operation('Verify an email token', { security: false, body: { $ref: '#/components/schemas/TokenInput' }, response: { $ref: '#/components/schemas/Message' }, errors: true }) },
    [`${api}/auth/resend-verification`]: { post: operation('Resend email verification', { security: false, body: { $ref: '#/components/schemas/EmailInput' }, response: { $ref: '#/components/schemas/Message' }, errors: true }) },
    [`${api}/auth/forgot-password`]: { post: operation('Request a password reset email', { security: false, body: { $ref: '#/components/schemas/EmailInput' }, response: { $ref: '#/components/schemas/Message' }, errors: true }) },
    [`${api}/auth/reset-password`]: { post: operation('Reset a password with a token', { security: false, body: { $ref: '#/components/schemas/ResetPasswordInput' }, response: { $ref: '#/components/schemas/Message' }, errors: true }) },
    [`${api}/auth/profile`]: { patch: operation('Update current profile', { body: { type: 'object', additionalProperties: true, description: 'Profile fields accepted by the current account service.' }, response: { $ref: '#/components/schemas/UserResponse' } }) },
    [`${api}/auth/migrate`]: { patch: operation('Migrate account to university mode', { body: { $ref: '#/components/schemas/MigrationInput' }, response: { $ref: '#/components/schemas/UserResponse' } }) },
    [`${api}/auth/utme-data`]: { patch: operation('Update UTME and O-Level data', { body: { $ref: '#/components/schemas/UtmeDataInput' }, response: { $ref: '#/components/schemas/UserResponse' } }) },
    [`${api}/auth/change-password`]: { post: operation('Change current password', { body: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password', minLength: 8 } } }, response: { $ref: '#/components/schemas/Message' }, errors: true }) },
    [`${api}/subjects`]: {
      get: operation('List available subjects', { parameters: [{ name: 'all', in: 'query', schema: { type: 'boolean' } }, { name: 'level', in: 'query', schema: { $ref: '#/components/schemas/Level' } }, { name: 'department', in: 'query', schema: { type: 'string' } }], response: { $ref: '#/components/schemas/SubjectsResponse' } }),
      post: operation('Create a subject', { admin: true, body: { $ref: '#/components/schemas/SubjectInput' }, response: { $ref: '#/components/schemas/SubjectResponse' }, created: true, errors: true }),
    },
    [`${api}/subjects/{code}`]: { get: operation('Get subject by code', { parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string', maxLength: 20 } }], response: { $ref: '#/components/schemas/SubjectResponse' } }) },
    [`${api}/subjects/{id}/topics`]: { get: operation('List subject topics', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/subjects/{id}/leaderboard`]: { get: operation('Get subject leaderboard', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/subjects/{id}/pin`]: { post: operation('Pin or unpin a subject', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/subjects/{id}`]: {
      patch: operation('Update a subject', { admin: true, parameters: [id], body: { $ref: '#/components/schemas/SubjectInput' }, response: { $ref: '#/components/schemas/SubjectResponse' }, errors: true }),
      delete: operation('Delete a subject', { admin: true, parameters: [id], response: { $ref: '#/components/schemas/Message' } }),
    },
    [`${api}/questions`]: {
      get: operation('List questions', { admin: true, parameters: [{ name: 'subject', in: 'query', schema: { type: 'string' } }, { name: 'difficulty', in: 'query', schema: { $ref: '#/components/schemas/Difficulty' } }, { name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }], response: { type: 'object' } }),
      post: operation('Create a question', { admin: true, body: { $ref: '#/components/schemas/QuestionInput' }, response: { type: 'object' }, created: true, errors: true }),
    },
    [`${api}/questions/bulk`]: { post: operation('Bulk create questions', { admin: true, body: { type: 'array', minItems: 1, maxItems: 500, items: { $ref: '#/components/schemas/QuestionInput' } }, response: { type: 'object' }, created: true, errors: true }) },
    [`${api}/questions/{id}`]: {
      get: operation('Get question by ID', { admin: true, parameters: [id], response: { type: 'object' } }),
      patch: operation('Update a question', { admin: true, parameters: [id], body: { $ref: '#/components/schemas/QuestionUpdateInput' }, response: { type: 'object' }, errors: true }),
      delete: operation('Delete a question', { admin: true, parameters: [id], response: { $ref: '#/components/schemas/Message' } }),
    },
    [`${api}/exam-sessions`]: {
      get: operation('List current user exam sessions', { response: { type: 'object' } }),
      post: operation('Start an exam session', { description: 'Requires an authenticated account. Email verification is currently not enforced by the server.', body: { $ref: '#/components/schemas/StartSessionInput' }, response: { type: 'object' }, created: true, errors: true }),
    },
    [`${api}/exam-sessions/stats`]: { get: operation('Get current user exam statistics', { response: { type: 'object' } }) },
    [`${api}/exam-sessions/{id}`]: { get: operation('Get an exam session', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/exam-sessions/{id}/answer`]: { patch: operation('Save an exam answer', { parameters: [id], body: { $ref: '#/components/schemas/AnswerInput' }, response: { type: 'object' }, errors: true }) },
    [`${api}/exam-sessions/{id}/strike`]: { post: operation('Record an exam integrity strike', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/exam-sessions/{id}/submit`]: { post: operation('Submit an exam session', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/exam-sessions/{id}/result`]: { get: operation('Get a submitted exam result', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/post-utme/start`]: { post: operation('Start a Post-UTME session', { body: { type: 'object', properties: { subjects: { type: 'array', items: { type: 'string' } } } }, response: { type: 'object' }, created: true }) },
    [`${api}/post-utme/{id}/answer`]: { patch: operation('Save a Post-UTME answer', { parameters: [id], body: { $ref: '#/components/schemas/AnswerInput' }, response: { type: 'object' } }) },
    [`${api}/post-utme/{id}/submit`]: { post: operation('Submit a Post-UTME session', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/post-utme/{id}/strike`]: { post: operation('Record a Post-UTME integrity strike', { parameters: [id], response: { type: 'object' } }) },
    [`${api}/post-utme/stats`]: { get: operation('Get Post-UTME statistics', { response: { type: 'object' } }) },
    [`${api}/verifications/auth`]: { get: operation('Get a presigned Cloudflare R2 upload URL for a payment receipt', { description: 'Returns { uploadUrl, publicUrl, key, expiresInSec }. PUT the file to uploadUrl, then submit publicUrl. (Post-UTME verification is currently paused.)', response: { type: 'object' } }) },
    [`${api}/verifications/submit`]: { post: operation('Submit payment verification request', { body: { $ref: '#/components/schemas/VerificationInput' }, response: { type: 'object' }, created: true, errors: true }) },
    [`${api}/verifications/my-status`]: { get: operation('Get current user verification status', { response: { type: 'object' } }) },
    [`${api}/verifications/queue`]: { get: operation('List verification queue', { admin: true, parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'] } }], response: { type: 'object' } }) },
    [`${api}/verifications/{id}/process`]: { patch: operation('Approve or reject verification', { admin: true, parameters: [id], body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['approved', 'rejected'] }, rejectionReason: { type: 'string' } } }, response: { type: 'object' }, errors: true }) },
    [`${api}/admin/stats`]: { get: operation('Get admin dashboard statistics', { admin: true, response: { type: 'object' } }) },
    [`${api}/admin/activity`]: { get: operation('Get admin activity feed', { admin: true, response: { type: 'object' } }) },
    [`${api}/admin/settings`]: {
      get: operation('Get platform settings', { admin: true, response: { type: 'object' } }),
      patch: operation('Update platform settings', { admin: true, body: { type: 'object', additionalProperties: true }, response: { type: 'object' } }),
    },
    [`${api}/admin/students`]: {
      get: operation('List students', { admin: true, response: { type: 'object' } }),
      post: operation('Create a student account', { admin: true, body: { $ref: '#/components/schemas/RegisterInput' }, response: { type: 'object' }, created: true }),
    },
    [`${api}/admin/students/{id}/reset-password`]: { patch: operation('Reset a student password', { admin: true, parameters: [id], body: { type: 'object', required: ['password'], properties: { password: { type: 'string', format: 'password' } } }, response: { type: 'object' } }) },
    [`${api}/admin/students/{id}/toggle-status`]: { patch: operation('Toggle a student account status', { admin: true, parameters: [id], response: { type: 'object' } }) },
    [`${api}/admin/verify-utme`]: { post: operation('Verify a student Post-UTME code', { admin: true, body: { type: 'object', required: ['verificationCode'], properties: { verificationCode: { type: 'string' } } }, response: { type: 'object' } }) },
    [`${api}/admin/post-utme/rankings`]: { get: operation('Get Post-UTME rankings', { admin: true, response: { type: 'object' } }) },
    [`${api}/admin/questions/{id}/analytics`]: { get: operation('Get question analytics', { admin: true, parameters: [id], response: { type: 'object' } }) },
    [`${api}/admin/export-results`]: { get: operation('Export results as CSV', { admin: true, response: { type: 'string', format: 'binary' } }) },
    [`${api}/admin/questions/bulk-delete`]: { post: operation('Bulk delete questions', { admin: true, body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } } } }, response: { type: 'object' } }) },
    [`${api}/admin/questions/bulk-toggle`]: { post: operation('Bulk toggle question status', { admin: true, body: { type: 'object', required: ['ids', 'isActive'], properties: { ids: { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } }, isActive: { type: 'boolean' } } }, response: { type: 'object' } }) },
    [`${api}/admin/roster`]: { get: operation('List administrators', { admin: true, description: 'Super-admin only.', response: { type: 'object' } }) },
    [`${api}/admin/create`]: { post: operation('Create administrator', { admin: true, description: 'Super-admin only.', body: { $ref: '#/components/schemas/RegisterInput' }, response: { type: 'object' }, created: true }) },
    [`${api}/admin/promote`]: { post: operation('Promote user to administrator', { admin: true, description: 'Super-admin only.', body: { $ref: '#/components/schemas/EmailInput' }, response: { type: 'object' } }) },
    [`${api}/admin/demote/{id}`]: { patch: operation('Demote administrator', { admin: true, description: 'Super-admin only.', parameters: [id], response: { type: 'object' } }) },
    [`${api}/admin/users/{id}`]: { delete: operation('Delete user', { admin: true, description: 'Super-admin only.', parameters: [id], response: { $ref: '#/components/schemas/Message' } }) },
  },
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'tf_access', description: 'HTTP-only session cookie set by the login endpoint.' } },
    responses: {
      BadRequest: { description: 'Invalid request input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Unauthenticated: { description: 'Authentication required or session expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Forbidden: { description: 'Insufficient role', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    schemas: {
      ObjectId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$', example: '507f1f77bcf86cd799439011' },
      Level: { type: 'string', enum: ['post-utme', '100', '200', '300', '400', '500'] },
      Difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      Health: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, uptime: { type: 'number' } } },
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string', example: 'NO_MEMBERSHIP' }, message: { type: 'string' }, details: { type: 'object', description: 'e.g. { product, canJoin } for NO_MEMBERSHIP / EMAIL_TAKEN', additionalProperties: true }, fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Per-field messages on 422' } } } } },
      Message: { type: 'object', properties: { message: { type: 'string', example: 'Operation completed.' } } },
      EmailInput: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', maxLength: 254 } } },
      TokenInput: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 256 } } },
      LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', maxLength: 72 }, product: { $ref: '#/components/schemas/Product' } } },
      Product: { type: 'string', enum: ['student', 'ads'], description: 'Product key; new products are added here.' },
      Membership: { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' }, role: { type: 'string', example: 'student' }, joinedAt: { type: 'string', format: 'date-time', nullable: true } } },
      AccountPayload: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' }, memberships: { type: 'array', items: { $ref: '#/components/schemas/Membership' } }, activeProduct: { type: 'string', nullable: true, example: 'student' }, profiles: { type: 'object', description: 'Per-product summaries', properties: { student: { type: 'object', properties: { username: { type: 'string', nullable: true }, level: { type: 'string', nullable: true }, department: { type: 'string', nullable: true }, streakCount: { type: 'integer' }, hasMigrated: { type: 'boolean' } } }, ads: { type: 'object', properties: { businessName: { type: 'string', nullable: true }, contactPhone: { type: 'string', nullable: true } } } } }, csrfToken: { type: 'string', description: 'Send as X-CSRF-Token on unsafe requests' } } },
      MembershipInput: { type: 'object', required: ['product'], properties: { product: { $ref: '#/components/schemas/Product' }, profile: { type: 'object', properties: { businessName: { type: 'string' }, contactPhone: { type: 'string' } } }, email: { type: 'string', format: 'email', description: 'Only when there is no session' }, password: { type: 'string', format: 'password', description: 'Only when there is no session' } } },
      OAuthAuthorizeInput: { type: 'object', required: ['clientId', 'redirectUri', 'codeChallenge', 'codeChallengeMethod'], properties: { clientId: { type: 'string' }, redirectUri: { type: 'string', format: 'uri' }, codeChallenge: { type: 'string', description: 'base64url(SHA-256(codeVerifier)), 43 chars' }, codeChallengeMethod: { type: 'string', enum: ['S256'] }, state: { type: 'string', maxLength: 200 }, product: { $ref: '#/components/schemas/Product' } } },
      OAuthTokenInput: { type: 'object', required: ['grantType', 'code', 'codeVerifier', 'clientId', 'redirectUri'], properties: { grantType: { type: 'string', enum: ['authorization_code'] }, code: { type: 'string' }, codeVerifier: { type: 'string', minLength: 43, maxLength: 128 }, clientId: { type: 'string' }, redirectUri: { type: 'string', format: 'uri' } } },
      OAuthTokenResponse: { allOf: [{ $ref: '#/components/schemas/AccountPayload' }, { type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer', example: 900 } } }] },
      RegisterInput: { type: 'object', required: ['fullName', 'email', 'password', 'confirmPassword'], properties: { product: { $ref: '#/components/schemas/Product' }, profile: { type: 'object', description: 'Required for ads: { businessName, contactPhone? }', properties: { businessName: { type: 'string' }, contactPhone: { type: 'string' } } }, fullName: { type: 'string', minLength: 2, maxLength: 120 }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 }, confirmPassword: { type: 'string', format: 'password' } } },
      ResetPasswordInput: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 } } },
      User: { type: 'object', properties: { id: { $ref: '#/components/schemas/ObjectId' }, fullName: { type: 'string' }, email: { type: 'string', format: 'email' }, username: { type: 'string', nullable: true }, role: { type: 'string', enum: ['student', 'admin', 'super_admin'] } } },
      AuthResponse: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
      UserResponse: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
      SubjectInput: { type: 'object', required: ['title'], properties: { code: { type: 'string', maxLength: 20 }, title: { type: 'string', maxLength: 160 }, description: { type: 'string', maxLength: 500 }, level: { $ref: '#/components/schemas/Level' }, department: { type: 'string', maxLength: 100 }, isActive: { type: 'boolean' } } },
      SubjectResponse: { type: 'object', properties: { subject: { type: 'object' } } },
      SubjectsResponse: { type: 'object', properties: { subjects: { type: 'array', items: { type: 'object' } } } },
      QuestionInput: { type: 'object', required: ['subject', 'stem', 'options', 'correctIndex'], properties: { subject: { type: 'string', maxLength: 50 }, topicId: { type: 'string', maxLength: 20 }, topic: { type: 'string', maxLength: 160 }, subtopic: { type: 'string', maxLength: 160 }, stem: { type: 'string', maxLength: 5000 }, options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 2000 } }, correctIndex: { type: 'integer', minimum: 0 }, explanation: { type: 'string', maxLength: 5000 }, difficulty: { $ref: '#/components/schemas/Difficulty' }, isActive: { type: 'boolean' } } },
      QuestionUpdateInput: { type: 'object', properties: { stem: { type: 'string', maxLength: 2000 }, options: { type: 'array', items: { type: 'string' } }, correctIndex: { type: 'integer', minimum: 0 }, explanation: { type: 'string', maxLength: 2000 }, difficulty: { $ref: '#/components/schemas/Difficulty' }, isActive: { type: 'boolean' } } },
      StartSessionInput: { type: 'object', required: ['subject'], properties: { subject: { type: 'string', maxLength: 24 }, questionCount: { type: 'integer', minimum: 1, maximum: 100 }, durationMinutes: { type: 'integer', minimum: 1, maximum: 180 }, topicId: { type: 'string' }, topic: { type: 'string' } } },
      AnswerInput: { type: 'object', required: ['questionIndex'], properties: { questionIndex: { type: 'integer', minimum: 0 }, selectedOption: { type: 'integer', minimum: 0, nullable: true }, markedForReview: { type: 'boolean' } } },
      MigrationInput: { type: 'object', properties: { department: { type: 'string' }, matricNumber: { type: 'string' }, level: { $ref: '#/components/schemas/Level' } } },
      UtmeDataInput: { type: 'object', properties: { jambScore: { type: 'number', minimum: 0, maximum: 400 }, oLevelPoints: { type: 'number' }, departmentChoice: { type: 'string' } } },
      VerificationInput: { type: 'object', required: ['receiptImage', 'receiptHash'], properties: { receiptImage: { type: 'string', format: 'uri' }, receiptHash: { type: 'string', description: 'Client-computed receipt fingerprint' }, transactionRef: { type: 'string' } } },
      PublicStats: { type: 'object', properties: { totalQuestions: { type: 'integer' }, totalStudents: { type: 'integer' }, totalExams: { type: 'integer' }, totalSubjects: { type: 'integer' } } },
      PublicConfig: { type: 'object', properties: { isPostUtmeActive: { type: 'boolean' }, postUtmePrice: { type: 'number' }, paymentInfo: { type: 'object' } } },
      PublicQuestionResponse: { type: 'object', properties: { question: { type: 'object', description: 'Question content without correct answer or explanation.' } } },
      PublicResponseResult: { type: 'object', properties: { isCorrect: { type: 'boolean' }, correctIndex: { type: 'integer' }, explanation: { type: 'string' } } },
    },
  },
};

// ---------------------------------------------------------------------------
// Ads Manager (advertiser app, student ad slot, admin moderation)
// ---------------------------------------------------------------------------
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const T = { acct: 'Ads: Advertiser account', camp: 'Ads: Campaigns', pay: 'Ads: Checkout & payments', serve: 'Ads: Student serving', admin: 'Ads: Administration' };
const ads = (tag, summary, options = {}) => {
  const op = operation(summary, options);
  op.tags = [tag];
  op.responses['422'] = { $ref: '#/components/responses/ValidationError' };
  op.responses['429'] = { $ref: '#/components/responses/RateLimited' };
  if (options.notFound) op.responses['404'] = { $ref: '#/components/responses/NotFound' };
  if (options.conflict) op.responses['409'] = { description: options.conflict, content: { 'application/json': { schema: ref('Error') } } };
  if (options.role) op.description = `**Role: ${options.role}.** ${options.description ?? ''}`.trim();
  if (options.status) { op.responses[options.status] = op.responses['200']; if (options.status === '201') delete op.responses['200']; }
  if (options.noContent) { op.responses['204'] = { description: 'Deleted' }; delete op.responses['200']; }
  return op;
};
const page = { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } };
const limit = { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } };
const q = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });
const groups = ['active', 'pending_review', 'pending_payment', 'draft', 'rejected', 'suspended', 'expired', 'archived'];

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/ads/pricing`]: { get: ads(T.pay, 'Get public ad pricing, limits and terms version', { security: false, response: ref('AdsPublicSettings') }) },

  // --- advertiser account ---
  [`${api}/ads/auth/register`]: { post: ads(T.acct, 'Register an advertiser account', { security: false, body: ref('AdsRegisterInput'), response: ref('AdsAccount'), created: true, conflict: 'EMAIL_TAKEN — email already has an account', description: 'Thin wrapper over POST /api/auth/register with product=ads: creates the shared account with an `ads` membership + advertiser profile and signs in. An email already used by any TestFlow account returns 409 EMAIL_TAKEN (details.canJoin) — sign in and use POST /api/auth/memberships instead. Rate limited (20 / 15 min, shared across instances).' }) },
  [`${api}/ads/auth/login`]: { post: ads(T.acct, 'Sign in as an advertiser', { security: false, body: ref('LoginInput'), response: ref('AdsAccount'), description: 'Thin wrapper over POST /api/auth/login with product=ads: an account without an ads membership gets 403 NO_MEMBERSHIP (details.canJoin). Logout, refresh, password reset and CSRF behave exactly as in /api/auth/*.' }) },
  [`${api}/ads/auth/me`]: { get: ads(T.acct, 'Get the signed-in advertiser and profile', { role: 'advertiser', response: ref('AdsAccount') }) },
  [`${api}/ads/profile`]: { patch: ads(T.acct, 'Update advertiser profile', { role: 'advertiser', body: ref('AdsProfileInput'), response: ref('AdsAccount') }) },

  // --- assets ---
  [`${api}/ads/assets/images`]: {
    post: {
      ...ads(T.camp, 'Upload an ad image', { role: 'advertiser', description: 'Multipart field `image`. JPEG/PNG/WebP only (validated from real bytes, not extension/MIME), ≥300×150 px, ≤2 MB. Re-encoded to WebP (EXIF stripped, max 1280 px, ~1 MB target) and stored in Cloudflare R2. Unattached images are deleted after 24 h. 40 uploads/hour.', conflict: undefined }),
      requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } } } } },
      responses: {
        '201': response('Image stored', ref('AdsAssetResponse')),
        '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' },
        '413': response('IMAGE_TOO_LARGE (over 2 MB)', ref('Error')),
        '422': response('INVALID_IMAGE | UNSUPPORTED_IMAGE_FORMAT | IMAGE_TOO_SMALL | ANIMATED_IMAGE_NOT_ALLOWED', ref('Error')),
        '429': { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  [`${api}/ads/assets/{id}`]: { delete: ads(T.camp, 'Delete an unused ad image', { role: 'advertiser', parameters: [id], noContent: true, notFound: true, conflict: 'ASSET_IN_USE' }) },

  // --- campaigns ---
  [`${api}/ads/dashboard`]: { get: ads(T.camp, 'Advertiser dashboard summary', { role: 'advertiser', response: ref('AdsDashboard') }) },
  [`${api}/ads/campaigns`]: {
    get: ads(T.camp, 'List my campaigns', { role: 'advertiser', description: 'Archived campaigns are hidden unless group/status asks for them. Campaigns past their retention date never appear.', parameters: [q('group', { type: 'string', enum: groups }, 'Dashboard grouping: active (active+scheduled), expired (expired+removed) …'), q('status', ref('AdsCampaignStatus')), q('q', { type: 'string', maxLength: 100 }, 'Name search'), page, limit], response: ref('AdsCampaignList') }),
    post: ads(T.camp, 'Create a campaign (draft)', { role: 'advertiser', body: ref('AdsCampaignInput'), response: ref('AdsCampaignResponse'), created: true, description: 'Price is calculated on the server from the admin-configured daily fee. Limits (title length, max description words, duration range) come from GET /api/ads/pricing. Destination links must be https, public hosts, not shorteners, and (if configured) pass Google Safe Browsing; WhatsApp numbers are normalized to international digits.' }),
  },
  [`${api}/ads/campaigns/{id}`]: {
    get: ads(T.camp, 'Get one of my campaigns with its history', { role: 'advertiser', parameters: [id], notFound: true, response: ref('AdsCampaignDetail') }),
    patch: ads(T.camp, 'Edit a campaign', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'NOT_EDITABLE | DURATION_LOCKED', body: ref('AdsCampaignUpdate'), response: ref('AdsCampaignResponse'), description: 'Only `draft` and `rejected` campaigns are editable. Duration of an already-paid (rejected) campaign is locked.' }),
    delete: ads(T.camp, 'Delete an unpaid draft', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'NOT_DELETABLE', noContent: true }),
  },
  [`${api}/ads/campaigns/{id}/resubmit`]: { post: ads(T.camp, 'Resubmit a rejected (already paid) campaign for review', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'INVALID_TRANSITION | PAYMENT_REQUIRED', response: ref('AdsCampaignResponse'), description: 'No second payment. Clears the 30-day rejected purge date.' }) },
  [`${api}/ads/campaigns/{id}/archive`]: { post: ads(T.camp, 'Archive an expired, removed or rejected campaign', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'INVALID_TRANSITION', response: ref('AdsCampaignResponse') }) },
  [`${api}/ads/campaigns/{id}/republish`]: { post: ads(T.camp, 'Republish an expired/removed campaign as a new draft', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'NOT_REPUBLISHABLE', response: ref('AdsCampaignResponse'), created: true, description: 'Creates a NEW draft (same content/image, current price) that must be paid and approved again. Idempotent: an open clone is returned if it already exists. Only possible during the 7-day retention window.' }) },
  [`${api}/ads/campaigns/{id}/analytics`]: { get: ads(T.camp, 'Campaign analytics', { role: 'advertiser', parameters: [id, q('from', { type: 'string', format: 'date-time' }), q('to', { type: 'string', format: 'date-time' })], notFound: true, response: ref('AdsAnalytics'), description: 'Aggregates only — never student identities. Range ≤ 92 days. See AdsAnalytics for precise metric definitions.' }) },

  // --- checkout & payments ---
  [`${api}/ads/checkout/quote`]: { post: ads(T.pay, 'Price one or more campaigns (server-side)', { role: 'advertiser', body: ref('AdsQuoteInput'), notFound: true, response: ref('AdsQuote') }) },
  [`${api}/ads/checkout`]: {
    post: {
      ...ads(T.pay, 'Start checkout for one or more draft campaigns', { role: 'advertiser', body: ref('AdsCheckoutInput'), response: ref('AdsCheckoutResponse'), created: true, notFound: true, conflict: 'TERMS_VERSION_MISMATCH | NOT_PAYABLE | CHECKOUT_CONFLICT | IDEMPOTENCY_KEY_REUSED', description: 'Requires accepting the current advertising terms. Prices are recalculated on the server; client amounts are rejected. Redirect the user to `authorizationUrl`. Payment never publishes a campaign — it moves to `pending_review`. 503 PAYMENT_NOT_CONFIGURED if no provider is set. 30/hour.' }),
      parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 100 }, description: 'Reuse the same key when retrying: the original checkout is returned instead of creating another.' }],
    },
  },
  [`${api}/ads/checkout/verify`]: { get: ads(T.pay, 'Verify a payment with the provider (after redirect back)', { role: 'advertiser', parameters: [q('reference', { type: 'string' })], notFound: true, response: ref('AdsCheckoutResponse'), description: 'Owner-only. Re-verifies with the provider API; amount and currency must match. Idempotent.' }) },
  [`${api}/ads/checkout/{id}/cancel`]: { post: ads(T.pay, 'Cancel an unpaid checkout', { role: 'advertiser', parameters: [id], notFound: true, conflict: 'ALREADY_PAID', response: ref('AdsCheckoutResponse'), description: 'Releases the campaigns back to `draft`.' }) },
  [`${api}/ads/payments`]: { get: ads(T.pay, 'My payment history', { role: 'advertiser', parameters: [page, limit], response: { type: 'object', properties: { items: { type: 'array', items: ref('AdsCheckoutResponse') }, page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' } } } }) },
  [`${api}/ads/payments/webhook`]: {
    post: {
      tags: [T.pay], summary: 'Payment provider webhook (Paystack)',
      description: 'Called by the provider only. The `x-paystack-signature` HMAC-SHA512 over the raw body is verified; the server then re-verifies the transaction through the provider API before activating anything. Idempotent — duplicate deliveries are no-ops. Always 200 for a valid signature.',
      parameters: [{ name: 'x-paystack-signature', in: 'header', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { event: { type: 'string', example: 'charge.success' }, data: { type: 'object', properties: { reference: { type: 'string' } } } } } } } },
      responses: { '200': response('Acknowledged', { type: 'object', properties: { received: { type: 'boolean' }, applied: { type: 'boolean' }, ignored: { type: 'boolean' } } }), '401': response('INVALID_SIGNATURE', ref('Error')) },
    },
  },

  // --- student serving ---
  [`${api}/ads/serve`]: { post: ads(T.serve, 'Get the sponsored ad for a completed CBT session', { role: 'student', body: ref('AdsServeInput'), response: ref('AdsServeResponse'), conflict: 'SESSION_NOT_COMPLETED', notFound: true, description: 'Returns an eligible ad or an explicit `{ad:null, reason}`. Eligibility (approved, paid, within paid dates, targeting, frequency caps, ads enabled) is enforced server-side at request time. One ad per session — reloading returns the same ad. 30/min.' }) },
  [`${api}/ads/events`]: { post: ads(T.serve, 'Report an ad engagement event', { role: 'student', body: ref('AdsEventInput'), response: ref('AdsEventResult'), notFound: true, conflict: 'IMPRESSION_REQUIRED', description: 'Deduplicated by `eventId` (idempotency key) and by (serveId, type). `impression` requires `visibleMs ≥ 1000`. `click`/`whatsapp_click` require a prior impression. 410 SERVE_EXPIRED when too old. 120/min.' }) },

  // --- admin ---
  [`${api}/admin/ads/overview`]: { get: ads(T.admin, 'Ads overview (campaign counts, revenue, 30-day performance)', { admin: true, response: { type: 'object' } }) },
  [`${api}/admin/ads/campaigns`]: { get: ads(T.admin, 'List campaigns for review', { admin: true, parameters: [q('status', ref('AdsCampaignStatus')), q('group', { type: 'string', enum: groups }), q('paymentStatus', { type: 'string', enum: ['unpaid', 'pending', 'paid', 'refund_due', 'refunded'] }), q('advertiser', ref('ObjectId')), q('q', { type: 'string' }), page, limit], response: ref('AdsCampaignList'), description: 'The pending_review queue is ordered oldest-first.' }) },
  [`${api}/admin/ads/campaigns/{id}`]: { get: ads(T.admin, 'Inspect a campaign (content, destination, advertiser, payment, history)', { admin: true, parameters: [id], notFound: true, response: { type: 'object' } }) },
  [`${api}/admin/ads/campaigns/{id}/history`]: { get: ads(T.admin, 'Moderation / lifecycle history', { admin: true, parameters: [id], response: { type: 'object', properties: { history: { type: 'array', items: { type: 'object' } } } } }) },
  [`${api}/admin/ads/campaigns/{id}/analytics`]: { get: ads(T.admin, 'Campaign analytics (admin)', { admin: true, parameters: [id, q('from', { type: 'string', format: 'date-time' }), q('to', { type: 'string', format: 'date-time' })], notFound: true, response: ref('AdsAnalytics') }) },
  [`${api}/admin/ads/campaigns/{id}/approve`]: { post: ads(T.admin, 'Approve a paid campaign', { admin: true, parameters: [id], conflict: 'INVALID_TRANSITION — not pending_review or not paid', response: ref('AdsCampaignResponse'), description: 'Sets `active` (or `scheduled` for a future start date) and fixes startsAt/endsAt = start + paid days. Unpaid campaigns can never be approved.' }) },
  [`${api}/admin/ads/campaigns/{id}/reject`]: { post: ads(T.admin, 'Reject a campaign', { admin: true, parameters: [id], body: ref('AdsRejectInput'), conflict: 'INVALID_TRANSITION', response: ref('AdsCampaignResponse'), description: 'A reason (≥5 chars) is required and shown to the advertiser. Without `refund` the advertiser may fix and resubmit within 30 days; with `refund:true` the campaign is flagged refund_due and purged after the normal retention window.' }) },
  [`${api}/admin/ads/campaigns/{id}/suspend`]: { post: ads(T.admin, 'Suspend a live campaign', { admin: true, parameters: [id], body: ref('AdsReasonInput'), conflict: 'INVALID_TRANSITION', response: ref('AdsCampaignResponse'), description: 'Stops serving immediately. Suspension does not extend the paid period.' }) },
  [`${api}/admin/ads/campaigns/{id}/reinstate`]: { post: ads(T.admin, 'Reinstate a suspended campaign', { admin: true, parameters: [id], conflict: 'INVALID_TRANSITION | CAMPAIGN_ENDED', response: ref('AdsCampaignResponse') }) },
  [`${api}/admin/ads/campaigns/{id}/remove`]: { post: ads(T.admin, 'Remove a campaign', { admin: true, parameters: [id], body: ref('AdsReasonInput'), conflict: 'INVALID_TRANSITION', response: ref('AdsCampaignResponse'), description: 'Takes the campaign down and starts the 7-day retention countdown (advertiser can still view it and republish).' }) },
  [`${api}/admin/ads/payments`]: { get: ads(T.admin, 'List ad payments', { admin: true, parameters: [q('status', { type: 'string', enum: ['initialized', 'paid', 'failed', 'abandoned', 'refunding', 'refunded'] }), q('advertiser', ref('ObjectId')), page, limit], response: { type: 'object' } }) },
  [`${api}/admin/ads/payments/{id}/refund`]: { post: ads(T.admin, 'Refund a payment (whole payment)', { admin: true, parameters: [id], body: ref('AdsReasonInput'), notFound: true, conflict: 'NOT_REFUNDABLE | CAMPAIGN_NOT_REFUNDABLE', response: { type: 'object' }, description: 'Only allowed when every campaign in the payment was rejected with `refund:true`. Single-shot: concurrent calls produce one provider refund. Audited.' }) },
  [`${api}/admin/ads/settings`]: {
    get: ads(T.admin, 'Get all ad settings', { admin: true, response: ref('AdsSettings') }),
    patch: ads(T.admin, 'Update ad settings (daily fee, limits, retention, frequency caps, terms version)', { admin: true, body: ref('AdsSettings'), response: ref('AdsSettings'), description: 'Any subset of fields. Money is integer kobo (₦1,000 = 100000). Changes are written to the audit log with before/after values and apply to new checkouts/campaigns only.' }),
  },
  [`${api}/admin/ads/training/summary`]: { get: ads(T.admin, 'Summary of anonymized ad-training data', { admin: true, response: ref('AdsTrainingSummary'), description: 'Record counts, no-ad reasons, outcome labels (impressions/clicks/WhatsApp/skips), date range and current retention. Aggregates only.' }) },
  [`${api}/admin/ads/training/export`]: {
    get: {
      ...ads(T.admin, 'Export anonymized ad decisions as JSONL', { admin: true, parameters: [q('from', { type: 'string', format: 'date-time' }), q('to', { type: 'string', format: 'date-time' }), q('includeNoAd', { type: 'boolean', default: true }), q('limit', { type: 'integer', minimum: 1, maximum: 100000, default: 50000 })], description: '**Role: super_admin only.** Streams `application/x-ndjson` (one decision per line, schema AdsTrainingRecord). Contains only bucketed context, pseudonymous campaign keys and outcome labels — no student, session or campaign-content data. The export is audited (AD_TRAINING_EXPORT).' }),
      responses: { '200': { description: 'Newline-delimited JSON', content: { 'application/x-ndjson': { schema: ref('AdsTrainingRecord') } } }, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '422': { $ref: '#/components/responses/ValidationError' } },
    },
  },
  [`${api}/admin/ads/jobs`]: { get: ads(T.admin, 'Recent scheduled-job runs (lifecycle, retention)', { admin: true, response: { type: 'object', properties: { runs: { type: 'array', items: { type: 'object' } } } } }) },
});

Object.assign(window.testflowOpenApi.components.responses, {
  ValidationError: { description: 'Validation failed. `error.fields` maps field name → message.', content: { 'application/json': { schema: ref('Error') } } },
  NotFound: { description: 'Not found (also returned for resources owned by someone else)', content: { 'application/json': { schema: ref('Error') } } },
  RateLimited: { description: 'RATE_LIMITED — too many requests', content: { 'application/json': { schema: ref('Error') } } },
});

const str = (extra = {}) => ({ type: 'string', ...extra });
const int = (extra = {}) => ({ type: 'integer', ...extra });
Object.assign(window.testflowOpenApi.components.schemas, {
  AdsCampaignStatus: { type: 'string', enum: ['draft', 'pending_payment', 'pending_review', 'rejected', 'scheduled', 'active', 'suspended', 'expired', 'removed', 'cancelled', 'archived'], description: 'draft → pending_payment → pending_review → active|scheduled → expired → archived. rejected → pending_review (resubmit). active|scheduled → suspended → active. active|scheduled|suspended → removed.' },
  AdsRegisterInput: { type: 'object', required: ['fullName', 'email', 'password', 'confirmPassword', 'businessName'], properties: { fullName: str({ minLength: 2, maxLength: 120 }), email: str({ format: 'email' }), password: str({ format: 'password', minLength: 8, maxLength: 72, description: 'Letters and numbers required' }), confirmPassword: str({ format: 'password' }), businessName: str({ minLength: 2, maxLength: 120 }), contactPhone: str({ maxLength: 20 }) } },
  AdsProfileInput: { type: 'object', properties: { fullName: str(), businessName: str(), contactPhone: str() } },
  AdsAccount: { type: 'object', properties: { user: ref('User'), memberships: { type: 'array', items: ref('Membership') }, activeProduct: str({ nullable: true }), csrfToken: str(), profile: { type: 'object', properties: { businessName: str(), contactPhone: str() } } } },
  AdsPublicSettings: { type: 'object', properties: { settings: { type: 'object', properties: { currency: str({ example: 'NGN' }), dailyFeeKobo: int({ example: 100000 }), pricingPolicy: str({ enum: ['flat', 'tiered'] }), tiers: { type: 'array', items: { type: 'object', properties: { minDays: int(), percentOff: int() } } }, minDurationDays: int(), maxDurationDays: int(), maxDescriptionWords: int({ example: 500 }), recommendedDescriptionWords: int({ example: 60 }), maxTitleChars: int(), maxKeywordChars: int(), maxCampaignsPerCheckout: int(), imageTargetBytes: int(), imageMaxBytes: int(), retentionDays: int({ example: 7 }), termsVersion: str(), termsUrl: str({ format: 'uri' }), contentRulesUrl: str({ format: 'uri' }), privacyUrl: str({ format: 'uri' }) } } } },
  AdsAssetResponse: { type: 'object', properties: { asset: { type: 'object', properties: { id: ref('ObjectId'), url: str({ format: 'uri' }), width: int(), height: int(), bytes: int(), format: str({ example: 'webp' }) } } } },
  AdsDestination: { oneOf: [{ type: 'object', required: ['type', 'url'], properties: { type: str({ enum: ['url'] }), url: str({ example: 'https://shop.example.com/promo' }) } }, { type: 'object', required: ['type', 'whatsapp'], properties: { type: str({ enum: ['whatsapp'] }), whatsapp: str({ example: '08012345678', description: 'Local or international; stored as digits e.g. 2348012345678' }) } }] },
  AdsCampaignInput: { type: 'object', required: ['name', 'title', 'description', 'assetId', 'destination', 'durationDays'], properties: { name: str({ maxLength: 120 }), title: str({ description: 'Concise; max length from /ads/pricing (default 80)' }), description: str({ description: 'Plain text, max words from /ads/pricing (default 500; aim for ~60)' }), assetId: ref('ObjectId'), destination: ref('AdsDestination'), keywords: { type: 'array', maxItems: 3, items: str({ maxLength: 30 }) }, durationDays: int({ minimum: 1 }), preferredStartDate: str({ format: 'date-time', description: 'Optional; publication starts at approval or this date, whichever is later' }) } },
  AdsCampaignUpdate: { type: 'object', description: 'Any subset of AdsCampaignInput', properties: { name: str(), title: str(), description: str(), assetId: ref('ObjectId'), destination: ref('AdsDestination'), keywords: { type: 'array', items: str() }, durationDays: int(), preferredStartDate: str({ format: 'date-time' }) } },
  AdsCampaign: { type: 'object', properties: { id: ref('ObjectId'), name: str(), title: str(), description: str(), image: { type: 'object', properties: { url: str() } }, destination: { type: 'object' }, keywords: { type: 'array', items: str() }, status: ref('AdsCampaignStatus'), paymentStatus: str({ enum: ['unpaid', 'pending', 'paid', 'refund_due', 'refunded'] }), durationDays: int(), dailyFeeKobo: int(), priceKobo: int(), currency: str({ example: 'NGN' }), submittedAt: str({ format: 'date-time' }), approvedAt: str({ format: 'date-time' }), startsAt: str({ format: 'date-time' }), endsAt: str({ format: 'date-time' }), expiredAt: str({ format: 'date-time' }), rejectionReason: str(), suspensionReason: str(), purgeAt: str({ format: 'date-time', description: 'After this instant the campaign is deleted (hidden immediately)' }), stats: { type: 'object' }, createdAt: str({ format: 'date-time' }) } },
  AdsCampaignResponse: { type: 'object', properties: { campaign: ref('AdsCampaign') } },
  AdsCampaignDetail: { type: 'object', properties: { campaign: ref('AdsCampaign'), history: { type: 'array', items: { type: 'object', properties: { action: str(), fromStatus: str(), toStatus: str(), reason: str(), createdAt: str({ format: 'date-time' }) } } }, remainingMs: { type: 'integer', nullable: true } } },
  AdsCampaignList: { type: 'object', properties: { items: { type: 'array', items: ref('AdsCampaign') }, page: int(), limit: int(), total: int() } },
  AdsDashboard: { type: 'object', properties: { groups: { type: 'object', additionalProperties: int() }, totals: { type: 'object', properties: { impressions: int(), clicks: int() } } } },
  AdsQuoteInput: { type: 'object', required: ['campaignIds'], properties: { campaignIds: { type: 'array', items: ref('ObjectId'), minItems: 1 } } },
  AdsQuote: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { campaign: ref('ObjectId'), name: str(), days: int(), dailyFeeKobo: int(), grossKobo: int(), percentOff: int(), discountKobo: int(), totalKobo: int() } } }, amountKobo: int(), currency: str({ example: 'NGN' }) } },
  AdsCheckoutInput: { type: 'object', required: ['campaignIds', 'acceptTerms', 'termsVersion'], additionalProperties: false, properties: { campaignIds: { type: 'array', items: ref('ObjectId'), minItems: 1 }, acceptTerms: { type: 'boolean', description: 'Must be true: advertising terms, content rules and privacy policy' }, termsVersion: str({ description: 'Must equal the current termsVersion from /ads/pricing' }) } },
  AdsCheckoutResponse: { type: 'object', properties: { paymentId: ref('ObjectId'), reference: str(), amountKobo: int(), currency: str(), status: str({ enum: ['initialized', 'paid', 'failed', 'abandoned', 'refunding', 'refunded'] }), authorizationUrl: str({ format: 'uri', description: 'Only while status is initialized' }), items: { type: 'array', items: { type: 'object', properties: { campaignId: ref('ObjectId'), name: str(), days: int(), amountKobo: int() } } } } },
  AdsAnalytics: { type: 'object', description: 'eligibleRequests = times the ad was returned to a student after a completed CBT session. impressions = ad rendered ≥50% visible for ≥1 s, once per served ad. uniqueViewers = distinct students per campaign. clicks = first "open ad" click per served ad. whatsappClicks = first WhatsApp tap per served ad. ctr = clicks/impressions %, whatsappCtr = whatsappClicks/impressions %.', properties: { campaignId: ref('ObjectId'), status: ref('AdsCampaignStatus'), startsAt: str({ format: 'date-time', nullable: true }), endsAt: str({ format: 'date-time', nullable: true }), expiredAt: str({ format: 'date-time', nullable: true }), spend: { type: 'object', properties: { amountKobo: int(), currency: str() } }, totals: { type: 'object', properties: { eligibleRequests: int(), impressions: int(), uniqueViewers: int(), clicks: int(), whatsappClicks: int(), skips: int(), ctr: { type: 'number' }, whatsappCtr: { type: 'number' } } }, daily: { type: 'array', items: { type: 'object', properties: { day: str({ example: '2026-01-31' }), eligibleRequests: int(), impressions: int(), uniqueViewers: int(), clicks: int(), whatsappClicks: int(), skips: int() } } } } },
  AdsServeInput: { type: 'object', required: ['sessionType', 'sessionId'], additionalProperties: false, properties: { sessionType: str({ enum: ['exam', 'post_utme'] }), sessionId: ref('ObjectId') } },
  AdsServeResponse: { type: 'object', properties: { ad: { nullable: true, type: 'object', properties: { serveId: str({ format: 'uuid' }), label: str({ example: 'Sponsored' }), title: str(), description: str(), imageUrl: str({ format: 'uri' }), cta: { type: 'object', properties: { type: str({ enum: ['url', 'whatsapp'] }), label: str(), href: str({ format: 'uri' }) } } } }, reason: str({ enum: ['no_eligible_campaign', 'frequency_capped', 'ads_disabled'], description: 'Present when ad is null' }), ranker: str({ example: 'deterministic-v1' }) } },
  AdsEventInput: { type: 'object', required: ['serveId', 'eventId', 'type'], additionalProperties: false, properties: { serveId: str({ format: 'uuid' }), eventId: str({ format: 'uuid', description: 'Idempotency key — generate a new UUID per event' }), type: str({ enum: ['impression', 'click', 'whatsapp_click', 'skip'] }), visibleMs: int({ minimum: 0, description: 'Required ≥1000 for impression' }) } },
  AdsEventResult: { type: 'object', properties: { accepted: { type: 'boolean' }, duplicate: { type: 'boolean' }, redirectUrl: str({ format: 'uri' }) } },
  AdsReasonInput: { type: 'object', required: ['reason'], properties: { reason: str({ minLength: 5, maxLength: 1000 }) } },
  AdsRejectInput: { type: 'object', required: ['reason'], properties: { reason: str({ minLength: 5, maxLength: 1000 }), refund: { type: 'boolean', default: false } } },
  AdsTrainingSummary: { type: 'object', properties: { totalRecords: int(), oldest: str({ format: 'date-time', nullable: true }), newest: str({ format: 'date-time', nullable: true }), outcomes: { type: 'array', items: { type: 'object', properties: { outcome: str({ enum: ['served', 'no_ad'] }), reason: str({ nullable: true }), count: int() } } }, labels: { type: 'object', properties: { served: int(), impressions: int(), clicks: int(), whatsappClicks: int(), skips: int() } }, perDay: { type: 'array', items: { type: 'object', properties: { day: str(), records: int() } } }, loggingEnabled: { type: 'boolean' }, retentionDays: int() } },
  AdsTrainingRecord: { type: 'object', description: 'One ad decision. `label` is defined only for the selected (served) ad; unselected candidates have no label (counterfactual outcome unknown).', properties: { schema: int({ example: 1 }), decisionId: str({ format: 'uuid' }), ts: str({ format: 'date-time', description: 'Hour precision' }), ranker: str({ example: 'deterministic-v1' }), policy: { type: 'object', properties: { name: str({ example: 'rules' }), propensity: { type: 'number', example: 1 }, exploration: { type: 'boolean' } } }, outcome: str({ enum: ['served', 'no_ad'] }), noAdReason: str({ nullable: true, enum: ['frequency_capped', 'no_eligible_campaign'] }), context: { type: 'object', description: 'Bucketed CBT context: sessionType, subjectCodes, department, level, accuracyBand, answeredBand, timeUseBand, lengthBand, strikesBand, streakBand, partOfDay, dayType, adsSeenTodayBand' }, candidateCount: int(), candidates: { type: 'array', maxItems: 25, items: { type: 'object', properties: { campaignKey: str(), rank: int(), relevance: int(), impressionsToday: int(), selected: { type: 'boolean' }, features: { type: 'object', description: 'destType, keywordCount, keywordMatch, titleLenBand, descWordsBand, durationBand, ageBand, remainingBand' } } } }, selectedKey: str({ nullable: true }), label: { nullable: true, type: 'object', properties: { impression: { type: 'boolean' }, visibleMs: int({ nullable: true }), click: { type: 'boolean' }, whatsappClick: { type: 'boolean' }, skip: { type: 'boolean' } } } } },
  AdsSettings: { type: 'object', description: 'Money in integer kobo.', properties: { adsEnabled: { type: 'boolean' }, trainingLoggingEnabled: { type: 'boolean', description: 'Log anonymized decisions for future model training' }, trainingRetentionDays: int({ example: 365, minimum: 30, maximum: 1095, description: 'How long anonymized training records are kept' }), dailyFeeKobo: int({ example: 100000 }), pricingPolicy: str({ enum: ['flat', 'tiered'] }), tiers: { type: 'array', items: { type: 'object', properties: { minDays: int({ minimum: 2 }), percentOff: int({ minimum: 1, maximum: 90 }) } } }, minDurationDays: int(), maxDurationDays: int(), maxDescriptionWords: int({ example: 500 }), maxTitleChars: int(), maxKeywordChars: int(), maxCampaignsPerCheckout: int(), maxActiveCampaignsPerAdvertiser: int(), imageTargetBytes: int(), imageMaxBytes: int(), retentionDays: int({ example: 7 }), rejectedRetentionDays: int({ example: 30 }), maxAdsPerStudentPerDay: int(), maxSameCampaignPerStudentPerDay: int(), termsVersion: str(), termsUrl: str({ format: 'uri' }), contentRulesUrl: str({ format: 'uri' }), privacyUrl: str({ format: 'uri' }) } },
});
// `role` in the User schema
const userRole = window.testflowOpenApi.components.schemas.User?.properties?.role;
if (userRole?.enum && !userRole.enum.includes('advertiser')) userRole.enum.push('advertiser');

Object.entries(window.testflowOpenApi.paths).forEach(([path, methods]) => {
  if (Object.values(methods)[0]?.tags) return; // explicitly tagged (ads endpoints)
  if (/\/auth\/(memberships|switch-product|oauth\/)/.test(path)) { Object.values(methods).forEach((method) => { method.tags = ['Identity']; }); return; }
  const tag = path === '/health' ? 'Health'
    : path.includes('/public/') ? 'Public'
      : path.includes('/auth/') ? 'Authentication'
        : path.includes('/subjects') ? 'Subjects'
          : path.includes('/questions') ? 'Questions'
            : path.includes('/exam-sessions') ? 'Exam sessions'
              : path.includes('/post-utme') ? 'Post-UTME'
                : path.includes('/verifications') ? 'Verifications'
                  : 'Administration';
  Object.values(methods).forEach((method) => { method.tags = [tag]; });
});
