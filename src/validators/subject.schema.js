import { z } from 'zod';

export const listSubjectsSchema = z.object({
  query: z.object({ all: z.enum(['true', 'false']).optional() }).strict(),
});

export const subjectCodeSchema = z.object({
  params: z.object({ code: z.string().trim().min(1).max(20) }),
});

export const updateSubjectSchema = z.object({
  params: z.object({ code: z.string().trim().min(1).max(20) }),
  body: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(500).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});
