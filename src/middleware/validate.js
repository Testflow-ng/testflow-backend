/**
 * Validate request parts against a zod schema shaped as
 * `z.object({ body?, query?, params? })`. On success, replaces the request
 * parts with the parsed (coerced + stripped) data — unknown keys are dropped,
 * which also neutralizes NoSQL operator-injection payloads.
 */
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });

  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input.',
        details: result.error, // Return the raw error for more detail
      },
    });
  }

  if (result.data.body) req.body = result.data.body;
  if (result.data.query) req.query = result.data.query;
  if (result.data.params) req.params = result.data.params;
  return next();
};
