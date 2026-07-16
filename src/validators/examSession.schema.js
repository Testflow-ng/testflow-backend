import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const startSessionSchema = z.object({
  body: z
    .object({
      subject: z.string().trim().min(1).max(24),
      questionCount: z.coerce.number().int().min(1).max(50).optional(),
      durationMinutes: z.coerce.number().int().min(1).max(180).optional(),
      topicId: z.string().trim().max(20).optional(),
      subtopic: z.string().trim().max(160).optional(),
    })
    .strict(),
});

export const sessionIdSchema = z.object({ params: z.object({ id: objectId }) });

export const answerSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      questionIndex: z.number().int().min(0),
      selectedOption: z.number().int().min(0).nullable().optional(),
      markedForReview: z.boolean().optional(),
    })
    .strict()
    .refine((data) => data.selectedOption !== undefined || data.markedForReview !== undefined, {
      message: 'Provide selectedOption or markedForReview.',
    }),
});
