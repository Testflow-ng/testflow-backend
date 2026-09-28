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
    description: `# TestFlow API Reference\n\nAPI for TestFlow's OAU CBT practice platform.\n\n## Authentication\nSign in with **POST /api/auth/login**. The server sets secure, HTTP-only cookies; Swagger routes requests through this documentation site's Vercel proxy so authenticated requests stay first-party.\n\n## Roles\n- **Student**: authenticated account\n- **Admin**: content, users, settings, and verification operations\n- **Super admin**: administrator roster management`,
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
      post: operation('Create a student account', { security: false, body: { $ref: '#/components/schemas/RegisterInput' }, example: { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'Study2026', confirmPassword: 'Study2026' }, created: true, response: { $ref: '#/components/schemas/AuthResponse' }, errors: true }),
    },
    [`${api}/auth/login`]: {
      post: operation('Sign in and set authentication cookies', { security: false, body: { $ref: '#/components/schemas/LoginInput' }, example: { email: 'ada@example.com', password: 'Study2026' }, response: { $ref: '#/components/schemas/AuthResponse' }, errors: true }),
    },
    [`${api}/auth/logout`]: { post: operation('Sign out and clear session cookies', { response: { $ref: '#/components/schemas/Message' } }) },
    [`${api}/auth/refresh`]: { post: operation('Refresh an expired access session', { security: false, response: { $ref: '#/components/schemas/AuthResponse' } }) },
    [`${api}/auth/me`]: { get: operation('Get current account', { response: { $ref: '#/components/schemas/UserResponse' } }) },
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
    [`${api}/verifications/auth`]: { get: operation('Get signed ImageKit upload parameters', { description: 'Returns short-lived upload parameters and a public ImageKit key. Never expose the private key.', response: { type: 'object' } }) },
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
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      Message: { type: 'object', properties: { message: { type: 'string', example: 'Operation completed.' } } },
      EmailInput: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', maxLength: 254 } } },
      TokenInput: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 256 } } },
      LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', maxLength: 72 } } },
      RegisterInput: { type: 'object', required: ['fullName', 'email', 'password', 'confirmPassword'], properties: { fullName: { type: 'string', minLength: 2, maxLength: 120 }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 }, confirmPassword: { type: 'string', format: 'password' } } },
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

Object.entries(window.testflowOpenApi.paths).forEach(([path, methods]) => {
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
