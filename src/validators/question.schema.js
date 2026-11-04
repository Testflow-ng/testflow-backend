import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const options = z.array(z.string().trim().min(1).max(2000)).min(2).max(6);
const difficulty = z.enum(['easy', 'medium', 'hard']);

const singleQuestionBody = z
  .object({
    subject: z.string().trim().min(1).max(50),
    topicId: z.string().trim().max(20).optional(),
    topic: z.string().trim().max(160).optional(),
    subtopic: z.string().trim().max(160).optional(),
    stem: z.string().trim().min(1).max(5000),
    options,
    correctIndex: z.coerce.number().int().min(0), // Use coerce to handle string numbers
    explanation: z.string().trim().max(5000).optional(),
    difficulty: difficulty.optional(),
    isActive: z.boolean().optional(),
  }); // Removed .strict() to be more forgiving

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
