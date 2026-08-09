import { z } from 'zod';

export const listSubjectsSchema = z.object({
  query: z.object({ all: z.enum(['true', 'false']).optional() }).strict(),
});

export const subjectCodeSchema = z.object({
  params: z.object({ code: z.string().trim().min(1).max(20) }),
});

export const subjectIdSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format') }),
});

export const createSubjectSchema = z.object({
  body: z.object({
    code: z.string().trim().min(1).max(20),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(500).optional(),
    level: z.enum(['post-utme', '100', '200', '300', '400', '500']).default('100'),
    department: z.string().trim().max(100).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
});

export const updateSubjectSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format') }),
  body: z
    .object({
      code: z.string().trim().min(1).max(20).optional(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(500).optional(),
      level: z.enum(['post-utme', '100', '200', '300', '400', '500']).optional(),
      department: z.string().trim().max(100).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});
