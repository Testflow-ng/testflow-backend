import { z } from 'zod';
import { FLAG_REASONS, FLAG_STATUSES } from '../models/QuestionFlag.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * Reporting a broken question.
 *
 * `note` defaults to an empty string rather than staying absent, because "the typo is in option
 * B" is a note and "the answer is wrong" is not: the service, not the schema, is the place that
 * decides the reason which cannot stand on its own. `.strict()` means a stray `student` or
 * `status` key is refused rather than quietly ignored.
 */
export const reportQuestionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      reason: z.enum([...FLAG_REASONS]),
      note: z.string().trim().max(500).optional().default(''),
    })
    .strict(),
});

/** Saving a question is a toggle, so the only input is which question. */
export const bookmarkSchema = z.object({
  body: z.object({ questionId: objectId }).strict(),
});

export const bookmarkIdSchema = z.object({
  params: z.object({ id: objectId }),
});

/**
 * The report queue is read whole and filtered in the client, so the only query it accepts is the
 * usual paging pair. `catchall` keeps a stray tracking parameter from turning into a 422.
 */
export const listQuestionFlagsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    })
    .catchall(z.any()),
});

/**
 * An admin's decision on a report.
 *
 * `status` is required: the buttons on the queue each set one, and there is no default decision
 * that would not be a guess. `resolution` is nullable so an admin can remove a note they wrote
 * by mistake, which is different from never having written one.
 */
export const updateQuestionFlagSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum([...FLAG_STATUSES]),
      resolution: z.string().trim().max(500).nullable().optional(),
    })
    .strict(),
});
