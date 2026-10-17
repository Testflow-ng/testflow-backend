import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const kind = z.enum(['problem', 'idea', 'other']);
const status = z.enum(['open', 'in_review', 'resolved']);

/**
 * A submitted note.
 *
 * `null` is a real value for `rating` and `screen` (the client sends them explicitly when the
 * student skipped them), so both accept null as well as being absent. `.strict()` means a
 * `student` or `status` key in the body is a validation error rather than something the service
 * has to remember to ignore.
 */
export const createFeedbackSchema = z.object({
  body: z
    .object({
      kind: kind.optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      screen: z.string().trim().max(80).nullable().optional(),
      message: z.string().trim().min(10, 'Tell us a little more, at least 10 characters.').max(1000),
    })
    .strict(),
});

export const listFeedbackSchema = z.object({
  query: z
    .object({
      status: status.optional(),
      kind: kind.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .catchall(z.any()),
});

/**
 * The admin's two decisions. Both parts are optional so a status change and a reply are
 * independent: an entry can be resolved with nothing to say, and a reply can be edited
 * afterwards without moving the status.
 */
export const updateFeedbackSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: status.optional(),
      reply: z.string().trim().max(500).nullable().optional(),
    })
    .strict(),
});
