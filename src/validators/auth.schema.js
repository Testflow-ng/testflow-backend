import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

// Max 72 bytes because bcrypt silently truncates beyond that.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/\d/, 'Password must include a number');

const fullName = z.string().trim().min(2).max(120);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');

// Optional: blank/whitespace is normalized to "not provided" so the sparse
// unique index isn't tripped by multiple empty strings.
const matricNumber = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().toUpperCase().min(3).max(20).optional(),
);
const token = z.string().min(1).max(256);

export const registerSchema = z.object({
  body: z
    .object({
      fullName,
      email,
      password,
      confirmPassword: z.string(),
    })
    .strict()
    .refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
});

export const loginSchema = z.object({
  // Login only checks presence/shape; never leak the password policy here.
  body: z.object({ email, password: z.string().min(1).max(72) }).strict(),
});

export const emailOnlySchema = z.object({
  body: z.object({ email }).strict(),
});

export const verifyEmailSchema = z.object({
  body: z.object({ token }).strict(),
});

export const resetPasswordSchema = z.object({
  body: z.object({ token, password }).strict(),
});
