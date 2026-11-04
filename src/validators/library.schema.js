import { z } from 'zod';
import { BOOK_SEMESTERS } from '../models/Book.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * The shelf query.
 *
 * `filter` is a free string and not an enum: an unknown value is treated as `all` by the service,
 * because it arrives from a client control and a new option must not turn the shelf into a 422.
 * The query is a `catchall` for the same reason paging is: a stray tracking parameter is dropped,
 * not refused. Only the keys below are read.
 */
export const listBooksSchema = z.object({
  query: z
    .object({
      q: z.string().trim().max(120).optional().default(''),
      page: z.coerce.number().int().min(1).optional().default(1),
      limit: z.coerce.number().int().min(1).max(50).optional().default(12),
      filter: z.string().trim().max(32).optional().default('all'),
      level: z.coerce.number().int().min(1).optional(),
      semester: z.enum([...BOOK_SEMESTERS]).optional(),
    })
    .catchall(z.any()),
});

export const bookIdSchema = z.object({
  params: z.object({ id: objectId }),
});

/** The reader asks for one page; out-of-range values are clamped by the service, not refused. */
export const bookPagesSchema = z.object({
  params: z.object({ id: objectId }),
  query: z
    .object({ page: z.coerce.number().int().min(1).optional().default(1) })
    .catchall(z.any()),
});

/**
 * Reading progress. `percent` is accepted and deliberately ignored: the server computes it from
 * the book's own page count, so a client can send it without being believed.
 */
export const bookProgressSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      page: z.coerce.number().int().min(1),
      percent: z.number().optional(),
    })
    .strict(),
});
