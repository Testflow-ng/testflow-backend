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
    { name: 'Feedback', description: 'Product feedback from students, and the admin queue that answers it' },
    { name: 'Study', description: 'Reporting and saving a question, and the public link for a finished result' },
    { name: 'Advertising', description: 'Provider-aware advertising: which provider may run on which placement, for whom. Separate from the Testflow Ads marketplace.' },
    { name: 'Billing', description: 'The student pass that removes advertising, unlocks hosting a live CBT session and opens the Library' },
    { name: 'Library', description: 'The book shelf, the reader, bookmarks and reading progress. Browsing, bookmarks and progress are free; reading a page and downloading a file are part of the Student Pass.' },
    { name: 'Everybody', description: 'Organization accounts (the Everybody product): the organization, its members, invitations, org subscriptions, the console (exams, question bank, students, the organization library, payouts, earnings, domains) and the hosted site builder, plus the tenant site API its students sign in to' },
    { name: 'Live CBT', description: 'Host-run live sittings joined by share link: the waiting room, approvals, question delivery, submission and results. Hosting needs the `live_cbt_host` entitlement; joining is free. The socket at `WS /ws/live-cbt/{shareCode}` pushes the same events as the SSE stream.' },
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
      get: operation('Get share metadata page for a public question', { security: false, parameters: [id], description: 'A 404 when the question is not shareable, rather than a redirect: a crawler sent to the marketing site would be advertising a link that does not resolve.', response: { type: 'string', description: 'HTML social share page' } }),
    },
    [`${api}/public/questions/{id}/og.png`]: {
      get: operation('Get the preview image for a shared question', { security: false, parameters: [id], description: 'A 1200x630 PNG of the question and its options, rendered on the server because a crawler runs nothing. It never shows the answer.', response: { type: 'string', format: 'binary' } }),
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
    [`${api}/feedback`]: {
      get: operation('List the current user feedback', { description: "Only the caller's own notes, newest first.", response: { $ref: '#/components/schemas/FeedbackListResponse' } }),
      post: operation('Send feedback about TestFlow', { description: 'The author is the authenticated user; `student` and `status` in the body are refused rather than ignored. The same words from the same account inside 24 hours answer with the existing note instead of a new one. 10 submissions / hour per account, counted across instances.', body: { $ref: '#/components/schemas/FeedbackInput' }, example: { kind: 'problem', rating: 2, screen: 'Exam timer', message: 'The countdown froze when I switched tabs.' }, created: true, response: { $ref: '#/components/schemas/FeedbackResponse' }, errors: true }),
    },
    [`${api}/admin/feedback`]: {
      get: operation('List the student feedback queue', { admin: true, description: 'Returns the entries for the filter plus the counts the filter labels are drawn from. The counts describe the whole queue, not the current filter.', parameters: [{ name: 'status', in: 'query', schema: { $ref: '#/components/schemas/FeedbackStatus' } }, { name: 'kind', in: 'query', schema: { $ref: '#/components/schemas/FeedbackKind' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }], response: { $ref: '#/components/schemas/FeedbackQueueResponse' } }),
    },
    [`${api}/admin/feedback/{id}`]: {
      patch: operation('Move a feedback note along and answer it', { admin: true, parameters: [id], description: 'Both parts are optional. `reply` is student-visible, and an empty string clears it. Resolving records who and when; reopening clears that bookkeeping and keeps the reply.', body: { $ref: '#/components/schemas/FeedbackUpdateInput' }, response: { $ref: '#/components/schemas/FeedbackResponse' }, errors: true }),
    },
    [`${api}/questions/{id}/flag`]: {
      post: operation('Report a broken question', { description: 'One report per student per question: reporting again updates the reason and the note rather than adding a row, so the report count is a count of students. A reason of `other` requires a note. The answer is the full report row, carrying the question and its key so an admin can judge the claim without opening the bank.', parameters: [id], body: { $ref: '#/components/schemas/FlagInput' }, example: { reason: 'typo', note: 'Option C reads 1l instead of 11.' }, created: true, response: { $ref: '#/components/schemas/FlagResponse' }, errors: true }),
    },
    [`${api}/question-bookmarks`]: {
      get: operation('List the current user saved questions', { description: 'Newest first. Each row carries the question with its answer and explanation, because a study list without the key is a list of things to re-answer blind. A question that has since been deleted comes back as `question: null` rather than dropping the row.', response: { $ref: '#/components/schemas/BookmarkListResponse' } }),
      post: operation('Save or unsave a question', { description: 'A toggle. The server is the one place that knows which way it is going, so the button does not have to, and the answer carries the new state.', body: { $ref: '#/components/schemas/BookmarkToggleInput' }, example: { questionId: '65f1c2d3e4b5a6f7a8b9c0d1' }, response: { $ref: '#/components/schemas/BookmarkToggleResponse' }, errors: true }),
    },
    [`${api}/question-bookmarks/{id}`]: {
      delete: operation('Remove a saved question', { description: '`id` is the bookmark row, not the question. A row that is not yours is a 404 rather than a 403, so the refusal does not confirm that it exists.', parameters: [id], response: { $ref: '#/components/schemas/BookmarkToggleResponse' } }),
    },
    [`${api}/admin/question-flags`]: {
      get: operation('List the reported-question queue', { admin: true, description: 'Every report, newest first, plus the counts the filter labels are drawn from. `questionCount` is the number of distinct questions ever reported, which is the number an admin can act on.', response: { $ref: '#/components/schemas/FlagQueueResponse' } }),
    },
    [`${api}/admin/question-flags/{id}`]: {
      patch: operation('Decide a reported question', { admin: true, parameters: [id], description: '`status` is required: the buttons on the queue each set one, and there is no default decision that would not be a guess. Resolving or dismissing records who and when; reopening clears that bookkeeping and keeps the note, because the note is usually why it was reopened.', body: { $ref: '#/components/schemas/FlagUpdateInput' }, response: { $ref: '#/components/schemas/FlagResponse' }, errors: true }),
    },
    [`${api}/exam-sessions/{id}/share`]: {
      post: operation('Mint the public link for a finished attempt', { parameters: [id], description: 'Owner only, and only once the paper is submitted. Asking twice answers with the token that already exists, so a student who shares twice gets one URL. 404 for an attempt that is not yours (a 403 would confirm it exists), 409 while the paper is still running.', response: { $ref: '#/components/schemas/ResultShareResponse' } }),
    },
    '/r/{token}': {
      get: {
        summary: 'Open a shared result',
        description: 'The page a person opens and a chat client previews, carrying the Open Graph tags. Public by design: the token is the credential, so there is no session. Served outside `/api` and built per request, because the tag URLs have to be absolute and the host is the one the caller used. Clearing the attempt\'s token makes this a 404 immediately.',
        security: false,
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The score card page', content: { 'text/html': { schema: { type: 'string' } } } },
          404: { description: 'Unknown or revoked token' },
        },
      },
    },
    '/r/{token}/og.png': {
      get: {
        summary: 'Get the Open Graph image for a shared result',
        description: 'The 1200x630 score card a chat client shows: the mark, the score, the subject and count, the band, and Flo in the mood the score earned. Immutable, because a token always means the same attempt. No cookie is required and nothing behind it is answer data.',
        security: false,
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The score card', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          404: { description: 'Unknown or revoked token' },
        },
      },
    },
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
      Product: { type: 'string', enum: ['student', 'ads', 'everybody'], description: 'student = TestFlow CBT, ads = Testflow Ads, everybody = Testflow for Everyone. New products are added here.' },
      Membership: { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' }, role: { type: 'string', example: 'student' }, joinedAt: { type: 'string', format: 'date-time', nullable: true } } },
      AccountPayload: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' }, memberships: { type: 'array', items: { $ref: '#/components/schemas/Membership' } }, activeProduct: { type: 'string', nullable: true, example: 'student' }, profiles: { type: 'object', description: 'Per-product summaries', properties: { student: { type: 'object', properties: { username: { type: 'string', nullable: true }, level: { type: 'string', nullable: true }, department: { type: 'string', nullable: true }, streakCount: { type: 'integer' }, hasMigrated: { type: 'boolean' } } }, ads: { type: 'object', properties: { businessName: { type: 'string', nullable: true }, contactPhone: { type: 'string', nullable: true } } }, everybody: { type: 'object', properties: { organizationName: { type: 'string', nullable: true } } } } }, csrfToken: { type: 'string', description: 'Send as X-CSRF-Token on unsafe requests' } } },
      MembershipInput: { type: 'object', required: ['product'], properties: { product: { $ref: '#/components/schemas/Product' }, profile: { type: 'object', description: 'ads needs businessName; everybody needs organizationName', properties: { businessName: { type: 'string' }, contactPhone: { type: 'string' }, organizationName: { type: 'string' } } }, email: { type: 'string', format: 'email', description: 'Only when there is no session' }, password: { type: 'string', format: 'password', description: 'Only when there is no session' } } },
      OAuthAuthorizeInput: { type: 'object', required: ['clientId', 'redirectUri', 'codeChallenge', 'codeChallengeMethod'], properties: { clientId: { type: 'string' }, redirectUri: { type: 'string', format: 'uri' }, codeChallenge: { type: 'string', description: 'base64url(SHA-256(codeVerifier)), 43 chars' }, codeChallengeMethod: { type: 'string', enum: ['S256'] }, state: { type: 'string', maxLength: 200 }, product: { $ref: '#/components/schemas/Product' } } },
      OAuthTokenInput: { type: 'object', required: ['grantType', 'code', 'codeVerifier', 'clientId', 'redirectUri'], properties: { grantType: { type: 'string', enum: ['authorization_code'] }, code: { type: 'string' }, codeVerifier: { type: 'string', minLength: 43, maxLength: 128 }, clientId: { type: 'string' }, redirectUri: { type: 'string', format: 'uri' } } },
      OAuthTokenResponse: { allOf: [{ $ref: '#/components/schemas/AccountPayload' }, { type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer', example: 900 } } }] },
      RegisterInput: { type: 'object', required: ['fullName', 'email', 'password', 'confirmPassword'], properties: { product: { $ref: '#/components/schemas/Product' }, profile: { type: 'object', description: 'ads: { businessName (required), contactPhone? }. everybody: { organizationName (required, 2–120 chars) }.', properties: { businessName: { type: 'string' }, contactPhone: { type: 'string' }, organizationName: { type: 'string', minLength: 2, maxLength: 120 } } }, fullName: { type: 'string', minLength: 2, maxLength: 120 }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 }, confirmPassword: { type: 'string', format: 'password' } } },
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
      PublicQuestionResponse: { type: 'object', properties: { question: { type: 'object', description: 'The question card without its answer or explanation. The fields are the QuestionCardPublic schema below.' } } },
      PublicResponseResult: { type: 'object', properties: { isCorrect: { type: 'boolean' }, correctOption: { type: 'integer', description: 'The index of the right answer. Named `correctOption` on every API read path; the bank\'s own field is `correctIndex`.' }, explanation: { type: 'string' } } },
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

// Everybody: organizations, members, invitations, subscriptions, the site builder and the
// super-admin console. Every one of these needs a session, so none of them is `security: false`.
const orgId = { name: 'organizationId', in: 'path', required: true, schema: ref('ObjectId') };
const memberId = { name: 'memberId', in: 'path', required: true, schema: ref('ObjectId') };

Object.assign(window.testflowOpenApi.paths, {
  // --- everybody: the organization ---
  [`${api}/v1/everybody/organizations`]: {
    post: operation('Create an organization', { body: ref('OrgCreateInput'), response: ref('OrgView'), created: true, errors: true, description: 'The caller becomes the owner. `slug` is the subdomain; reserved words (www, api, admin, ads, everybody, ...) are refused.' }),
    get: operation('List the organizations the caller belongs to', { parameters: [page, limit], response: ref('OrgsList') }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}`]: {
    get: operation('Get one organization', { parameters: [orgId], response: ref('OrgView'), description: 'Any member may read it; `myRole` is the caller\'s role in this organization.' }),
    patch: operation('Rename or re-contact an organization', { parameters: [orgId], body: ref('OrgUpdateInput'), response: ref('OrgView'), errors: true, description: 'Owner or admin. The slug is immutable. A closed organization returns `403 ORG_CLOSED`.' }),
  },
  // --- everybody: members ---
  [`${api}/v1/everybody/organizations/{organizationId}/members`]: {
    get: operation('List organization members', { parameters: [orgId, page, limit, { name: 'role', in: 'query', schema: { type: 'string', enum: ['owner', 'admin', 'examiner', 'student'] } }], response: ref('MembersList') }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/members/{memberId}`]: {
    patch: operation('Change a member role or status', { parameters: [orgId, memberId], body: ref('MemberUpdateInput'), response: ref('MemberView'), errors: true, description: 'Owner or admin. Send at least one of `role` and `status`.' }),
    delete: operation('Remove a member', { parameters: [orgId, memberId], response: ref('MemberView'), description: 'Marks the membership `removed`; it does not delete the user account.' }),
  },
  // --- everybody: invitations ---
  [`${api}/v1/everybody/organizations/{organizationId}/invitations`]: {
    post: operation('Invite someone to the organization', { parameters: [orgId], body: ref('OrgInviteInput'), response: ref('InviteResponse'), created: true, errors: true, description: 'Owner or admin. The raw `token` is normally emailed; it is returned here once so a dev client can finish the flow.' }),
  },
  [`${api}/v1/everybody/invitations/accept`]: {
    post: operation('Accept an organization invitation', { body: ref('AcceptInviteInput'), response: ref('AcceptInviteResponse'), created: true, errors: true }),
  },
  // --- everybody: subscriptions (org plans: pro, studio) ---
  [`${api}/v1/everybody/organizations/{organizationId}/subscriptions`]: {
    post: operation('Start a subscription', { parameters: [orgId], body: ref('SubscriptionCreateInput'), response: ref('SubscriptionResponse'), created: true, errors: true, description: 'Owner or admin. One live subscription per organization; a second returns `409 SUBSCRIPTION_EXISTS`. The subscription stays `pending` until checkout is verified.' }),
    get: operation('List the organization subscriptions', { parameters: [orgId], response: ref('SubsList'), description: 'Newest first, each with the caller\'s `myRole`.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/subscriptions/{id}`]: {
    get: operation('Get one subscription', { parameters: [orgId, id], response: ref('SubscriptionResponse') }),
    patch: operation('Cancel or change plan', { parameters: [orgId, id], body: ref('SubscriptionUpdateInput'), response: ref('SubscriptionResponse'), errors: true, description: '`{ cancelAtPeriodEnd: true }` cancels at period end; `{ planKey }` moves the subscription back to `pending` for the new plan.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/subscriptions/{id}/checkout`]: {
    post: operation('Checkout a subscription', { parameters: [orgId, id, { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'Reuse the same key when retrying so the provider is charged once.' }], response: ref('CheckoutResponse'), errors: true, description: 'Returns the provider authorization URL. Verify it afterwards with the same `reference`.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/subscriptions/{id}/verify`]: {
    get: operation('Verify a subscription payment', { parameters: [orgId, id, { name: 'reference', in: 'query', required: false, schema: { type: 'string' } }], response: ref('SubscriptionVerification'), description: 'Re-checks the payment with the provider and, when successful, activates the subscription.' }),
  },
  [`${api}/v1/everybody/subscriptions/webhook`]: {
    post: {
      summary: 'Provider payment webhook (not implemented yet)',
      description: 'Called by the payment provider, never by a client. The route exists but always answers `501 NOT_IMPLEMENTED`: no org subscription is activated by a webhook today, so activation runs through `/v1/everybody/organizations/{organizationId}/subscriptions/{id}/verify` after the provider redirect.',
      security: false,
      responses: {
        '501': { description: 'NOT_IMPLEMENTED', content: { 'application/json': { schema: ref('Error') } } },
      },
    },
  },
});

// --- everybody: the console (exams, questions, students, library, money, domains), the site
// builder and the super-admin console. The organization is always a path segment, never the body. ---
const examId = { name: 'examId', in: 'path', required: true, schema: ref('ObjectId') };
const questionId = { name: 'questionId', in: 'path', required: true, schema: ref('ObjectId') };
const bookId = { name: 'bookId', in: 'path', required: true, schema: ref('ObjectId') };
const bankId = { name: 'bankId', in: 'path', required: true, schema: ref('ObjectId') };
const domainId = { name: 'domainId', in: 'path', required: true, schema: ref('ObjectId') };

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/v1/everybody/templates`]: {
    get: operation('List the site templates', { response: ref('SiteTemplateList') }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/site`]: {
    get: operation('Get the site config', { parameters: [orgId], response: ref('SiteResponse'), description: 'Owner or admin. The flat document the console edits: brand, landing, portal, footer, pages and the publish state.' }),
    patch: operation('Edit the site draft', { parameters: [orgId], body: ref('SitePatchInput'), response: ref('SiteResponse'), errors: true, description: 'Owner or admin. Merges the fields sent (brand and pages field by field, block lists replaced). Publishing is what makes it public.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/site/preview`]: {
    post: operation('Render the draft', { parameters: [orgId], response: ref('SitePreviewResponse'), description: 'Owner or admin. Returns the draft as it would publish, so the console can show it before anyone else sees it.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/site/publish`]: {
    post: operation('Publish the draft', { parameters: [orgId], response: ref('SiteResponse'), errors: true, description: 'Owner or admin. Copies the draft over the published copy, which is what the public site and the share image read.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/site/assets`]: {
    post: operation('Upload a site image', { parameters: [orgId], response: ref('SiteAssetResponse'), created: true, errors: true, description: 'Owner or admin. multipart/form-data with the file in the `file` field and `kind` in the body (logo, favicon, hero or image). 2 MB; png, jpeg or webp. `503 STORAGE_NOT_CONFIGURED` when storage is off.' }),
  },
  // --- exams ---
  [`${api}/v1/everybody/organizations/{organizationId}/exams`]: {
    get: operation('List the organization exams', { parameters: [orgId, page, limit, { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published', 'archived'] }, description: 'The serviced enum value is `archived`; the console currently writes `draft` and `published`.' }, { name: 'q', in: 'query', schema: { type: 'string' } }], response: ref('OrgExamListResponse') }),
    post: operation('Create an exam', { parameters: [orgId], body: ref('OrgExamInput'), response: ref('OrgExamResponse'), created: true, errors: true, description: 'Owner, admin or examiner. A paid exam (`priceMinor > 0`) cannot be published until a payout account is live.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}`]: {
    get: operation('Read one exam', { parameters: [orgId, examId], response: ref('OrgExamResponse'), description: 'The console opens an exam from here, then reads its questions.' }),
    patch: operation('Update an exam', { parameters: [orgId, examId], body: ref('OrgExamUpdate'), response: ref('OrgExamResponse'), errors: true }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}/questions`]: {
    get: operation('List the questions in an exam', { parameters: [orgId, examId], response: ref('OrgQuestionListResponse'), description: 'In the order the owner arranged them.' }),
    put: operation('Replace the questions in an exam', { parameters: [orgId, examId], body: { type: 'object', required: ['questionIds'], properties: { questionIds: { type: 'array', items: ref('ObjectId') } } }, response: ref('OrgExamResponse'), errors: true, description: 'Every id must be a question this organization owns, otherwise `422 VALIDATION_ERROR`.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}/results`]: {
    get: operation('Read the results of an exam', { parameters: [orgId, examId, page, limit], response: ref('OrgExamResultsResponse'), description: 'Every submitted attempt, newest first, with `summary: { attempts, average, highest, lowest }`. Always real scores, whatever `showCorrections` says.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}/publish`]: {
    post: operation('Publish an exam', { parameters: [orgId, examId], response: ref('OrgExamResponse'), errors: true, description: '`422 PAYOUT_REQUIRED` when it is paid and no payout account is live.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}/unpublish`]: {
    post: operation('Take an exam back to draft', { parameters: [orgId, examId], response: ref('OrgExamResponse') }),
  },
  // --- questions ---
  [`${api}/v1/everybody/organizations/{organizationId}/questions`]: {
    get: operation('List the question bank', { parameters: [orgId, page, limit, { name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'topic', in: 'query', schema: { type: 'string' } }, { name: 'difficulty', in: 'query', schema: { type: 'string', enum: ['easy', 'medium', 'hard'] } }, { name: 'bankId', in: 'query', schema: ref('ObjectId') }], response: ref('OrgQuestionListResponse') }),
    post: operation('Add a question', { parameters: [orgId], body: ref('OrgQuestionInput'), response: ref('OrgQuestionResponse'), created: true, errors: true, description: 'Send `examId` or `bankId` to put the new question straight into that exam or bank.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/questions/bulk`]: {
    post: operation('Bulk import questions', { parameters: [orgId, { name: 'examId', in: 'query', schema: ref('ObjectId') }, { name: 'bankId', in: 'query', schema: ref('ObjectId') }], body: { type: 'array', items: ref('OrgQuestionInput') }, response: ref('OrgQuestionBulkResult'), errors: true, description: 'Deliberately loose: good rows are saved and each bad row is reported back in `failed` with its row number, so one malformed line never sinks the batch. `examId` or `bankId` aims the import.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/questions/assets`]: {
    post: operation('Upload a question image', { parameters: [orgId], response: ref('SiteAssetResponse'), created: true, errors: true, description: 'The same uploader and limits as a site image; the URL goes in `stemImageUrl` or `optionImages`.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/questions/{questionId}`]: {
    patch: operation('Update a question', { parameters: [orgId, questionId], body: ref('OrgQuestionUpdate'), response: ref('OrgQuestionResponse'), errors: true }),
    delete: operation('Delete a question', { parameters: [orgId, questionId], response: { type: 'object', properties: { id: ref('ObjectId'), deleted: { type: 'boolean' } } } }),
  },
  // --- question banks ---
  [`${api}/v1/everybody/organizations/{organizationId}/question-banks`]: {
    get: operation('List the question banks', { parameters: [orgId], response: ref('OrgBankListResponse') }),
    post: operation('Create a question bank', { parameters: [orgId], body: ref('OrgBankInput'), response: ref('OrgBankResponse'), created: true, errors: true }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/question-banks/{bankId}`]: {
    patch: operation('Rename a question bank', { parameters: [orgId, bankId], body: ref('OrgBankInput'), response: ref('OrgBankResponse'), errors: true }),
    delete: operation('Delete a question bank', { parameters: [orgId, bankId], response: { type: 'object', properties: { id: ref('ObjectId'), deleted: { type: 'boolean' } } }, description: 'The questions filed in the bank are deleted with it; an exam that used them keeps its own ids pruned.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/question-banks/{bankId}/questions`]: {
    get: operation('List the questions in a bank', { parameters: [orgId, bankId, page, limit, { name: 'search', in: 'query', schema: { type: 'string' } }], response: ref('OrgQuestionListResponse') }),
  },
  // --- students ---
  [`${api}/v1/everybody/organizations/{organizationId}/students`]: {
    get: operation('List the organization students', { parameters: [orgId, page, limit, { name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'role', in: 'query', schema: ref('OrgRole') }], response: ref('OrgStudentListResponse'), description: 'Members of this organization, students by default, each with `attempts` (papers taken) and `average` (mean score).' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/students/{studentId}`]: {
    get: operation('Read one student', { parameters: [orgId, { name: 'studentId', in: 'path', required: true, schema: ref('ObjectId') }], response: ref('OrgStudentDetailResponse'), description: 'The student and the papers they have taken, each with its score and the minutes it took.' }),
  },
  // --- community and reported questions ---
  [`${api}/v1/everybody/organizations/{organizationId}/community/posts`]: {
    get: operation('List the announcements', { parameters: [orgId], response: ref('OrgPostListResponse') }),
    post: operation('Post an announcement', { parameters: [orgId], body: ref('OrgPostInput'), response: ref('OrgPostResponse'), created: true, errors: true }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/community/posts/{postId}`]: {
    patch: operation('Edit, pin or hide a post', { parameters: [orgId, { name: 'postId', in: 'path', required: true, schema: ref('ObjectId') }], body: ref('OrgPostInput'), response: ref('OrgPostResponse'), errors: true }),
    delete: operation('Delete a post', { parameters: [orgId, { name: 'postId', in: 'path', required: true, schema: ref('ObjectId') }], response: { type: 'object', properties: { id: ref('ObjectId'), deleted: { type: 'boolean' } } } }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/question-flags`]: {
    get: operation('List the reported questions', { parameters: [orgId], response: ref('OrgFlagQueueResponse'), description: 'Each row carries `reportCount`, how many students reported that question.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/question-flags/{flagId}`]: {
    patch: operation('Resolve, dismiss or reopen a report', { parameters: [orgId, { name: 'flagId', in: 'path', required: true, schema: ref('ObjectId') }], body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['open', 'resolved', 'dismissed'] }, resolution: { type: 'string', maxLength: 500 } } }, response: ref('OrgFlagResponse'), errors: true }),
  },
  // --- the organization library (books it gives its students) ---
  [`${api}/v1/everybody/organizations/{organizationId}/library/books`]: {
    get: operation('List the organization books', { parameters: [orgId], response: ref('OrgBookListResponse') }),
    post: operation('Add a book', { parameters: [orgId], body: ref('OrgBookInput'), response: ref('OrgBookResponse'), created: true, errors: true, description: 'A paid book (`priceMinor > 0`) needs a live payout account.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/library/books/{bookId}`]: {
    patch: operation('Update a book', { parameters: [orgId, bookId], body: ref('OrgBookUpdate'), response: ref('OrgBookResponse'), errors: true }),
    delete: operation('Delete a book', { parameters: [orgId, bookId], response: { type: 'object', properties: { id: ref('ObjectId'), deleted: { type: 'boolean' } } } }),
  },
  // --- money: payout, earnings, payments ---
  [`${api}/v1/everybody/banks`]: {
    get: operation('List the payout banks', { response: ref('BanksResponse'), description: 'The provider list when configured, otherwise the built-in Nigerian bank table, so the payout form always renders.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/payout/verify`]: {
    post: operation('Verify a payout account', { parameters: [orgId], body: ref('PayoutVerifyInput'), response: ref('PayoutVerifyResponse'), errors: true, description: 'Confirms the name on the account with the provider. `503 PAYMENT_NOT_CONFIGURED` when payments are off.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/payout`]: {
    put: operation('Save the payout account', { parameters: [orgId], body: ref('PayoutSaveInput'), response: ref('PayoutResponse'), errors: true, description: 'Stores the verified account and its provider subaccount. Turning on settlement for the organization.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/earnings`]: {
    get: operation('Read the earnings summary', { parameters: [orgId], response: ref('EarningsResponse'), description: 'Totals and a daily series, in integer kobo.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/payments`]: {
    get: operation('List the organization payments', { parameters: [orgId, page, limit], response: ref('OrgPaymentsResponse') }),
  },
  // --- domains ---
  [`${api}/v1/everybody/domains/check-subdomain`]: {
    get: operation('Check whether a subdomain is free', { parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' } }], response: ref('SubdomainCheck'), description: 'A reserved or taken name comes back unavailable rather than as an error.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/domains`]: {
    get: operation('List the organization domains', { parameters: [orgId], response: ref('OrgDomainListResponse') }),
    post: operation('Add a domain', { parameters: [orgId], body: ref('OrgDomainInput'), response: ref('OrgDomainResponse'), created: true, errors: true, description: 'A Testflow subdomain is active at once; a custom domain starts pending and carries the DNS records to add.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/domains/{domainId}/verify`]: {
    post: operation('Verify a custom domain', { parameters: [orgId, domainId], response: ref('OrgDomainResponse'), description: 'Checks the DNS records and flips the domain to active when they resolve.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/domains/{domainId}`]: {
    delete: operation('Remove a domain', { parameters: [orgId, domainId], response: { type: 'object', properties: { id: ref('ObjectId'), removed: { type: 'boolean' } } } }),
  },
  // --- billing aliases the console reads (flat, organization in the query) ---
  [`${api}/v1/everybody/plans`]: {
    get: operation('List the organization plans', { response: ref('ConsolePlansResponse'), description: 'The plans an organization can buy, in display order.' }),
  },
  [`${api}/v1/everybody/subscription`]: {
    get: operation('Read the current organization plan', { parameters: [{ name: 'organizationId', in: 'query', required: true, schema: ref('ObjectId') }], response: ref('ConsoleSubscriptionResponse'), description: '`404 NO_SUBSCRIPTION` when the organization has never subscribed.' }),
  },
  [`${api}/v1/everybody/payments`]: {
    get: operation('List the organization plan payments', { parameters: [{ name: 'organizationId', in: 'query', required: true, schema: ref('ObjectId') }], response: ref('ConsoleSubscriptionPaymentsResponse') }),
  },
  // Super admin only. These lean on the `Administration` tag via the classifier below.
  [`${api}/v1/admin/everybody`]: {
    get: operation('List every organization', { admin: true, parameters: [page, limit], response: ref('AdminOrgList'), description: 'Super admin only. Newest first, across every organization.' }),
  },
  [`${api}/v1/admin/everybody/{organizationId}`]: {
    get: operation('Get one organization', { admin: true, parameters: [orgId], response: ref('AdminOrgResponse'), description: 'Super admin only.' }),
  },
  [`${api}/v1/admin/everybody/{organizationId}/suspend`]: {
    patch: operation('Suspend an organization', { admin: true, parameters: [orgId], body: ref('OrgReasonInput'), response: ref('AdminOrgResponse'), errors: true, description: 'Super admin only. Sets the status to `suspended` and writes the reason to the audit log.' }),
  },
  [`${api}/v1/admin/everybody/{organizationId}/reinstate`]: {
    patch: operation('Reinstate an organization', { admin: true, parameters: [orgId], body: ref('OrgReasonInput'), response: ref('AdminOrgResponse'), errors: true, description: 'Super admin only. Sets the status back to `active` and records the reason.' }),
  },
  [`${api}/v1/admin/everybody/{organizationId}/plan`]: {
    patch: operation('Queue a plan price or availability edit', { admin: true, parameters: [orgId], body: ref('OrgPlanInput'), response: ref('AdminOrgPlanResponse'), errors: true, description: 'Super admin only. The edit waits on the organization as `planEditPending`; it does not change the plan definition immediately.' }),
  },
});

// ---------------------------------------------------------------------------
// Live CBT: a host-run sitting people join by link. Hosting is the paid side
// (`402 PLAN_REQUIRED` without the `live_cbt_host` entitlement); joining is
// free. Answers travel over HTTP; the stream is push-only.
// ---------------------------------------------------------------------------
const liveCode = { name: 'code', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z2-9]{6,16}$' }, description: 'The room share code.' };
const liveParticipantId = { name: 'userId', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }, description: 'The participant user id, as carried by `LiveRankingRow.userId`.' };

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/live-cbt`]: {
    post: operation('Create a live examination', { body: ref('LiveCreateInput'), response: ref('LiveRoomCreateResponse'), created: true, errors: true, description: 'Host only, and a verified account. Without the `live_cbt_host` entitlement this is `402 PLAN_REQUIRED`, "Hosting a live session needs an active plan." The room opens in the waiting state.' }),
  },
  [`${api}/live-cbt/{code}`]: {
    get: operation('Read the room and the caller membership', { parameters: [liveCode], response: ref('LiveMembershipResponse'), description: 'Any signed-in account may read a room it knows the code of; `membership` is null until the caller joins.' }),
  },
  [`${api}/live-cbt/{code}/host`]: {
    get: operation('Read the room as the host', { parameters: [liveCode], response: ref('LiveHostRoomResponse'), description: 'Host only. Every participant carries email, status, sequence number, score and rank.' }),
  },
  [`${api}/live-cbt/{code}/join`]: {
    post: operation('Ask to join the room', { parameters: [liveCode], response: ref('LiveJoinResponse'), description: 'Free for any signed-in student. The first request creates a `pending` participant (`201`); asking again returns the stored status (`200`). 409 codes: `EXAM_CLOSED`, `EXAM_STARTED`, `HOST_CANNOT_JOIN`, `EXAM_FULL`; a rejected request is `403 JOIN_REJECTED`.' }),
  },
  [`${api}/live-cbt/{code}/approve`]: {
    post: operation('Approve one participant', { parameters: [liveCode], body: ref('LiveTargetInput'), response: ref('LiveApprovalResponse'), errors: true, description: 'Host only, before the exam starts (`409 EXAM_LOCKED`). Allocates the deterministic `sequenceNumber` tie-breaker.' }),
  },
  [`${api}/live-cbt/{code}/reject`]: {
    post: operation('Reject one participant', { parameters: [liveCode], body: ref('LiveTargetInput'), response: ref('LiveApprovalResponse'), errors: true, description: 'Host only, before the exam starts.' }),
  },
  [`${api}/live-cbt/{code}/approve-all`]: {
    post: operation('Approve every waiting participant', { parameters: [liveCode], response: ref('LiveApproveAllResponse'), description: 'Host only, before the exam starts. Stops early once `maxParticipants` is reached.' }),
  },
  [`${api}/live-cbt/{code}/start`]: {
    post: operation('Start the examination', { parameters: [liveCode], response: ref('LiveExamResponse'), description: 'Host only. Samples and freezes a paper per approved participant and sets `startedAt` and `endsAt`. Idempotent while running. 409 codes: `EXAM_CLOSED`, `NO_APPROVED_PARTICIPANTS`, `NOT_ENOUGH_QUESTIONS`.' }),
  },
  [`${api}/live-cbt/{code}/end`]: {
    post: operation('End the examination', { parameters: [liveCode], response: ref('LiveExamResponse'), description: 'Host only. Seals the sitting, auto-submits anything still open, and ranks the board.' }),
  },
  [`${api}/live-cbt/{code}/publish`]: {
    post: operation('Publish the results', { parameters: [liveCode], response: ref('LiveExamResponse'), description: 'Host only, after `end`. Makes each participant score and rank visible to them.' }),
  },
  [`${api}/live-cbt/{code}/cancel`]: {
    post: operation('Cancel the examination', { parameters: [liveCode], response: ref('LiveExamResponse'), description: 'Host only. The room stops accepting participants and never runs.' }),
  },
  [`${api}/live-cbt/{code}/questions`]: {
    get: operation('Get the participant paper', { parameters: [liveCode], response: ref('LivePaperResponse'), description: 'Approved participants only, while the exam runs. Handed out once, with the caller selections, so a client can keep answering through a dropped connection. Never includes answer keys.' }),
  },
  [`${api}/live-cbt/{code}/answer`]: {
    patch: operation('Save one answer', { parameters: [liveCode], body: ref('LiveAnswerInput'), response: ref('LiveAnswerResponse'), errors: true, description: 'Approved participants only. One atomic per-question write, so concurrent autosaves never clobber each other. `selectedOption: null` clears the answer.' }),
  },
  [`${api}/live-cbt/{code}/submit`]: {
    post: operation('Submit the attempt', { parameters: [liveCode], body: ref('LiveSubmitInput'), response: ref('LiveSubmissionResponse'), errors: true, description: 'Approved participants only, and idempotent: a retry returns the stored outcome untouched. `answers` is the un-synced remainder of an offline paper; answers that arrive within two minutes of `endsAt` still count unless results are already out.' }),
  },
  [`${api}/live-cbt/{code}/result`]: {
    get: operation('Get my result', { parameters: [liveCode], response: ref('LiveResultResponse'), description: 'Participants only, after `publish`. Carries the caller scored paper, their corrections, and the public `leaderboard` of every submitted paper. `corrections` is null when the host set `allowReview: false`.' }),
  },
  [`${api}/live-cbt/{code}/participants/{userId}/result`]: {
    get: operation('Read one participant result', { parameters: [liveCode, liveParticipantId], response: ref('LiveResultResponse'), description: 'Host only, once the sitting has ended (`409 EXAM_NOT_ENDED` before that). Returns the same scored, corrected paper the participant sees, so a host can review any paper from the board. 404 `PARTICIPANT_NOT_FOUND`, 409 `NO_SUBMISSION`.' }),
  },
  [`${api}/live-cbt/{code}/dashboard`]: {
    get: operation('Read the host dashboard', { parameters: [liveCode], response: ref('LiveDashboardResponse'), description: 'Host only. Totals, the ranked board, and per-question correct rates keyed by bank question id.' }),
  },
  // CSV and SSE are not JSON, so these two are written out rather than built by `operation`.
  [`${api}/live-cbt/{code}/export.csv`]: {
    get: {
      summary: 'Download the result sheet as CSV',
      description: 'Host only, sent as a download. Columns: rank, displayName, email, score, correctCount, accuracy, timeTakenSeconds, attemptStatus.',
      security: auth,
      parameters: [liveCode],
      responses: {
        '200': { description: 'The CSV body.', content: { 'text/csv': { schema: { type: 'string' } } } },
        '401': { $ref: '#/components/responses/Unauthenticated' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  [`${api}/live-cbt/{code}/stream`]: {
    get: {
      summary: 'Follow the room as server-sent events',
      description: 'The host or a member of the room; anyone else gets `403 NOT_A_PARTICIPANT`. Opens with `connected`, then fans out the same events as the socket, with `heartbeat` every 25 seconds. Mutations still travel over REST. The primary transport is the socket at `WS /ws/live-cbt/{shareCode}?token=<access token>`, which also answers `{ "type": "ping" }`.',
      security: auth,
      parameters: [liveCode],
      responses: {
        '200': { description: 'A server-sent event stream.', content: { 'text/event-stream': { schema: ref('LiveEvent') } } },
        '401': { $ref: '#/components/responses/Unauthenticated' },
        '404': { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  // Public: a shared link resolves without a session, so joining is one tap away.
  [`${api}/public/live-cbt/{code}`]: {
    get: operation('Read the public room landing', { security: false, parameters: [liveCode], response: ref('LiveLandingResponse'), description: 'No session needed, so a shared link always resolves: title, description, host name and live counts. Never question content, answer keys, emails or internal ids. Joining still needs an account.' }),
  },
});

// ---------------------------------------------------------------------------
// Tenant site API. Opened on an organization's own address, the app states the
// address in the `X-Tenant-Host` header (or it is read from the request). The
// organization is never in the path, so a caller cannot reach a tenant it is
// not standing on. Unknown or suspended addresses are a flat `404
// TENANT_NOT_FOUND`.
// ---------------------------------------------------------------------------
const tenantHost = { name: 'X-Tenant-Host', in: 'header', required: false, schema: { type: 'string', example: 'grace.testflow.com.ng' }, description: 'The organization address. Read from the request host when absent.' };

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/v1/public/site`]: {
    get: operation('Read the tenant site', { security: false, parameters: [tenantHost, { name: 'host', in: 'query', schema: { type: 'string', description: 'The address, for calls made before the DNS record exists.' } }], response: ref('TenantSiteResponse'), description: 'The published surface only: brand, pages, portal, footer and the metadata a crawler reads. A never-published site is `404 TENANT_NOT_FOUND`.' }),
  },
  [`${api}/v1/public/site/og.png`]: {
    get: operation('Read the tenant share image', { security: false, parameters: [tenantHost], response: { type: 'string', format: 'binary' }, description: 'A 1200x630 PNG on the organization brand, rendered on the server because a crawler runs nothing.' }),
  },
  [`${api}/v1/public/site/page`]: {
    get: operation('Read the tenant share page as HTML', { security: false, parameters: [tenantHost], response: { type: 'string', description: 'HTML with the Open Graph tags in the first response' }, description: 'What a host rewrites a crawler to. An unknown address still gets a readable HTML 404 rather than a JSON error.' }),
  },
  [`${api}/v1/public/site/pages/{page}`]: {
    get: operation('Read one tenant page', { security: false, parameters: [tenantHost, { name: 'page', in: 'path', required: true, schema: { type: 'string', enum: ['exams', 'results', 'library', 'community'] } }], response: ref('TenantSiteResponse'), description: '`404 PAGE_NOT_FOUND` when the owner switched the page off.' }),
  },
  [`${api}/v1/public/exams`]: {
    get: operation('List the tenant exams', { parameters: [tenantHost], response: ref('TenantExamsResponse'), description: 'The published exams, for a signed-in student of this organization. Anyone else gets `403 NO_MEMBERSHIP`.' }),
  },
  [`${api}/v1/public/auth/me`]: {
    get: operation('Read the signed-in tenant student', { parameters: [tenantHost], response: ref('TenantUserResponse'), description: '401 when there is no session; 403 NO_MEMBERSHIP when the session belongs to a student of another organization.' }),
  },
  [`${api}/v1/public/auth/register`]: {
    post: operation('Register as a student of this organization', { security: false, parameters: [tenantHost], body: ref('TenantRegisterInput'), response: ref('TenantUserResponse'), created: true, errors: true, description: 'Creates the account and its student membership here, then signs in. An email that already has an account is `409 EMAIL_TAKEN`.' }),
  },
  [`${api}/v1/public/auth/login`]: {
    post: operation('Sign in as a student of this organization', { security: false, parameters: [tenantHost], body: ref('TenantAuthInput'), response: ref('TenantUserResponse'), errors: true, description: 'Only a student of this organization. A valid account with a membership elsewhere is refused, so an account on one site is not usable on another.' }),
  },
  [`${api}/v1/public/auth/logout`]: {
    post: operation('Sign out of the tenant site', { security: false, parameters: [tenantHost], response: { type: 'object' }, description: 'Clears the session cookies. Answers 204 with no body.' }),
  },
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
  FeedbackKind: { type: 'string', enum: ['problem', 'idea', 'other'], description: 'problem = something is broken, idea = something to build, other = neither' },
  FeedbackStatus: { type: 'string', enum: ['open', 'in_review', 'resolved'] },
  FeedbackInput: { type: 'object', required: ['message'], additionalProperties: false, properties: { kind: ref('FeedbackKind'), rating: int({ minimum: 1, maximum: 5, nullable: true, description: 'Optional on purpose: a bug report must never be gated on rating the product' }), screen: str({ maxLength: 80, nullable: true, description: 'Where in the app, free text such as "Exam timer"' }), message: str({ minLength: 10, maxLength: 1000 }) } },
  FeedbackUpdateInput: { type: 'object', additionalProperties: false, properties: { status: ref('FeedbackStatus'), reply: str({ maxLength: 500, nullable: true, description: 'Student-visible; an empty string clears it' }) } },
  Feedback: { type: 'object', properties: { id: ref('ObjectId'), kind: ref('FeedbackKind'), rating: int({ nullable: true }), screen: str({ nullable: true }), message: str(), status: ref('FeedbackStatus'), reply: str({ nullable: true }), createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }), resolvedAt: str({ format: 'date-time', nullable: true }), student: { nullable: true, type: 'object', properties: { fullName: str(), username: str({ nullable: true }), matricNumber: str({ nullable: true }) } } } },
  FeedbackResponse: { type: 'object', properties: { feedback: ref('Feedback') } },
  FeedbackListResponse: { type: 'object', properties: { feedback: { type: 'array', items: ref('Feedback') } } },
  FeedbackQueueResponse: { type: 'object', properties: { feedback: { type: 'array', items: ref('Feedback') }, counts: { type: 'object', properties: { open: int(), in_review: int(), resolved: int(), total: int(), averageRating: { type: 'number', nullable: true, description: 'Over rated notes only; null when none are rated' }, ratedCount: int() } }, page: int(), total: int() } },
  FlagReason: { type: 'string', enum: ['wrong_answer', 'typo', 'out_of_syllabus', 'duplicate', 'other'], description: 'Fixed ids, not free text, because the queue is triaged by reason. `other` is the one open-ended case, which is why it carries the note.' },
  FlagStatus: { type: 'string', enum: ['open', 'resolved', 'dismissed'], description: 'resolved and dismissed stay distinct: one means the bank was changed, the other means the question was fine' },
  FlagInput: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: ref('FlagReason'), note: str({ maxLength: 500, description: 'Required when the reason is `other`' }) } },
  FlagUpdateInput: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: ref('FlagStatus'), resolution: str({ maxLength: 500, nullable: true, description: 'What the admin decided and why, kept when a report is reopened' }) } },
  QuestionCard: { type: 'object', description: 'The one question shape the study screens and the report queue read.', properties: { id: ref('ObjectId'), subjectCode: str({ nullable: true }), stem: str(), options: { type: 'array', items: { type: 'string' } }, correctOption: int({ description: 'Index of the right answer, within the stored option order. Named `correctOption` on every API read path.' }), explanation: str({ nullable: true }), topic: str({ nullable: true }) } },
  QuestionCardPublic: { type: 'object', description: 'The same card with the answer key and the explanation removed: a question link exists so the recipient tries the question.', properties: { id: ref('ObjectId'), subjectCode: str({ nullable: true }), stem: str(), options: { type: 'array', items: { type: 'string' } }, topic: str({ nullable: true }), shareTitle: str({ nullable: true, description: 'The admin\'s own title for the link, when they wrote one' }) } },
  Flag: { type: 'object', properties: { id: ref('ObjectId'), questionId: ref('ObjectId'), reason: ref('FlagReason'), note: str(), status: ref('FlagStatus'), createdAt: str({ format: 'date-time' }), resolution: str(), reportCount: int({ description: 'How many students have reported this question' }), student: { type: 'object', description: 'The reporter as they were at report time, so a later profile edit does not rewrite what an admin was shown.', properties: { fullName: str({ nullable: true }), username: str({ nullable: true }), matricNumber: str({ nullable: true }) } }, question: ref('QuestionCard') } },
  FlagResponse: { type: 'object', properties: { flag: ref('Flag') } },
  FlagQueueResponse: { type: 'object', properties: { flags: { type: 'array', items: ref('Flag') }, counts: { type: 'object', properties: { open: int(), resolved: int(), dismissed: int(), questionCount: int({ description: 'Distinct questions ever reported' }) } } } },
  BookmarkToggleInput: { type: 'object', required: ['questionId'], additionalProperties: false, properties: { questionId: ref('ObjectId') } },
  BookmarkToggleResponse: { type: 'object', properties: { questionId: ref('ObjectId'), bookmarked: { type: 'boolean' } } },
  Bookmark: { type: 'object', properties: { id: ref('ObjectId'), questionId: ref('ObjectId'), createdAt: str({ format: 'date-time' }), question: ref('QuestionCard') } },
  BookmarkListResponse: { type: 'object', properties: { bookmarks: { type: 'array', items: ref('Bookmark') } } },
  ResultShare: { type: 'object', properties: { token: str({ description: 'Opaque and unguessable; clearing it on the attempt kills the link' }), url: str({ description: 'Absolute, on the host the request arrived on' }), imageUrl: str({ description: 'The 1200x630 card, a sibling of `url`' }) } },
  ResultShareResponse: { type: 'object', properties: { share: ref('ResultShare') } },
});
// `role` in the User schema
const userRole = window.testflowOpenApi.components.schemas.User?.properties?.role;
if (userRole?.enum && !userRole.enum.includes('advertiser')) userRole.enum.push('advertiser');

Object.entries(window.testflowOpenApi.paths).forEach(([path, methods]) => {
  if (Object.values(methods)[0]?.tags) return; // explicitly tagged (ads endpoints)
  if (/\/auth\/(memberships|switch-product|oauth\/)/.test(path)) { Object.values(methods).forEach((method) => { method.tags = ['Identity']; }); return; }
  if (path.includes('/v1/everybody') || path.includes('/v1/public/')) { Object.values(methods).forEach((method) => { method.tags = ['Everybody']; }); return; }
  if (path.includes('/live-cbt')) { Object.values(methods).forEach((method) => { method.tags = ['Live CBT']; }); return; }
  const tag = path === '/health' ? 'Health'
    : path.includes('/public/') || path.startsWith('/r/') ? 'Public'
      : path.includes('/auth/') ? 'Authentication'
        : path.includes('/subjects') ? 'Subjects'
          : path.includes('/question-bookmarks') || path.includes('/question-flags') || /\/questions\/\{id\}\/flag$/.test(path) ? 'Study'
            : path.includes('/questions') ? 'Questions'
            : path.includes('/exam-sessions') ? 'Exam sessions'
              : path.includes('/post-utme') ? 'Post-UTME'
                : path.includes('/verifications') ? 'Verifications'
                  : path.includes('/feedback') ? 'Feedback'
                    : 'Administration';
  Object.values(methods).forEach((method) => { method.tags = [tag]; });

});

// ---------------------------------------------------------------------------
// Provider-aware advertising (Google AdSense), the student pass and the Library.
//
// Advertising and billing are deliberately not under `/api/ads`: that prefix is the Testflow Ads
// marketplace, which this surface does not touch. `tagged` is the shared operation builder for
// every block below: it tags the operation explicitly and adds the responses the plain
// `operation` helper does not.
// ---------------------------------------------------------------------------
const tagged = (tag, summary, options = {}) => {
  const op = operation(summary, options);
  op.tags = [tag];
  if (options.errors) op.responses['422'] = { $ref: '#/components/responses/ValidationError' };
  if (options.notFound) op.responses['404'] = { $ref: '#/components/responses/NotFound' };
  if (options.rateLimited) op.responses['429'] = { $ref: '#/components/responses/RateLimited' };
  if (options.conflict) op.responses['409'] = { description: options.conflict, content: { 'application/json': { schema: ref('Error') } } };
  if (options.payment) op.responses['402'] = { description: options.payment, content: { 'application/json': { schema: ref('Error') } } };
  if (options.forbidden) op.responses['403'] = { description: options.forbidden, content: { 'application/json': { schema: ref('Error') } } };
  if (options.unavailable) op.responses['503'] = { description: options.unavailable, content: { 'application/json': { schema: ref('Error') } } };
  if (options.admin) op.responses['403'] = { $ref: '#/components/responses/Forbidden' };
  return op;
};

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/advertising/config`]: {
    get: tagged('Advertising', 'Provider switches, ad units, placements and configuration issues', { security: false, response: ref('AdvertisingConfig'), description: 'The frontend reads this before rendering anything. A provider that is asked for but not usable (missing publisher id) is reported and treated as disabled. Publisher ids and ad-unit slots are public identifiers, not credentials.' }),
  },
  [`${api}/advertising/placements`]: {
    get: tagged('Advertising', 'List the approved placement registry', { security: false, response: { type: 'object', properties: { placements: { type: 'array', items: ref('Placement') } } } }),
  },
  [`${api}/advertising/placements/{id}`]: {
    get: tagged('Advertising', 'Get one placement', { security: false, parameters: [{ name: 'id', in: 'path', required: true, schema: ref('PlacementId') }], response: { type: 'object', properties: { placement: ref('Placement') } }, notFound: true }),
  },
  [`${api}/advertising/eligibility`]: {
    get: tagged('Advertising', 'Decide which providers may serve on a placement, for this caller', { security: false, errors: true, parameters: [{ name: 'placement', in: 'query', required: true, schema: ref('PlacementId') }, { name: 'consent', in: 'query', schema: { type: 'string', enum: ['granted', 'denied', 'unknown'], default: 'unknown' }, description: 'An assertion, not proof. `denied` is always honoured; `granted` only satisfies GOOGLE_ADSENSE_REQUIRE_CONSENT.' }], response: ref('Eligibility'), description: 'Optional session: a guest gets the anonymous policy, a signed-in student gets theirs. `eligible` means the provider is permitted, never that Google returned a creative.' }),
  },
  [`${api}/advertising/admin/health`]: {
    get: tagged('Advertising', 'Advertising configuration health and aggregated counts', { admin: true, response: ref('AdvertisingHealth'), description: 'Aggregated counts only, never per-student data. Reporting status is reported honestly, with no fabricated revenue.' }),
  },
  [`${api}/advertising/admin/reporting`]: {
    get: tagged('Advertising', 'Google AdSense reporting integration status', { admin: true, response: { type: 'object', properties: { reporting: ref('ReportingStatus') } } }),
  },

  [`${api}/billing/ad-free/products`]: {
    get: tagged('Billing', 'List the student plans that remove advertising', { security: false, response: { type: 'object', properties: { products: { type: 'array', items: ref('StudentPlan') } } }, description: 'Prices come from the server catalogue. Checkout takes a plan key and never a price. Every current pass removes ads, unlocks hosting a live CBT session and opens the Library, which is what `entitlements` reports.' }),
  },
  [`${api}/billing/entitlement`]: {
    get: tagged('Billing', 'Get what the signed-in student holds', { response: { type: 'object', properties: { entitlement: ref('StudentEntitlement') } }, description: 'Includes `liveCbtHost` and `library`, the gates the frontend reads before offering the host button and the reader, and `adFree`, which tells it to hide the ad slots.' }),
  },
  [`${api}/billing/ad-free/checkout`]: {
    post: tagged('Billing', 'Start a pass purchase', { body: ref('PlanCheckoutInput'), response: ref('PurchaseResponse'), created: true, errors: true, notFound: true, rateLimited: true, unavailable: 'PAYMENT_NOT_CONFIGURED: no payment provider is configured', description: 'Server-priced. A repeated `idempotencyKey` returns the original purchase with 200 instead of charging again. Rate limited per account.' }),
  },
  [`${api}/billing/ad-free/status`]: {
    get: tagged('Billing', 'Get the entitlement, and optionally re-verify one purchase', { errors: true, notFound: true, parameters: [{ name: 'reference', in: 'query', schema: { type: 'string' } }], response: { type: 'object', properties: { entitlement: ref('StudentEntitlement'), purchase: { ...ref('Purchase'), nullable: true } } }, description: 'With a reference, an unpaid purchase is re-verified with the provider, which is how the client learns the outcome when the webhook is not reachable.' }),
  },
  [`${api}/billing/ad-free/cancel`]: {
    post: tagged('Billing', 'Abandon your own pending purchase', { body: { type: 'object', required: ['reference'], additionalProperties: false, properties: { reference: str({ minLength: 6, maxLength: 120 }) } }, response: ref('PurchaseResponse'), notFound: true, description: 'Only a pending purchase. A paid one is a refund, which is an administrator action.' }),
  },
  [`${api}/billing/ad-free/refund`]: {
    post: tagged('Billing', 'Refund a purchase and revoke what it granted', { admin: true, body: { type: 'object', required: ['reference'], additionalProperties: false, properties: { reference: str({ minLength: 6, maxLength: 120 }), reason: str({ maxLength: 200 }) } }, response: ref('PurchaseResponse'), notFound: true, unavailable: 'PAYMENT_NOT_CONFIGURED', description: 'Refunds with the provider first, then revokes exactly the entitlement that purchase granted.' }),
  },
  [`${api}/billing/ad-free/entitlements/{userId}/grant`]: {
    post: tagged('Billing', 'Grant an entitlement by hand (support)', { admin: true, parameters: [{ name: 'userId', in: 'path', required: true, schema: ref('ObjectId') }], body: { type: 'object', required: ['key'], additionalProperties: false, properties: { key: ref('EntitlementKey'), durationDays: int({ minimum: 1, maximum: 3650, description: 'Omitted means the grant does not expire' }) } }, response: { type: 'object', properties: { entitlement: { type: 'object' } } }, created: true, notFound: true }),
  },
  [`${api}/billing/ad-free/entitlements/{userId}/revoke`]: {
    post: tagged('Billing', 'Revoke an entitlement by hand (support)', { admin: true, parameters: [{ name: 'userId', in: 'path', required: true, schema: ref('ObjectId') }], body: { type: 'object', required: ['key'], additionalProperties: false, properties: { key: ref('EntitlementKey'), reason: str({ maxLength: 200 }) } }, response: { type: 'object', properties: { entitlement: { type: 'object' } } }, notFound: true, description: 'Keeps the row (the history) and clears liveness. Used for refunds, chargebacks and support corrections.' }),
  },
  [`${api}/billing/ad-free/webhook`]: {
    post: tagged('Billing', 'Payment provider webhook (Paystack)', { security: false, response: { type: 'object', properties: { applied: { type: 'boolean' }, duplicate: { type: 'boolean' }, ignored: { type: 'boolean' }, refunded: { type: 'boolean' }, reference: str() } }, unavailable: 'PAYMENT_NOT_CONFIGURED', description: 'Authenticated by the HMAC over the raw body (`x-paystack-signature`), not by a session. A reference for another dispatcher is acknowledged and ignored. The transaction is re-verified with the provider before anything is granted; a redelivery is a no-op.' }),
  },
});

// ---------------------------------------------------------------------------
// Library: the shelf, the reader, bookmarks, reading progress and the download.
//
// Browsing, bookmarking and progress are free. Reading a page and downloading a file are part of
// the Student Pass and answer `402 PLAN_REQUIRED` without a live `library` entitlement; an
// administrator is exempt because they manage the shelf. No response here carries a file URL or a
// storage key, so a link cannot be harvested from a list response.
// ---------------------------------------------------------------------------
const bookIdParam = { name: 'id', in: 'path', required: true, schema: ref('ObjectId'), description: 'The book id.' };
const bookShelfQuery = [
  { name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 }, description: 'Case-insensitive match across course code, title, subtitle, author and topics.' },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Echoed clamped to 1..pageCount.' },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 12 } },
  { name: 'filter', in: 'query', schema: { type: 'string', enum: ['all', 'bookmarks'], default: 'all' }, description: 'An unknown value is treated as `all`, never refused.' },
  { name: 'level', in: 'query', schema: { type: 'integer', enum: [100, 200, 300, 400, 500] } },
  { name: 'semester', in: 'query', schema: { type: 'string', enum: ['first', 'second'] } },
];
const bookPageQuery = { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Clamped to 1..totalPages rather than refused.' };
const PASS_REQUIRED = 'PLAN_REQUIRED: reading and downloading Library books needs a live `library` entitlement (a Student Pass).';

Object.assign(window.testflowOpenApi.paths, {
  [`${api}/library/books`]: {
    get: tagged('Library', 'Browse the shelf, paged and searchable', { parameters: bookShelfQuery, response: ref('BookListResponse'), description: 'Metadata only. `bookmarked` is per caller and always present, and `pageCount` is at least 1 even when there are no results.' }),
  },
  [`${api}/library/reading`]: {
    get: tagged('Library', 'List every book the caller has opened', { response: ref('ReadingResponse'), description: 'Newest activity first. This is what "Continue reading" reads: every book, each with its own page, so a student resumes them independently. An empty list is a normal answer.' }),
  },
  [`${api}/library/books/{id}`]: {
    get: tagged('Library', 'Get one book', { parameters: [bookIdParam], response: ref('BookResponse'), notFound: true }),
  },
  [`${api}/library/books/{id}/pages`]: {
    get: tagged('Library', 'Read one page', { parameters: [bookIdParam, bookPageQuery], response: ref('BookPagesResponse'), payment: PASS_REQUIRED, notFound: true, description: 'One page at a time, so the client never pulls a whole book. An out-of-range page is clamped, and a page that is not published yet answers with no blocks, which is not the same as a missing book.' }),
  },
  [`${api}/library/books/{id}/bookmark`]: {
    post: tagged('Library', 'Toggle a book bookmark', { parameters: [bookIdParam], response: ref('BookBookmarkResponse'), notFound: true, description: 'A toggle, not a desired state: the answer carries the new state, so the button never has to know whether it was saving or unsaving. Free.' }),
  },
  [`${api}/library/books/{id}/progress`]: {
    put: tagged('Library', 'Save where the caller stopped', { parameters: [bookIdParam], body: ref('BookProgressInput'), response: ref('BookProgressResponse'), errors: true, notFound: true, description: 'Upserts the caller row, clamps the page to the book and computes the percentage from the page count. A client-supplied `percent` is accepted and ignored. Free.' }),
  },
  [`${api}/library/books/{id}/download`]: {
    get: tagged('Library', 'Mint a short-lived download URL', { parameters: [bookIdParam], response: ref('BookDownloadResponse'), payment: PASS_REQUIRED, notFound: true, forbidden: 'DOWNLOAD_NOT_AVAILABLE: the book has no published file yet', rateLimited: true, unavailable: 'STORAGE_NOT_CONFIGURED: file storage is not configured', description: 'Signed and short-lived, so a forwarded link dies with the pass. A repeated request reuses a still-valid URL rather than minting a new signature every tap. The storage key is never returned.' }),
  },
});

Object.assign(window.testflowOpenApi.components.schemas, {
  PlacementId: { type: 'string', enum: ['content_feed', 'desktop_sidebar', 'post_activity', 'exam_session', 'live_cbt', 'payment_checkout', 'auth'], description: 'An unregistered placement does not exist: it is a 404, never a best guess.' },
  Placement: { type: 'object', properties: { id: ref('PlacementId'), label: str(), providers: { type: 'array', items: str({ enum: ['testflow', 'google_adsense'] }) }, devices: { type: 'array', items: str({ enum: ['mobile', 'tablet', 'desktop'] }) }, contexts: { type: 'array', items: str() }, sensitive: { type: 'boolean', description: 'Exams, live rooms, checkout and auth. Set true, this can never be enabled by configuration' }, registered: { type: 'boolean' }, enabled: { type: 'boolean' } } },
  AdProviderConfig: { type: 'object', properties: { id: str(), label: str(), kind: str({ enum: ['internal', 'external'] }), enabled: { type: 'boolean' }, configured: { type: 'boolean', description: 'False when the provider is asked for but cannot actually serve' }, requested: { type: 'boolean' }, publisherId: str({ nullable: true, description: 'Public page-level identifier, not a credential' }), adUnits: { type: 'object', additionalProperties: str(), description: 'placement → slot id' }, requireConsent: { type: 'boolean' }, reporting: ref('ReportingStatus') } },
  AdvertisingConfig: { type: 'object', properties: { version: int(), providers: { type: 'object', properties: { testflow: ref('AdProviderConfig'), google_adsense: ref('AdProviderConfig') } }, placements: { type: 'array', items: ref('Placement') }, issues: { type: 'array', items: { type: 'object', properties: { level: str({ enum: ['warn', 'error'] }), provider: str(), code: str(), message: str() } } } } },
  EligibilityProvider: { type: 'object', properties: { eligible: { type: 'boolean', description: 'Permitted, not guaranteed to fill' }, reason: str({ enum: ['ELIGIBLE', 'PLACEMENT_RESTRICTED', 'PLACEMENT_PROVIDER_UNSUPPORTED', 'AD_FREE_ENTITLEMENT', 'CONSENT_WITHHELD', 'CONSENT_REQUIRED', 'PROVIDER_DISABLED', 'AUTH_REQUIRED'] }) } },
  Eligibility: { type: 'object', properties: { placement: ref('PlacementId'), service: { type: 'array', items: str(), description: 'The contexts this placement is approved for' }, placementKnown: { type: 'boolean' }, placementEnabled: { type: 'boolean' }, authenticated: { type: 'boolean' }, consent: str({ enum: ['granted', 'denied', 'unknown'] }), adFree: { type: 'boolean', description: 'A verified paid entitlement, never a client claim' }, entitlementStatus: str({ enum: ['free', 'active', 'expired'] }), providers: { type: 'object', properties: { testflow: ref('EligibilityProvider'), google_adsense: ref('EligibilityProvider') } }, adsEnabled: { type: 'boolean' }, reason: { nullable: true, type: 'string', description: 'Why nothing may serve, when nothing may serve' }, configVersion: int(), checkedAt: str({ format: 'date-time' }) } },
  StudentPlan: { type: 'object', properties: { key: str({ enum: ['pass_30d', 'pass_90d'] }), name: str(), description: str(), priceMinor: int({ description: 'Minor units (kobo)' }), currency: str({ example: 'NGN' }), durationDays: int(), removesAds: { type: 'boolean' }, entitlements: { type: 'object', properties: { adFree: { type: 'boolean' }, liveCbtHost: { type: 'boolean' }, library: { type: 'boolean', description: 'Reading and downloading Library books' } } } } },
  EntitlementKey: { type: 'string', enum: ['ad_free', 'live_cbt_host', 'library'], description: 'ad_free suppresses both advertising providers. live_cbt_host only unlocks hosting a live CBT session, and suppresses nothing. library only unlocks reading and downloading Library books. Each is independent of the others.' },
  StudentEntitlement: { type: 'object', properties: { userId: ref('ObjectId'), status: str({ enum: ['free', 'active', 'expired'] }), planKey: str({ nullable: true }), entitlements: { type: 'object', properties: { ad_free: { type: 'boolean' }, live_cbt_host: { type: 'boolean' }, library: { type: 'boolean' } } }, adFree: { type: 'boolean' }, liveCbtHost: { type: 'boolean' }, library: { type: 'boolean', description: 'The Library gate the frontend reads before offering the reader; admins are exempt' }, activeKeys: { type: 'array', items: ref('EntitlementKey') }, expiresAt: str({ format: 'date-time', nullable: true, description: 'Null means it does not expire' }), lastPaidAt: str({ format: 'date-time', nullable: true }), verifiedAt: str({ format: 'date-time' }) } },
  PlanCheckoutInput: { type: 'object', required: ['planKey'], additionalProperties: false, properties: { planKey: str({ enum: ['pass_30d', 'pass_90d'] }), idempotencyKey: str({ minLength: 8, maxLength: 120 }) } },
  Purchase: { type: 'object', properties: { id: ref('ObjectId'), reference: str(), planKey: str(), planName: str({ nullable: true }), amountKobo: int(), currency: str(), status: str({ enum: ['initialized', 'paid', 'failed', 'abandoned', 'refunded'] }), provider: str({ enum: ['paystack', 'none'] }), authorizationUrl: str({ format: 'uri', nullable: true, description: 'Only while the purchase is initialized' }), paidAt: str({ format: 'date-time', nullable: true }), verifiedAt: str({ format: 'date-time', nullable: true }), refundedAt: str({ format: 'date-time', nullable: true }), createdAt: str({ format: 'date-time' }) } },
  PurchaseResponse: { type: 'object', properties: { purchase: ref('Purchase') } },
  ReportingStatus: { type: 'object', properties: { provider: str({ example: 'adsense_management_api' }), enabled: { type: 'boolean' }, configured: { type: 'boolean' }, status: str({ enum: ['disabled', 'not_configured', 'ok', 'error'] }), scope: str(), lastSyncAt: str({ format: 'date-time', nullable: true }), lastError: str({ nullable: true }), note: str({ description: 'Publisher metrics come from Google, never from frontend render events.' }) } },
  AdvertisingHealth: { type: 'object', properties: { providers: { type: 'object', properties: { testflow: { type: 'object', properties: { enabled: { type: 'boolean' } } }, google_adsense: { type: 'object', properties: { enabled: { type: 'boolean' }, requested: { type: 'boolean' }, configured: { type: 'boolean' }, requireConsent: { type: 'boolean' } } } } }, placements: { type: 'object', properties: { registered: int(), enabled: int(), enabledIds: { type: 'array', items: ref('PlacementId') } } }, entitlements: { type: 'object', properties: { adFree: int(), liveCbtHost: int() } }, purchases: { type: 'object', properties: { paid: int(), pending: int() } }, reporting: ref('ReportingStatus'), issues: { type: 'array', items: { type: 'object' } }, checkedAt: str({ format: 'date-time' }) } },
});

// ---------------------------------------------------------------------------
// Everybody: organizations, members, invitations, org subscriptions, the site
// builder and the super-admin console. Resolves the refs the paths above use.
// ---------------------------------------------------------------------------
Object.assign(window.testflowOpenApi.components.schemas, {
  OrgRole: { type: 'string', enum: ['owner', 'admin', 'examiner', 'student'], description: 'Descending authority. Only owner and admin manage members, the site and billing.' },
  OrgStatus: { type: 'string', enum: ['active', 'suspended', 'closed'], description: 'A suspended or closed organization can no longer be edited.' },
  OrgCreateInput: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: str({ minLength: 2, maxLength: 120 }), slug: str({ minLength: 3, maxLength: 30, description: 'Subdomain: lowercase letters, digits and single hyphens. Reserved words (www, api, admin, ads, everybody, ...) and consecutive hyphens are refused. Derived from the name when omitted.' }), contactEmail: str({ format: 'email', maxLength: 254 }), timezone: str({ maxLength: 64, example: 'Africa/Lagos' }) } },
  OrgUpdateInput: { type: 'object', additionalProperties: false, description: 'At least one field. The slug is immutable.', properties: { name: str({ minLength: 2, maxLength: 120 }), contactEmail: str({ format: 'email' }), timezone: str({ maxLength: 64 }) } },
  OrgSummary: { type: 'object', description: 'An organization, plus the caller role when the response carries one.', properties: { id: ref('ObjectId'), name: str(), slug: str(), status: ref('OrgStatus'), contactEmail: str({ nullable: true }), timezone: str({ nullable: true }), createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }), myRole: ref('OrgRole') } },
  OrgView: { type: 'object', properties: { organization: ref('OrgSummary'), myRole: ref('OrgRole') } },
  OrgsList: { type: 'object', properties: { items: { type: 'array', items: ref('OrgSummary') }, page: int(), limit: int(), total: int() } },
  MemberUser: { type: 'object', description: 'The member account, populated as {_id, fullName, email}.', properties: { _id: ref('ObjectId'), fullName: str(), email: str({ format: 'email' }) } },
  Member: { type: 'object', properties: { id: ref('ObjectId'), user: ref('MemberUser'), role: ref('OrgRole'), status: str({ enum: ['active', 'suspended', 'removed'] }), studentRef: str({ nullable: true }), joinedAt: str({ format: 'date-time', nullable: true }) } },
  MemberView: { type: 'object', properties: { member: ref('Member') } },
  MembersList: { type: 'object', properties: { items: { type: 'array', items: ref('Member') }, page: int(), limit: int(), total: int() } },
  MemberUpdateInput: { type: 'object', additionalProperties: false, description: 'At least one of role and status.', properties: { role: str({ enum: ['admin', 'examiner', 'student'] }), status: str({ enum: ['active', 'suspended', 'removed'] }) } },
  OrgInviteInput: { type: 'object', required: ['email', 'role'], additionalProperties: false, properties: { email: str({ format: 'email', maxLength: 254 }), role: str({ enum: ['admin', 'examiner', 'student'], description: 'A second owner cannot be invited.' }) } },
  Invitation: { type: 'object', properties: { id: ref('ObjectId'), email: str({ format: 'email' }), role: str({ enum: ['admin', 'examiner', 'student'] }), expiresAt: str({ format: 'date-time' }) } },
  InviteResponse: { type: 'object', properties: { invitation: ref('Invitation'), token: str({ description: 'The raw invitation token, returned once. Send it to /v1/everybody/invitations/accept.' }) } },
  AcceptInviteInput: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: str({ minLength: 1, maxLength: 256 }) } },
  AcceptInviteResponse: { type: 'object', properties: { member: ref('Member'), organizationId: ref('ObjectId') } },
  OrgEntitlements: { type: 'object', description: 'What an active organization plan turns on. null means no limit.', properties: { adsEnabled: { type: 'boolean' }, maxStudents: { type: 'integer', nullable: true }, maxActiveExams: { type: 'integer', nullable: true }, maxExamsPerMonth: { type: 'integer', nullable: true }, customDomain: { type: 'boolean' }, storageMb: { type: 'integer', nullable: true }, communityEnabled: { type: 'boolean' } } },
  OrgSubscription: { type: 'object', properties: { id: ref('ObjectId'), organizationId: ref('ObjectId'), planKey: str({ enum: ['pro', 'studio'] }), status: str({ enum: ['pending', 'active', 'past_due', 'expired', 'cancelled'] }), planSnapshot: { type: 'object', nullable: true, properties: { priceMinor: int(), currency: str(), entitlements: ref('OrgEntitlements') } }, currentPeriodStart: str({ format: 'date-time', nullable: true }), currentPeriodEnd: str({ format: 'date-time', nullable: true }), cancelAtPeriodEnd: { type: 'boolean', description: 'Keep the plan until the period ends, then stop.' }, pendingPlanKey: str({ enum: ['pro', 'studio'], nullable: true }), provider: str({ enum: ['paystack', 'none'], nullable: true }), reference: str({ description: 'The string handed to the payment provider; give it back to verify.' }), createdAt: str({ format: 'date-time', nullable: true }), myRole: ref('OrgRole') } },
  SubscriptionResponse: { type: 'object', properties: { subscription: ref('OrgSubscription'), myRole: ref('OrgRole') } },
  SubsList: { type: 'object', properties: { subscriptions: { type: 'array', items: ref('OrgSubscription') } } },
  SubscriptionCreateInput: { type: 'object', required: ['planKey'], additionalProperties: false, properties: { planKey: str({ enum: ['pro', 'studio'] }) } },
  SubscriptionUpdateInput: { type: 'object', additionalProperties: false, properties: { cancelAtPeriodEnd: { type: 'boolean' }, planKey: str({ enum: ['pro', 'studio'], description: 'Move to another plan; the subscription returns to pending until it is paid.' }) } },
  CheckoutResponse: { type: 'object', properties: { paymentId: str({ description: 'In v1, the provider reference.' }), reference: str(), amountKobo: int(), currency: str({ example: 'NGN' }), authorizationUrl: str({ format: 'uri', description: 'Where to send the payer next.' }) } },
  SubscriptionVerification: { type: 'object', properties: { subscription: ref('OrgSubscription'), entitlements: ref('OrgEntitlements') } },
  SiteTemplateList: { type: 'object', properties: { templates: { type: 'array', items: str({ enum: ['classic', 'modern', 'minimal'] }) } } },
  SiteContent: { type: 'object', description: 'The editable part of a site config. Every field is optional on a PATCH; only what is sent is changed.', properties: { brand: { type: 'object', properties: { name: str({ maxLength: 120 }), logoAssetId: ref('ObjectId'), faviconAssetId: ref('ObjectId'), primaryColor: str({ example: '#0f172a', description: 'Hex, 3 or 6 digits' }), accentColor: str({ example: '#63a9ff' }) } }, seo: { type: 'object', properties: { title: str({ maxLength: 70 }), description: str({ maxLength: 160 }) } }, nav: { type: 'array', maxItems: 8, items: { type: 'object', required: ['label', 'href'], properties: { label: str({ maxLength: 50 }), href: str({ maxLength: 2048 }) } } }, sections: { type: 'array', maxItems: 12, items: { type: 'object', description: 'A template-defined block.' } } } },
  SiteDraftInput: { allOf: [ref('SiteContent')], description: 'The draft PATCH body. Same shape as SiteContent: every field is optional, unknown keys are refused.' },
  SiteConfig: { type: 'object', description: 'Stored as a lean document, so the id is `_id`.', properties: { _id: ref('ObjectId'), organization: ref('ObjectId'), templateKey: str({ enum: ['classic', 'modern', 'minimal'] }), draft: ref('SiteContent'), published: { allOf: [ref('SiteContent')], description: 'Absent until the site is published once.' }, publishedVersion: int(), draftVersion: int(), createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }) } },
  SiteResponse: { type: 'object', properties: { site: ref('SiteConfig') } },
  SitePreviewResponse: { type: 'object', properties: { preview: ref('SiteSurface'), version: int(), expiresIn: int({ example: 300 }) } },
  SiteAssetInput: { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: str({ enum: ['logo', 'favicon', 'hero', 'image'] }) } },
  SiteAssetResponse: { type: 'object', properties: { asset: { type: 'object', properties: { id: ref('ObjectId'), kind: str(), url: str({ description: 'A placeholder until the upload pipeline lands.' }) } } } },
  OrgReasonInput: { type: 'object', additionalProperties: false, properties: { reason: str({ maxLength: 500 }) } },
  OrgPlanInput: { type: 'object', required: ['key'], additionalProperties: false, properties: { key: str({ enum: ['pro', 'studio'] }), priceMinor: int({ minimum: 0, description: 'Minor units (kobo)' }), available: { type: 'boolean' } } },
  PlanDefinition: { type: 'object', properties: { key: str({ enum: ['pro', 'studio'] }), name: str(), priceMinor: int(), currency: str({ example: 'NGN' }), interval: str({ enum: ['month', 'year'] }), available: { type: 'boolean' }, entitlements: ref('OrgEntitlements'), sortOrder: int() } },
  AdminOrg: { type: 'object', description: 'A lean organization row in the super-admin console.', properties: { _id: ref('ObjectId'), name: str(), slug: str(), status: ref('OrgStatus'), contactEmail: str({ nullable: true }), timezone: str({ nullable: true }), createdAt: str({ format: 'date-time' }) } },
  AdminOrgList: { type: 'object', properties: { orgs: { type: 'array', items: ref('AdminOrg') }, page: int(), limit: int(), total: int() } },
  AdminOrgResponse: { type: 'object', properties: { org: ref('AdminOrg') } },
  AdminOrgPlanResponse: { type: 'object', description: 'The edit is queued on the organization as `planEditPending`; it is not applied to the plan definition immediately.', properties: { org: ref('AdminOrg'), planDef: ref('PlanDefinition') } },
});

// ---------------------------------------------------------------------------
// Live CBT. The room, the participant paper, the result and the event stream.
// ---------------------------------------------------------------------------
Object.assign(window.testflowOpenApi.components.schemas, {
  LiveStatus: { type: 'string', enum: ['draft', 'waiting', 'ready', 'in_progress', 'completed', 'results_published', 'cancelled'] },
  LiveAttemptStatus: { type: 'string', enum: ['waiting', 'in_progress', 'submitted', 'timed_out'] },
  LiveParticipantStatus: { type: 'string', enum: ['pending', 'approved', 'rejected', 'removed'] },
  LiveCounts: { type: 'object', properties: { participantCount: int({ description: 'Pending plus approved.' }), pendingCount: int(), approvedCount: int() } },
  LiveCreateInput: { type: 'object', required: ['title', 'numQuestions', 'durationMinutes'], additionalProperties: false, description: 'At least one of `subject` and `questionIds`. `questionIds` wins when both are sent.', properties: { title: str({ minLength: 3, maxLength: 200 }), description: str({ maxLength: 2000 }), subject: str({ maxLength: 24, description: 'A subject id or a course code' }), questionIds: { type: 'array', minItems: 1, maxItems: 200, items: ref('ObjectId') }, numQuestions: int({ minimum: 1, maximum: 200 }), durationMinutes: int({ minimum: 1, maximum: 240 }), maxParticipants: int({ minimum: 1, maximum: 30 }), difficulty: str({ enum: ['mixed', 'easy', 'medium', 'hard'], default: 'mixed' }), shuffleQuestions: { type: 'boolean', default: true }, shuffleOptions: { type: 'boolean', default: true }, negativeMarking: { type: 'number', minimum: 0, maximum: 5, default: 0 }, marksPerQuestion: { type: 'number', minimum: 0.5, maximum: 100, default: 1 }, allowReview: { type: 'boolean', default: true, description: 'Whether participants see corrections once the results are published.' } } },
  LiveRoom: { type: 'object', description: 'The room as its members see it. Never question content, answer keys, emails or internal ids.', properties: { id: ref('ObjectId'), shareCode: str(), shareUrl: str({ description: 'The link a student opens to find the room.' }), title: str(), description: str(), status: ref('LiveStatus'), durationMinutes: int(), maxParticipants: { type: 'integer', nullable: true }, numQuestions: int(), difficulty: str(), negativeMarking: { type: 'number' }, marksPerQuestion: { type: 'number' }, allowReview: { type: 'boolean' }, startedAt: str({ format: 'date-time', nullable: true }), endsAt: str({ format: 'date-time', nullable: true }), serverTime: str({ format: 'date-time', description: 'Authoritative clock. Count down from startedAt and endsAt, never from the client clock.' }), hostName: str({ nullable: true, description: 'Set on the public landing and the room read.' }), participantCount: int(), pendingCount: int(), approvedCount: int() } },
  LiveMembership: { type: 'object', nullable: true, description: 'The caller own participant row, or null before joining.', properties: { status: ref('LiveParticipantStatus'), attemptStatus: ref('LiveAttemptStatus'), sequenceNumber: { type: 'integer', nullable: true } } },
  LiveRoomWithHost: { allOf: [ref('LiveRoom'), { type: 'object', properties: { hostId: ref('ObjectId') } }] },
  LiveRoomMembership: { allOf: [ref('LiveRoom'), { type: 'object', properties: { membership: ref('LiveMembership') } }] },
  LiveParticipantRow: { type: 'object', properties: { userId: ref('ObjectId'), displayName: str(), email: str({ format: 'email', nullable: true }), status: ref('LiveParticipantStatus'), sequenceNumber: { type: 'integer', nullable: true, description: 'The deterministic tie-breaker, allocated at approval.' }, attemptStatus: ref('LiveAttemptStatus'), submittedAt: str({ format: 'date-time', nullable: true }), score: { type: 'number', nullable: true }, rank: { type: 'integer', nullable: true } } },
  LiveHostRoom: { allOf: [ref('LiveRoom'), { type: 'object', properties: { participants: { type: 'array', items: ref('LiveParticipantRow') } } }] },
  LiveRoomCreateResponse: { type: 'object', properties: { exam: ref('LiveRoomWithHost') } },
  LiveMembershipResponse: { type: 'object', properties: { room: ref('LiveRoomMembership') } },
  LiveHostRoomResponse: { type: 'object', properties: { room: ref('LiveHostRoom') } },
  LiveExamResponse: { type: 'object', properties: { exam: ref('LiveRoom') } },
  LiveLandingResponse: { type: 'object', properties: { exam: ref('LiveRoom') } },
  LiveJoinResponse: { type: 'object', properties: { status: ref('LiveParticipantStatus'), duplicate: { type: 'boolean', description: 'True when the request had already been made; the stored status is returned.' }, counts: ref('LiveCounts') } },
  LiveTargetInput: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: ref('ObjectId') } },
  LiveApprovalResponse: { type: 'object', properties: { status: ref('LiveParticipantStatus'), sequenceNumber: { type: 'integer', nullable: true }, counts: ref('LiveCounts') } },
  LiveApproveAllResponse: { type: 'object', properties: { approved: int({ description: 'How many were approved in this call.' }), counts: ref('LiveCounts') } },
  LivePaperQuestion: { type: 'object', properties: { index: int(), stem: str(), options: { type: 'array', items: str() }, selectedOption: { type: 'integer', nullable: true } } },
  LivePaper: { type: 'object', description: 'One participant paper, in its own served order. No answer keys.', properties: { shareCode: str(), title: str(), status: ref('LiveStatus'), durationMinutes: int(), startedAt: str({ format: 'date-time' }), endsAt: str({ format: 'date-time' }), serverTime: str({ format: 'date-time' }), remainingSeconds: int(), totalQuestions: int(), attemptStatus: ref('LiveAttemptStatus'), questions: { type: 'array', items: ref('LivePaperQuestion') } } },
  LivePaperResponse: { type: 'object', properties: { exam: ref('LivePaper') } },
  LiveAnswerInput: { type: 'object', required: ['questionIndex', 'selectedOption'], additionalProperties: false, properties: { questionIndex: int({ minimum: 0, maximum: 199 }), selectedOption: { type: 'integer', minimum: 0, maximum: 5, nullable: true, description: 'Null clears the answer.' } } },
  LiveAnswerAck: { type: 'object', properties: { questionIndex: int(), selectedOption: { type: 'integer', nullable: true }, serverTime: str({ format: 'date-time' }) } },
  LiveAnswerResponse: { type: 'object', properties: { answer: ref('LiveAnswerAck') } },
  LiveSubmitInput: { type: 'object', additionalProperties: false, description: 'The whole body is optional. `answers` is the part of the paper the client never managed to autosave.', properties: { answers: { type: 'array', maxItems: 200, items: { type: 'object', required: ['questionIndex', 'selectedOption'], properties: { questionIndex: int({ minimum: 0, maximum: 199 }), selectedOption: { type: 'integer', minimum: 0, maximum: 5, nullable: true } } } } } },
  LiveSubmission: { type: 'object', description: 'Score, correctCount and rank stay null until the host publishes the results.', properties: { attemptStatus: ref('LiveAttemptStatus'), score: { type: 'number', nullable: true }, correctCount: { type: 'integer', nullable: true }, rank: { type: 'integer', nullable: true }, submittedAt: str({ format: 'date-time' }), resultsReleased: { type: 'boolean' }, answersAccepted: int(), answersRejected: { type: 'boolean', description: 'True when a late batch arrived after the sitting was sealed.' } } },
  LiveSubmissionResponse: { type: 'object', properties: { result: ref('LiveSubmission') } },
  LiveCorrection: { type: 'object', properties: { index: int(), stem: str(), options: { type: 'array', items: str() }, selectedOption: { type: 'integer', nullable: true }, correctOption: int(), isCorrect: { type: 'boolean' }, explanation: { type: 'string', nullable: true }, marksAwarded: { type: 'number', description: 'The marks per question when correct, minus the negative marking when wrong, 0 when unanswered.' } } },
  LiveResult: { type: 'object', properties: { shareCode: str(), title: str(), displayName: str({ description: 'Set on the host participant view; absent on the caller own result.' }), rank: { type: 'integer', nullable: true }, score: { type: 'number' }, totalPossible: { type: 'number', nullable: true }, correctCount: int(), incorrectCount: int(), unansweredCount: int(), accuracy: { type: 'number', nullable: true, description: 'A percentage, 2 decimal places.' }, timeTakenSeconds: { type: 'integer', nullable: true }, durationMinutes: int(), attemptStatus: ref('LiveAttemptStatus'), submittedAt: str({ format: 'date-time' }), corrections: { type: 'array', nullable: true, items: ref('LiveCorrection'), description: 'Null when the host set allowReview to false.' }, leaderboard: { type: 'array', description: 'Every submitted paper, ranked. `isYou` marks the caller on their own result, and the participant on the host participant view.', items: ref('LiveLeaderboardRow') } } },
  LiveResultResponse: { type: 'object', properties: { result: ref('LiveResult') } },
  LiveLeaderboardRow: { type: 'object', description: 'One public standings row. No email, no answer data.', properties: { userId: ref('ObjectId'), displayName: str(), rank: { type: 'integer', nullable: true }, score: { type: 'number', nullable: true }, correctCount: { type: 'integer', nullable: true }, accuracy: { type: 'number', nullable: true, description: 'A percentage, 2 decimal places.' }, timeTakenSeconds: { type: 'integer', nullable: true }, attemptStatus: ref('LiveAttemptStatus'), isYou: { type: 'boolean', description: 'True for the caller. Always false on the host dashboard board.' } } },
  LiveRankingRow: { type: 'object', properties: { userId: ref('ObjectId'), displayName: str(), email: str({ format: 'email', nullable: true }), attemptStatus: ref('LiveAttemptStatus'), score: { type: 'number', nullable: true }, correctCount: { type: 'integer', nullable: true }, accuracy: { type: 'number', nullable: true }, timeTakenSeconds: { type: 'integer', nullable: true }, rank: { type: 'integer', nullable: true }, sequenceNumber: { type: 'integer', nullable: true } } },
  LiveQuestionStat: { type: 'object', properties: { questionId: ref('ObjectId'), stem: str(), attempts: int(), correct: int(), correctRate: { type: 'number', description: 'A percentage, 2 decimal places.' } } },
  LiveDashboard: { allOf: [ref('LiveRoom'), { type: 'object', properties: { totals: { type: 'object', properties: { approved: int(), started: int(), submitted: int(), timedOut: int(), noShow: int() } }, rankings: { type: 'array', items: ref('LiveRankingRow') }, questionStats: { type: 'array', items: ref('LiveQuestionStat') } } }] },
  LiveDashboardResponse: { type: 'object', properties: { dashboard: ref('LiveDashboard') } },
  LiveEvent: { type: 'object', description: 'One room event, over the socket or the SSE stream. Every payload carries the event name and an authoritative serverTime.', properties: { event: str({ enum: ['connected', 'heartbeat', 'pong', 'participant.joined', 'participant.approved', 'participant.rejected', 'participant.submitted', 'room.updated', 'exam.started', 'exam.timed_out', 'exam.ended', 'results.published', 'exam.cancelled'] }), serverTime: str({ format: 'date-time' }), shareCode: str(), status: ref('LiveStatus'), startedAt: str({ format: 'date-time' }), endsAt: str({ format: 'date-time' }), counts: ref('LiveCounts'), userId: ref('ObjectId'), approved: int(), autoSubmitted: int() } },
});

// ---------------------------------------------------------------------------
// Library schemas. The book shape is the one every response reuses; `bookmarked` is per caller.
// ---------------------------------------------------------------------------
Object.assign(window.testflowOpenApi.components.schemas, {
  BookColor: { type: 'string', enum: ['red', 'blue', 'ink', 'green', 'amber', 'violet', 'teal'], description: 'Cover colour. A value the client does not know falls back to `ink`.' },
  Book: {
    type: 'object',
    description: 'One shelf entry. Metadata only: never a file URL and never the storage key.',
    properties: {
      id: ref('ObjectId'),
      code: str({ example: 'MTH101', description: 'The course code.' }),
      title: str(),
      subtitle: str(),
      description: str({ description: 'Two or three sentences, shown in the book dialog.' }),
      color: ref('BookColor'),
      level: int({ enum: [100, 200, 300, 400, 500] }),
      semester: str({ enum: ['first', 'second'] }),
      pages: int(),
      sizeKb: int({ description: 'Derived from the stored size in bytes.' }),
      edition: str({ example: '2nd edition' }),
      author: str(),
      year: { type: 'integer', nullable: true },
      topics: { type: 'array', items: str() },
      bookmarked: { type: 'boolean', description: 'Per caller, and always present.' },
      updatedAt: str({ format: 'date-time' }),
    },
  },
  BookResponse: { type: 'object', properties: { book: ref('Book') } },
  BookListResponse: { type: 'object', properties: { books: { type: 'array', items: ref('Book') }, page: int({ description: 'Clamped to 1..pageCount.' }), pageCount: int({ description: 'At least 1, even when the result is empty.' }), total: int() } },
  BookPageBlock: { type: 'object', properties: { type: str({ enum: ['heading', 'paragraph'], description: 'A discriminated union the reader switches on; an unknown type is ignored, not an error.' }), text: str() } },
  BookPagesResponse: { type: 'object', description: 'One page of readable content. No answer keys apply here: it is prose, not a question.', properties: { bookId: ref('ObjectId'), page: int({ description: 'Clamped to 1..totalPages.' }), totalPages: int(), blocks: { type: 'array', items: ref('BookPageBlock'), description: 'Empty when the page is not published yet. The reader says so rather than showing a missing-book error.' } } },
  BookProgressInput: { type: 'object', required: ['page'], additionalProperties: false, properties: { page: int({ minimum: 1 }), percent: int({ description: 'Accepted and deliberately ignored: the server computes it from the book page count, never from the client.' }) } },
  BookProgress: { type: 'object', properties: { bookId: ref('ObjectId'), page: int(), percent: int({ description: 'round(page / book.pages * 100); 100 when finished.' }), updatedAt: str({ format: 'date-time' }) } },
  BookProgressResponse: { type: 'object', properties: { progress: ref('BookProgress') } },
  BookBookmarkResponse: { type: 'object', properties: { id: ref('ObjectId'), bookmarked: { type: 'boolean', description: 'The new state. The button does not need to know whether it was saving or unsaving.' } } },
  ReadingEntry: { type: 'object', properties: { bookId: ref('ObjectId'), page: int(), percent: int(), updatedAt: str({ format: 'date-time' }), book: ref('Book') } },
  ReadingResponse: { type: 'object', properties: { reading: { type: 'array', items: ref('ReadingEntry'), description: 'Every book this student has opened, newest activity first. An empty array is a normal answer.' } } },
  BookDownloadResponse: { type: 'object', properties: { url: str({ format: 'uri', description: 'Short-lived signed URL with Content-Disposition set. The storage key itself is never returned.' }), fileName: str({ example: 'MTH101 - Elementary Mathematics I.pdf' }), sizeBytes: int(), expiresAt: str({ format: 'date-time' }) } },
});

// ---------------------------------------------------------------------------
// The organization console (exams, questions, students, its own library, money,
// domains, the site document) and the tenant site API. Money is integer kobo
// throughout; lists are `{ items, page, limit, total }` unless noted.
// ---------------------------------------------------------------------------
Object.assign(window.testflowOpenApi.components.schemas, {
  // --- the flat site document the console edits ---
  SiteBrand: { type: 'object', properties: { name: str({ nullable: true, maxLength: 120 }), tagline: str({ nullable: true, maxLength: 160 }), logoUrl: str({ nullable: true }), logoAssetId: ref('ObjectId'), faviconUrl: str({ nullable: true }), faviconAssetId: ref('ObjectId'), primaryColor: str({ example: '#163a5f' }), accentColor: str({ example: '#f5c542' }), font: str({ example: 'inter' }) } },
  SiteBlock: { type: 'object', description: 'A template-defined block. It carries its own id and type; the editor writes the fields the block needs.', properties: { id: str(), type: str(), heading: str(), text: str(), imageUrl: str(), ctaLabel: str(), ctaHref: str() } },
  SiteSurface: { type: 'object', description: 'The editable surface. `landing` is the public page, `portal` the signed-in one; each has its own block list.', properties: { template: str({ enum: ['classic', 'modern', 'minimal'] }), brand: ref('SiteBrand'), landing: { type: 'object', properties: { sections: { type: 'array', items: ref('SiteBlock') } } }, portal: { type: 'object', properties: { welcome: { type: 'object', properties: { heading: str(), text: str(), imageUrl: str() } }, sections: { type: 'array', items: ref('SiteBlock') } } }, footer: { type: 'object', properties: { text: str(), links: { type: 'array', items: { type: 'object', properties: { label: str(), href: str() } } } } }, pages: { type: 'object', additionalProperties: { type: 'boolean' }, description: 'Which pages the owner left switched on.' } } },
  SiteView: { allOf: [ref('SiteSurface')], description: 'The console document: the draft surface plus the published copy and the publish state.', properties: { version: int(), publishedAt: str({ format: 'date-time', nullable: true }), hasUnpublished: { type: 'boolean' }, published: { allOf: [ref('SiteSurface')], nullable: true, description: 'What the public sees. Null until the first publish.' } } },
  SitePatchInput: { allOf: [ref('SiteSurface')], description: 'Every field optional. `brand` and `pages` merge field by field; the block lists are replaced.' },
  SiteAssetResponse: { type: 'object', properties: { asset: { type: 'object', properties: { id: ref('ObjectId'), kind: str({ enum: ['logo', 'favicon', 'hero', 'image'] }), url: str({ format: 'uri' }), width: int({ nullable: true }), height: int({ nullable: true }), bytes: int(), contentType: str() } } } },

  // --- exams ---
  OrgExam: { type: 'object', properties: { id: ref('ObjectId'), title: str(), instructions: str(), mode: str({ enum: ['anytime', 'live'] }), startsAt: str({ format: 'date-time', nullable: true, description: 'Only meaningful in live mode: when everyone starts together.' }), durationMinutes: int(), questionCount: int({ description: 'Derived from questionIds.' }), questionIds: { type: 'array', items: ref('ObjectId') }, access: str({ enum: ['link', 'invited', 'code'] }), accessCode: str(), showCorrections: str({ enum: ['now', 'after_exam', 'score_only', 'hidden'] }), attemptsAllowed: int(), shuffleQuestions: { type: 'boolean' }, shuffleOptions: { type: 'boolean' }, marksPerQuestion: { type: 'number' }, negativeMarking: { type: 'number' }, priceMinor: int({ description: 'Integer kobo. 0 is a free exam.' }), currency: str({ example: 'NGN' }), status: str({ enum: ['draft', 'published', 'archived'] }), createdAt: str({ format: 'date-time', nullable: true }), updatedAt: str({ format: 'date-time', nullable: true }) } },
  OrgExamInput: { type: 'object', required: ['title', 'durationMinutes'], properties: { title: str({ minLength: 1, maxLength: 200 }), instructions: str({ maxLength: 5000 }), mode: str({ enum: ['anytime', 'live'] }), startsAt: str({ maxLength: 40, nullable: true }), questionIds: { type: 'array', maxItems: 2000, items: ref('ObjectId') }, durationMinutes: int({ minimum: 1, maximum: 600 }), access: str({ enum: ['link', 'invited', 'code'] }), accessCode: str({ maxLength: 20 }), showCorrections: str({ enum: ['now', 'after_exam', 'score_only', 'hidden'] }), attemptsAllowed: int({ minimum: 1, maximum: 50 }), shuffleQuestions: { type: 'boolean' }, shuffleOptions: { type: 'boolean' }, marksPerQuestion: { type: 'number', minimum: 0, maximum: 100 }, negativeMarking: { type: 'number', minimum: 0, maximum: 100 }, priceMinor: int({ minimum: 0 }), currency: str({ minLength: 3, maxLength: 3 }) } },
  OrgExamUpdate: { allOf: [ref('OrgExamInput')], description: 'All fields optional.' },
  OrgExamResponse: { type: 'object', properties: { exam: ref('OrgExam') } },
  OrgExamListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgExam') }, page: int(), limit: int(), total: int() } },
  OrgExamResultRow: { type: 'object', properties: { id: ref('ObjectId'), studentName: str(), email: str({ format: 'email' }), scorePercent: { type: 'number' }, correct: int(), total: int(), timeMinutes: int(), submittedAt: str({ format: 'date-time' }) } },
  OrgExamResultsResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgExamResultRow') }, summary: { type: 'object', properties: { attempts: int(), average: { type: 'number' }, highest: { type: 'number' }, lowest: { type: 'number' } } } } },

  // --- questions ---
  OrgQuestion: { type: 'object', properties: { id: ref('ObjectId'), bankId: ref('ObjectId'), stem: str(), stemImageUrl: str({ nullable: true }), options: { type: 'array', items: str() }, optionImages: { type: 'array', items: str({ nullable: true }) }, correctIndex: int(), topic: str({ nullable: true }), difficulty: str({ enum: ['easy', 'medium', 'hard'] }), explanation: str({ nullable: true }), explanationImageUrl: str({ nullable: true }), createdAt: str({ format: 'date-time' }) } },
  OrgQuestionInput: { type: 'object', required: ['stem', 'options', 'correctIndex'], additionalProperties: false, properties: { stem: str({ minLength: 1, maxLength: 4000 }), stemImageUrl: str({ nullable: true, maxLength: 2048 }), options: { type: 'array', minItems: 2, maxItems: 6, items: str({ maxLength: 1000 }) }, optionImages: { type: 'array', maxItems: 6, items: str({ nullable: true, maxLength: 2048 }) }, correctIndex: int({ minimum: 0, maximum: 5 }), topic: str({ maxLength: 120 }), difficulty: str({ enum: ['easy', 'medium', 'hard'] }), explanation: str({ maxLength: 4000 }), explanationImageUrl: str({ nullable: true, maxLength: 2048 }), examId: ref('ObjectId'), bankId: ref('ObjectId') } },
  OrgQuestionUpdate: { allOf: [ref('OrgQuestionInput')], description: 'All fields optional.' },
  OrgQuestionResponse: { type: 'object', properties: { question: ref('OrgQuestion') } },
  OrgQuestionListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgQuestion') }, page: int(), limit: int(), pages: int(), total: int() } },
  OrgQuestionBulkResult: { type: 'object', properties: { imported: int(), failed: { type: 'array', items: { type: 'object', properties: { row: int({ description: '1-based line number.' }), problems: { type: 'array', items: str() } } } } } },

  // --- students ---
  OrgStudent: { type: 'object', properties: { id: ref('ObjectId'), userId: ref('ObjectId'), fullName: str(), email: str({ format: 'email' }), role: ref('OrgRole'), status: str({ enum: ['active', 'invited'] }), attempts: int(), joinedAt: str({ format: 'date-time', nullable: true }) } },
  OrgStudentListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgStudent') }, page: int(), limit: int(), total: int() } },
  OrgStudentDetailResponse: { type: 'object', properties: { student: ref('OrgStudent'), attempts: { type: 'array', items: ref('OrgExamResultRow') } } },

  // --- question banks ---
  OrgBank: { type: 'object', properties: { id: ref('ObjectId'), name: str(), description: str(), questionCount: int(), createdAt: str({ format: 'date-time', nullable: true }) } },
  OrgBankInput: { type: 'object', properties: { name: str({ minLength: 2, maxLength: 80 }), description: str({ maxLength: 200 }) } },
  OrgBankResponse: { type: 'object', properties: { bank: ref('OrgBank') } },
  OrgBankListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgBank') }, total: int() } },

  // --- community and reported questions ---
  OrgPost: { type: 'object', properties: { id: ref('ObjectId'), type: str({ enum: ['announcement', 'discussion'] }), text: str(), pinned: { type: 'boolean' }, hidden: { type: 'boolean' }, time: str({ description: 'A short human date, because the card reads `time`.' }), createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }) } },
  OrgPostInput: { type: 'object', properties: { type: str({ enum: ['announcement', 'discussion'] }), text: str({ minLength: 1, maxLength: 5000 }), pinned: { type: 'boolean' }, hidden: { type: 'boolean' } } },
  OrgPostResponse: { type: 'object', properties: { post: ref('OrgPost') } },
  OrgPostListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgPost') }, total: int() } },
  OrgFlag: { type: 'object', properties: { id: ref('ObjectId'), status: str({ enum: ['open', 'resolved', 'dismissed'] }), reason: str({ enum: ['wrong_answer', 'unclear', 'typo', 'other'] }), note: str(), resolution: str(), examTitle: str(), reportCount: int({ description: 'How many students reported this question.' }), studentName: str({ nullable: true }), question: ref('OrgQuestion'), createdAt: str({ format: 'date-time' }), resolvedAt: str({ format: 'date-time', nullable: true }) } },
  OrgFlagQueueResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgFlag') }, counts: { type: 'object', properties: { open: int(), resolved: int(), dismissed: int() } } } },
  OrgFlagResponse: { type: 'object', properties: { flag: ref('OrgFlag') } },

  // --- the organization's own library ---
  OrgBook: { type: 'object', properties: { id: ref('ObjectId'), title: str(), code: str(), description: str(), color: ref('BookColor'), priceMinor: int({ description: 'Integer kobo. 0 means the book is included.' }), currency: str({ example: 'NGN' }), visibility: str({ enum: ['all_students', 'group', 'paid'] }), previewPages: int(), pages: int(), fileName: str(), published: { type: 'boolean' }, createdAt: str({ format: 'date-time', nullable: true }) } },
  OrgBookInput: { type: 'object', required: ['title'], properties: { title: str({ minLength: 1, maxLength: 200 }), code: str({ maxLength: 20 }), description: str({ maxLength: 2000 }), color: ref('BookColor'), priceMinor: int({ minimum: 0 }), currency: str({ minLength: 3, maxLength: 3 }), visibility: str({ enum: ['all_students', 'group', 'paid'] }), previewPages: int({ minimum: 0 }), pages: int({ minimum: 0 }), fileName: str({ maxLength: 300 }), published: { type: 'boolean' } } },
  OrgBookUpdate: { allOf: [ref('OrgBookInput')], description: 'All fields optional.' },
  OrgBookResponse: { type: 'object', properties: { book: ref('OrgBook') } },
  OrgBookListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgBook') }, total: int() } },

  // --- money ---
  Bank: { type: 'object', properties: { name: str(), code: str(), slug: str({ nullable: true }) } },
  BanksResponse: { type: 'object', properties: { banks: { type: 'array', items: ref('Bank') } } },
  PayoutVerifyInput: { type: 'object', required: ['bankCode', 'accountNumber'], additionalProperties: false, properties: { bankCode: str(), accountNumber: str({ minLength: 10, maxLength: 10 }) } },
  PayoutSaveInput: { type: 'object', required: ['bankCode', 'accountNumber', 'accountName', 'businessName'], additionalProperties: false, properties: { bankCode: str(), accountNumber: str({ minLength: 10, maxLength: 10 }), accountName: str({ maxLength: 120 }), businessName: str({ maxLength: 120 }) } },
  Payout: { type: 'object', properties: { bankCode: str({ nullable: true }), accountNumber: str({ nullable: true }), accountName: str({ nullable: true }), businessName: str({ nullable: true }), status: str({ enum: ['none', 'verified', 'active'] }), subaccountCode: str({ nullable: true }), platformPercent: int() } },
  PayoutResponse: { type: 'object', properties: { payout: ref('Payout') } },
  PayoutVerifyResponse: { type: 'object', properties: { accountName: str(), bankCode: str(), accountNumber: str() } },
  EarningsResponse: { type: 'object', properties: { earnings: { type: 'object', properties: { totals: { type: 'object', properties: { grossKobo: int(), orgShareKobo: int(), platformFeeKobo: int(), last30d: int() } }, series: { type: 'array', items: { type: 'object', properties: { date: str({ example: '2026-01-31' }), grossKobo: int() } } } } } } },
  OrgPayment: { type: 'object', properties: { id: ref('ObjectId'), item: str({ description: 'What was bought: exam, book or pass.' }), itemType: str({ enum: ['exam', 'book', 'pass'] }), reference: str(), currency: str(), grossKobo: int(), platformFeeKobo: int(), orgShareKobo: int(), paystackFeeKobo: int(), status: str({ enum: ['pending', 'paid', 'failed', 'refunded'] }), paidAt: str({ format: 'date-time', nullable: true }) } },
  OrgPaymentsResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgPayment') }, page: int(), limit: int(), total: int() } },

  // --- domains ---
  OrgDomain: { type: 'object', properties: { id: ref('ObjectId'), type: str({ enum: ['subdomain', 'custom'] }), hostname: str(), status: str({ enum: ['pending', 'active', 'failed'] }), isPrimary: { type: 'boolean' }, records: { type: 'array', description: 'Empty once the domain is active; otherwise the DNS records to add.', items: { type: 'object', properties: { type: str({ example: 'CNAME' }), host: str(), value: str() } } }, verifiedAt: str({ format: 'date-time', nullable: true }), expiresAt: str({ format: 'date-time', nullable: true }) } },
  OrgDomainInput: { type: 'object', required: ['type', 'hostname'], additionalProperties: false, properties: { type: str({ enum: ['subdomain', 'custom'] }), hostname: str({ maxLength: 253 }) } },
  OrgDomainResponse: { type: 'object', properties: { domain: ref('OrgDomain') } },
  OrgDomainListResponse: { type: 'object', properties: { items: { type: 'array', items: ref('OrgDomain') }, total: int() } },
  SubdomainCheck: { type: 'object', properties: { available: { type: 'boolean' }, hostname: str({ nullable: true }), reason: str({ nullable: true }) } },

  // --- billing aliases the console reads ---
  ConsolePlan: { type: 'object', properties: { key: str(), name: str(), priceMinor: int(), currency: str(), interval: str({ enum: ['month', 'year'] }), available: { type: 'boolean' }, adsEnabled: { type: 'boolean' }, entitlements: ref('OrgEntitlements') } },
  ConsolePlansResponse: { type: 'object', properties: { plans: { type: 'array', items: ref('ConsolePlan') } } },
  ConsoleSubscription: { type: 'object', properties: { id: str(), planKey: str(), planName: str(), status: str({ enum: ['pending', 'active', 'past_due', 'expired', 'cancelled'] }), priceMinor: int(), currency: str(), interval: str(), currentPeriodStart: str({ format: 'date-time', nullable: true }), currentPeriodEnd: str({ format: 'date-time', nullable: true }), cancelAtPeriodEnd: { type: 'boolean' }, pendingPlanKey: str({ nullable: true }), pendingPlanName: str({ nullable: true }), adsEnabled: { type: 'boolean' }, graceEndsAt: str({ format: 'date-time', nullable: true }), reference: str({ nullable: true }), provider: str({ nullable: true }) } },
  ConsoleSubscriptionResponse: { type: 'object', properties: { subscription: ref('ConsoleSubscription') } },
  ConsoleSubscriptionPayment: { type: 'object', properties: { id: str(), reference: str(), planName: str(), kind: str(), amountKobo: int(), currency: str(), status: str(), paidAt: str({ format: 'date-time', nullable: true }), receiptUrl: str({ nullable: true }) } },
  ConsoleSubscriptionPaymentsResponse: { type: 'object', properties: { items: { type: 'array', items: ref('ConsoleSubscriptionPayment') }, total: int() } },

  // --- the tenant site API ---
  TenantSiteResponse: { type: 'object', properties: { organization: { type: 'object', properties: { id: ref('ObjectId'), name: str(), slug: str() } }, site: ref('SiteSurface'), meta: { type: 'object', properties: { title: str(), description: str(), ogImageUrl: str({ format: 'uri' }), themeColor: str(), faviconUrl: str({ nullable: true }), canonicalUrl: str({ format: 'uri' }) } } } },
  TenantUserResponse: { type: 'object', properties: { user: ref('User') } },
  TenantAuthInput: { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: { email: str({ format: 'email' }), password: str({ minLength: 8 }) } },
  TenantRegisterInput: { type: 'object', required: ['fullName', 'email', 'password'], additionalProperties: false, properties: { fullName: str({ minLength: 2, maxLength: 120 }), email: str({ format: 'email' }), password: str({ minLength: 8 }) } },
  TenantExam: { type: 'object', properties: { id: ref('ObjectId'), title: str(), questionCount: int(), durationMinutes: int(), priceMinor: int() } },
  TenantExamsResponse: { type: 'object', properties: { items: { type: 'array', items: ref('TenantExam') } } },
  TenantAttempt: { type: 'object', properties: { id: ref('ObjectId'), examTitle: str(), totalQuestions: int(), endsAt: str({ format: 'date-time' }), questions: { type: 'array', items: { type: 'object' } } } },
  TenantResult: { type: 'object', properties: { id: ref('ObjectId'), examTitle: str(), scorePercent: int({ nullable: true, description: 'Absent when the exam hides its score' }), correct: int({ nullable: true }), total: int({ nullable: true }), hidden: { type: 'boolean' }, corrections: { type: 'array', nullable: true }, submittedAt: str({ format: 'date-time' }) } },
});

// ---------------------------------------------------------------------------
// Taking an exam on the tenant site, paid checkout, question import, plan
// changes and the Hall of Fame board.
// ---------------------------------------------------------------------------
Object.assign(window.testflowOpenApi.paths, {
  // --- the tenant sitting flow ---
  [`${api}/v1/public/exams/{examId}`]: {
    get: operation('Read one tenant exam', { parameters: [tenantHost, examId], response: { type: 'object', properties: { exam: ref('TenantExam') } }, description: 'The exam a student is about to sit. The answer key is never in this payload.' }),
  },
  [`${api}/v1/public/exams/{examId}/start`]: {
    post: operation('Start a sitting', { parameters: [tenantHost, examId], response: { type: 'object', properties: { attempt: ref('TenantAttempt') } }, created: true, errors: true, description: 'The server writes `endsAt` now (for a live exam it is the same for everyone) and snapshots the questions, so a later bank edit cannot move this score. A paid exam without a verified payment is `402 PAYMENT_REQUIRED`; a live exam needs the organizer on Studio.' }),
  },
  [`${api}/v1/public/attempts/{attemptId}/answers`]: {
    patch: operation('Save an answer', { parameters: [tenantHost, { name: 'attemptId', in: 'path', required: true, schema: ref('ObjectId') }], body: { type: 'object', required: ['questionId', 'selectedIndex'], properties: { questionId: ref('ObjectId'), selectedIndex: { type: 'integer', minimum: 0 } } }, response: { type: 'object' }, errors: true, description: 'Checked against the server clock; a past `endsAt` refuses the write.' }),
  },
  [`${api}/v1/public/attempts/{attemptId}/submit`]: {
    post: operation('Submit a sitting', { parameters: [tenantHost, { name: 'attemptId', in: 'path', required: true, schema: ref('ObjectId') }], response: { type: 'object', properties: { result: ref('TenantResult') } }, errors: true, description: "Marked exactly once. What comes back is decided by the exam's `showCorrections`: `hidden` returns no score, not even here." }),
  },
  [`${api}/v1/public/results`]: {
    get: operation('List my results', { parameters: [tenantHost, page, limit], response: { type: 'object', properties: { items: { type: 'array', items: ref('TenantResult') } } } }),
  },
  [`${api}/v1/public/results/{attemptId}`]: {
    get: operation('Read one of my results', { parameters: [tenantHost, { name: 'attemptId', in: 'path', required: true, schema: ref('ObjectId') }], response: ref('TenantResult'), description: 'Corrections only when the exam\'s `showCorrections` allows it right now; `hidden` returns no score either.' }),
  },
  [`${api}/v1/public/announcements`]: {
    get: operation('List the announcements', { parameters: [tenantHost, page, limit], response: { type: 'object' } }),
  },
  [`${api}/v1/public/exams/{examId}/flags`]: {
    post: operation('Report a question', { parameters: [tenantHost, examId], body: { type: 'object', required: ['questionId'], properties: { questionId: ref('ObjectId'), reason: { type: 'string', maxLength: 500 } } }, response: { type: 'object' }, created: true, errors: true, description: 'Reporting the same question twice from one student is one report.' }),
  },
  [`${api}/v1/public/exams/{examId}/checkout`]: {
    post: operation('Buy a paid exam', { parameters: [tenantHost, examId, { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 100 } }], response: { type: 'object' }, created: true, errors: true, description: "Server-priced. The organizer is paid at source through their Paystack subaccount and the platform takes its percentage there. `402 PLAN_REQUIRED` when the organizer's plan does not include paid exams." }),
  },
  [`${api}/v1/public/payments/verify`]: {
    get: operation('Verify an exam payment', { parameters: [tenantHost, { name: 'reference', in: 'query', required: true, schema: { type: 'string' } }], response: { type: 'object' }, errors: true, description: 'Re-checks with the provider, checks the amount and currency, and reports whether the exam is now unlocked. Idempotent.' }),
  },
  [`${api}/v1/public/payments/webhook`]: {
    post: operation('Payment provider webhook (tenant)', { security: false, parameters: [{ name: 'x-paystack-signature', in: 'header', required: true, schema: { type: 'string' } }], response: { type: 'object' }, description: 'Called by the provider only. The HMAC-SHA512 over the raw body is verified, and the amount and currency must match the payment before the sitting is unlocked. Idempotent — duplicate deliveries are no-ops.' }),
  },

  // --- console: results CSV, attempt detail, import, plan changes ---
  [`${api}/v1/everybody/organizations/{organizationId}/exams/{examId}/results.csv`]: {
    get: operation('Download the results as CSV', { parameters: [orgId, examId], response: { type: 'string', format: 'binary' }, description: 'Streamed. A cell that starts `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe so a spreadsheet never runs it.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/attempts/{attemptId}`]: {
    get: operation('Read one attempt', { parameters: [orgId, { name: 'attemptId', in: 'path', required: true, schema: ref('ObjectId') }], response: { type: 'object' }, description: "Owner, admin or examiner. Scoped to the organization, so another tenant's attempt is a flat `404`." }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/questions/import`]: {
    post: operation('Import questions from CSV or ZIP', { parameters: [orgId, { name: 'examId', in: 'query', schema: ref('ObjectId') }, { name: 'bankId', in: 'query', schema: ref('ObjectId') }, { name: 'dryRun', in: 'query', schema: { type: 'boolean' } }], response: ref('OrgQuestionBulkResult'), errors: true, description: 'One multipart field `file`: a `questions.csv`, or a ZIP of `questions.csv` plus its images. Strict caps, parsed in memory: flat, one copy of each name, no Zip64, no encryption, no symlinks, no traversal, no bombs. `?dryRun=true` validates without writing; each bad row is reported, the rest are saved.' }),
  },
  [`${api}/v1/everybody/organizations/{organizationId}/questions/import/template`]: {
    get: operation('Download the import CSV template', { parameters: [orgId], response: { type: 'string', format: 'binary' } }),
  },
  [`${api}/v1/everybody/subscriptions/{id}/upgrade`]: {
    post: operation('Upgrade or schedule a downgrade', { parameters: [{ name: 'id', in: 'path', required: true, schema: ref('ObjectId') }, { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 100 } }], body: { type: 'object', required: ['planKey'], properties: { planKey: { type: 'string', enum: ['free', 'pro', 'studio'] } } }, response: { type: 'object' }, errors: true, description: 'An upgrade charges the prorated difference and returns a checkout; a downgrade charges nothing and returns `200 {}` scheduled for the period end.' }),
  },
  [`${api}/v1/everybody/subscriptions/{id}/renew`]: {
    post: operation('Renew early', { parameters: [{ name: 'id', in: 'path', required: true, schema: ref('ObjectId') }], response: { type: 'object' }, errors: true, description: 'Returns the same checkout shape as an upgrade; the paid days stack on the current period.' }),
  },
  [`${api}/v1/everybody/payments/verify`]: {
    get: operation('Verify a plan payment', { parameters: [{ name: 'reference', in: 'query', required: true, schema: { type: 'string' } }], response: { type: 'object' }, errors: true, description: 'Activates the plan only after the provider confirms it; re-verifying is an idempotent no-op. The response carries `duplicate`.' }),
  },

  // --- Hall of Fame ---
  [`${api}/leaderboard`]: {
    get: operation('Read the Hall of Fame overall board', { parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }, { name: 'level', in: 'query', schema: ref('Level') }, { name: 'period', in: 'query', schema: { type: 'string', enum: ['all', 'month', 'week'], default: 'all' } }], response: { type: 'object', properties: { leaderboard: { type: 'array', items: { type: 'object' } }, me: { type: 'object', nullable: true, description: "The caller's own rank, even when off the visible board" } } }, description: "Points are the sum of each student's best score per subject. The board shows usernames only, and opting out or leaving the username unset keeps a student off it. Cached a few minutes." }),
  },
});
