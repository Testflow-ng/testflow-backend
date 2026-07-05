import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const options = z.array(z.string().trim().min(1).max(2000)).min(2).max(6);
const difficulty = z.enum(['easy', 'medium', 'hard']);

const singleQuestionBody = z
  .object({
    subject: z.string().trim().min(1).max(50), // Increased for long codes if any
    stem: z.string().trim().min(1).max(5000), // Increased for long LaTeX stems
    options,
    correctIndex: z.number().int().min(0),
    explanation: z.string().trim().max(5000).optional(), // Increased
    difficulty: difficulty.optional(),
  })
  .strict()
  .refine((data) => data.correctIndex < data.options.length, {
    message: 'correctIndex must reference a valid option',
    path: ['correctIndex'],
  });

export const createQuestionSchema = z.object({
  body: singleQuestionBody,
});

export const updateQuestionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      stem: z.string().trim().min(1).max(2000).optional(),
      options: options.optional(),
      correctIndex: z.number().int().min(0).optional(),
      explanation: z.string().trim().max(2000).optional(),
      difficulty: difficulty.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

export const bulkCreateQuestionsSchema = z.object({
  body: z.array(singleQuestionBody).min(1).max(500),
});

export const questionIdSchema = z.object({ params: z.object({ id: objectId }) });

export const listQuestionsSchema = z.object({
  query: z
    .object({
      subject: z.string().trim().max(24).optional(),
      difficulty: difficulty.optional(),
      search: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict(),
});
