import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const shareCode = z.string().regex(/^[A-Za-z2-9]{6,16}$/, 'Invalid share code');

export const createLiveExamSchema = z.object({
  body: z
    .object({
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(2000).optional().default(''),
      subject: z.string().trim().min(1).max(24).optional(),
      questionIds: z.array(objectId).min(1).max(200).optional(),
      numQuestions: z.coerce.number().int().min(1).max(200),
      durationMinutes: z.coerce.number().int().min(1).max(240),
      maxParticipants: z.coerce.number().int().min(1).max(30).optional(),
      difficulty: z.enum(['mixed', 'easy', 'medium', 'hard']).optional().default('mixed'),
      shuffleQuestions: z.boolean().optional().default(true),
      shuffleOptions: z.boolean().optional().default(true),
      negativeMarking: z.coerce.number().min(0).max(5).optional().default(0),
      marksPerQuestion: z.coerce.number().min(0.5).max(100).optional().default(1),
      allowReview: z.boolean().optional().default(true),
    })
    .strict()
    .refine((data) => data.subject || data.questionIds, {
      message: 'Provide a subject or an explicit questionIds list.',
    }),
});

export const shareCodeParamSchema = z.object({ params: z.object({ code: shareCode }) });

export const targetUserSchema = z.object({
  params: z.object({ code: shareCode }),
  body: z.object({ userId: objectId }).strict(),
});

export const saveLiveAnswerSchema = z.object({
  params: z.object({ code: shareCode }),
  body: z
    .object({
      questionIndex: z.number().int().min(0).max(199),
      selectedOption: z.number().int().min(0).max(5).nullable(),
    })
    .strict(),
});
