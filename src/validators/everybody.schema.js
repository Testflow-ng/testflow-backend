import { z } from 'zod';
import { PLAN_KEYS } from '../models/PlanDefinition.js';
import { SITE_TEMPLATES, SITE_PAGES } from '../models/SiteConfig.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Subdomain must be at least 3 characters.')
  .max(30, 'Subdomain must be at most 30 characters.')
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and single hyphens.')
  .refine((v) => !v.includes('--'), 'Consecutive hyphens are not allowed.');

const email = z.string().trim().toLowerCase().email().max(254);
const orgName = z.string().trim().min(2).max(120);
const token = z.string().min(1).max(256);
const hexColor = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Use a hex colour such as #0f172a.');

export const RESERVED_SLUGS = Object.freeze([
  'www', 'api', 'admin', 'ads', 'app', 'mail', 'cdn', 'static',
  'everybody', 'everyone', 'docs', 'status', 'support', 'billing', 'login',
]);

export const orgParamsSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const memberParamsSchema = z.object({
  params: z.object({ organizationId: objectId, memberId: objectId }).strict(),
});

export const createOrgSchema = z.object({
  body: z
    .object({
      name: orgName,
      slug: slug.optional(),
      contactEmail: email.optional(),
      timezone: z.string().trim().max(64).optional(),
    })
    .strict(),
});

export const updateOrgSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      name: orgName.optional(),
      contactEmail: email.optional(),
      timezone: z.string().trim().max(64).optional(),
    })
    .strict(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listOrgsQuerySchema = z.object({ query: pageQuery.strict() });
export const listMembersQuerySchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: pageQuery.extend({ role: z.enum(['owner', 'admin', 'examiner', 'student']).optional() }).strict(),
});

export const inviteSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      email,
      role: z.enum(['admin', 'examiner', 'student']),
    })
    .strict(),
});

export const updateMemberSchema = z.object({
  params: z.object({ organizationId: objectId, memberId: objectId }).strict(),
  body: z
    .object({
      role: z.enum(['admin', 'examiner', 'student']).optional(),
      status: z.enum(['active', 'suspended', 'removed']).optional(),
    })
    .strict()
    .refine((b) => b.role !== undefined || b.status !== undefined, 'Nothing to update.'),
});

export const acceptInviteSchema = z.object({
  body: z.object({ token }).strict(),
});

/* ------------------------------------------------------------------------------------------------
 * Site builder: the flat shape the console edits (`template`, `brand`, `landing`, `portal`,
 * `pages`, `footer`). Known keys are validated and the rest of the body is dropped, so the console
 * can echo the version fields it read back without tripping validation.
 * ---------------------------------------------------------------------------------------------- */

const siteBlockList = z.array(z.record(z.any())).max(24, 'At most 24 blocks.');

const siteBrand = z.object({
  name: z.string().trim().max(120).optional(),
  tagline: z.string().trim().max(160).optional(),
  logoUrl: z.string().trim().max(2048).optional(),
  logoAssetId: objectId.nullable().optional(),
  faviconUrl: z.string().trim().max(2048).optional(),
  faviconAssetId: objectId.nullable().optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  font: z.string().trim().max(40).optional(),
});

const siteFooter = z.object({
  text: z.string().trim().max(300).optional(),
  links: z.array(z.object({ label: z.string().trim().max(60), href: z.string().trim().max(2048) })).max(12).optional(),
});

const sitePages = z.object(Object.fromEntries(SITE_PAGES.map((key) => [key, z.boolean().optional()])));

export const listTemplatesSchema = z.object({});
export const siteGetSchema = orgParamsSchema;

export const sitePatchSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({
    template: z.enum(SITE_TEMPLATES).optional(),
    brand: siteBrand.optional(),
    landing: z.object({ sections: siteBlockList.optional() }).optional(),
    portal: z
      .object({
        welcome: z
          .object({
            heading: z.string().trim().max(120).optional(),
            text: z.string().trim().max(600).optional(),
            imageUrl: z.string().trim().max(2048).optional(),
          })
          .optional(),
        sections: siteBlockList.optional(),
      })
      .optional(),
    pages: sitePages.optional(),
    footer: siteFooter.optional(),
  }),
});

export const sitePublishSchema = orgParamsSchema;

/** The upload is multipart; `kind` rides along as a text field and defaults to a generic image. */
export const siteAssetsSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ kind: z.enum(['logo', 'favicon', 'hero', 'image']).optional() }),
});

export const getOrgSchema = orgParamsSchema;

const suspendBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const suspendOrgSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: suspendBody,
});

export const reinstateOrgSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: suspendBody,
});

export const planEditSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      key: z.enum(PLAN_KEYS),
      priceMinor: z.number().int().min(0).optional(),
      available: z.boolean().optional(),
    })
    .strict(),
});

/* ------------------------------------------------------------------------------------------------
 * The organisation console: exams, questions, students, library, money and domains.
 * ---------------------------------------------------------------------------------------------- */

const orgQuery = pageQuery;

export const orgStudentsListSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: pageQuery.extend({ search: z.string().trim().max(120).optional(), role: z.enum(['owner', 'admin', 'examiner', 'student']).optional() }),
});

/* --- Exams --- */

const examBody = {
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(5000).optional(),
  mode: z.enum(['anytime', 'live']).optional(),
  // An empty string clears the live start; "" is what the console sends when the date is removed.
  startsAt: z.string().trim().max(40).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(600).optional(),
  questionIds: z.array(objectId).max(2000).optional(),
  access: z.enum(['link', 'invited', 'code']).optional(),
  accessCode: z.string().trim().max(20).optional(),
  showCorrections: z.enum(['now', 'after_exam', 'score_only', 'hidden']).optional(),
  attemptsAllowed: z.coerce.number().int().min(1).max(50).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  marksPerQuestion: z.coerce.number().min(0).max(100).optional(),
  negativeMarking: z.coerce.number().min(0).max(100).optional(),
  priceMinor: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
};

export const orgExamListSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: orgQuery.extend({ status: z.enum(['draft', 'published', 'archived']).optional(), q: z.string().trim().max(120).optional() }),
});

export const orgExamCreateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ ...examBody, title: z.string().trim().min(1).max(200), durationMinutes: z.coerce.number().int().min(1).max(600) }),
});

export const orgExamUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, examId: objectId }).strict(),
  body: z.object(examBody),
});

export const orgExamParamSchema = z.object({
  params: z.object({ organizationId: objectId, examId: objectId }).strict(),
});

export const orgExamQuestionsSchema = z.object({
  params: z.object({ organizationId: objectId, examId: objectId }).strict(),
  body: z.object({ questionIds: z.array(objectId).max(2000) }),
});

export const orgExamResultsSchema = z.object({
  params: z.object({ organizationId: objectId, examId: objectId }).strict(),
  query: pageQuery,
});

export const orgAttemptParamSchema = z.object({
  params: z.object({ organizationId: objectId, attemptId: objectId }).strict(),
});

/* --- Questions --- */

const optionInput = z.union([z.string().max(2000), z.object({ text: z.string().max(2000).optional(), imageUrl: z.string().max(2048).nullable().optional() })]);

const questionBody = {
  stem: z.string().trim().min(1).max(4000).optional(),
  stemImageUrl: z.string().trim().max(2048).nullable().optional(),
  options: z.array(optionInput).min(2).max(6).optional(),
  optionImages: z.array(z.string().max(2048).nullable()).max(6).optional(),
  correctIndex: z.coerce.number().int().min(0).max(5).optional(),
  topic: z.string().trim().max(120).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  explanation: z.string().trim().max(4000).optional(),
  explanationImageUrl: z.string().trim().max(2048).nullable().optional(),
};

export const orgQuestionListSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: orgQuery.extend({
    search: z.string().trim().max(200).optional(),
    topic: z.string().trim().max(120).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    bankId: objectId.optional(),
  }),
});

export const orgQuestionCreateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({
    ...questionBody,
    stem: z.string().trim().min(1).max(4000),
    options: z.array(optionInput).min(2).max(6),
    correctIndex: z.coerce.number().int().min(0).max(5),
    // The modal puts a new question straight into an exam or a bank when it was opened from one.
    examId: objectId.optional(),
    bankId: objectId.optional(),
  }),
});

export const orgQuestionUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, questionId: objectId }).strict(),
  body: z.object(questionBody),
});

export const orgQuestionParamSchema = z.object({
  params: z.object({ organizationId: objectId, questionId: objectId }).strict(),
});

export const orgQuestionBulkSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: z
    .object({ examId: objectId.optional(), bankId: objectId.optional() })
    .optional(),
  // Deliberately loose: a bad row is reported back in `failed` by the service, not rejected here,
  // so one malformed line never sinks an otherwise good import.
  body: z
    .array(
      z.object({
        stem: z.string().max(4000).optional(),
        stemImageUrl: z.string().max(2048).nullable().optional(),
        options: z.array(optionInput).max(6).optional(),
        optionImages: z.array(z.string().max(2048).nullable()).max(6).optional(),
        correctIndex: z.coerce.number().int().max(5).optional(),
        topic: z.string().max(120).optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        explanation: z.string().max(4000).optional(),
        explanationImageUrl: z.string().max(2048).nullable().optional(),
      }),
    )
    .max(500, 'At most 500 questions at a time.'),
});

export const orgQuestionAssetsSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({}).optional(),
});

const booleanQuery = (defaultValue = false) =>
  z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (value === true || value === 'true' || value === '1') return true;
    return false;
  }, z.boolean());

export const orgQuestionImportSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: z.object({
    examId: objectId.optional(),
    bankId: objectId.optional(),
    dryRun: booleanQuery(false),
  }).strict(),
});

export const orgQuestionImportTemplateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
});

/* --- Question banks --- */

const bankBody = {
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(200).optional(),
};

export const orgBankListSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const orgBankCreateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ ...bankBody, name: z.string().trim().min(2).max(80) }),
});

export const orgBankUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, bankId: objectId }).strict(),
  body: z.object(bankBody),
});

export const orgBankParamSchema = z.object({
  params: z.object({ organizationId: objectId, bankId: objectId }).strict(),
});

export const orgBankQuestionsSchema = z.object({
  params: z.object({ organizationId: objectId, bankId: objectId }).strict(),
  query: orgQuery.extend({
    search: z.string().trim().max(200).optional(),
    topic: z.string().trim().max(120).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  }),
});

/* --- Students --- */

export const orgStudentParamSchema = z.object({
  params: z.object({ organizationId: objectId, studentId: objectId }).strict(),
});

/* --- Community posts (announcements) --- */

const postBody = {
  type: z.enum(['announcement', 'discussion']).optional(),
  text: z.string().trim().min(1).max(5000).optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

export const orgPostListSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const orgPostCreateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ ...postBody, text: z.string().trim().min(1).max(5000) }),
});

export const orgPostUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, postId: objectId }).strict(),
  body: z.object(postBody),
});

export const orgPostParamSchema = z.object({
  params: z.object({ organizationId: objectId, postId: objectId }).strict(),
});

/* --- Reported questions --- */

export const orgFlagListSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const orgFlagUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, flagId: objectId }).strict(),
  body: z.object({
    status: z.enum(['open', 'resolved', 'dismissed']),
    resolution: z.string().trim().max(500).optional(),
  }),
});

/* --- Library books --- */

const bookBody = {
  title: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().max(20).optional(),
  description: z.string().trim().max(2000).optional(),
  color: z.enum(['red', 'blue', 'ink', 'green', 'amber', 'violet', 'teal']).optional(),
  priceMinor: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  visibility: z.enum(['all_students', 'group', 'paid']).optional(),
  previewPages: z.coerce.number().int().min(0).optional(),
  pages: z.coerce.number().int().min(0).optional(),
  fileName: z.string().trim().max(300).optional(),
  published: z.boolean().optional(),
};

export const orgBookListSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const orgBookCreateSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ ...bookBody, title: z.string().trim().min(1).max(200) }),
});

export const orgBookUpdateSchema = z.object({
  params: z.object({ organizationId: objectId, bookId: objectId }).strict(),
  body: z.object(bookBody),
});

export const orgBookParamSchema = z.object({
  params: z.object({ organizationId: objectId, bookId: objectId }).strict(),
});

/* --- Money --- */

export const orgPayoutVerifySchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z.object({ bankCode: z.string().trim().min(1).max(10), accountNumber: z.string().trim().regex(/^\d{10}$/, 'A Nigerian account number is 10 digits.') }).strict(),
});

export const orgPayoutSaveSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      bankCode: z.string().trim().min(1).max(10),
      accountNumber: z.string().trim().regex(/^\d{10}$/, 'A Nigerian account number is 10 digits.'),
      businessName: z.string().trim().min(2).max(120).optional(),
    })
    .strict(),
});

export const orgEarningsSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const orgPaymentsListSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: pageQuery.extend({
    // The Payments screen exports a filtered history, so it may ask for up to 500 rows at once.
    limit: z.coerce.number().int().min(1).max(500).default(20),
    status: z.enum(['initialized', 'paid', 'failed', 'refunded']).optional(),
    from: z.string().trim().max(40).optional(),
    to: z.string().trim().max(40).optional(),
  }),
});

/* --- Domains --- */

export const orgDomainListSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const checkSubdomainSchema = z.object({ query: z.object({ name: z.string().trim().min(1).max(63) }) });

export const orgDomainAddSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      type: z.enum(['subdomain', 'custom']),
      hostname: z.string().trim().toLowerCase().min(4).max(253),
    })
    .strict(),
});

export const orgDomainParamSchema = z.object({
  params: z.object({ organizationId: objectId, domainId: objectId }).strict(),
});

/* --- Subscription aliases (flat console calls) --- */

export const orgSubscriptionSchema = z.object({ query: z.object({ organizationId: objectId }) });

export const orgPlansSchema = z.object({});

export const orgSubscriptionPaymentsSchema = z.object({
  query: z.object({ organizationId: objectId, page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
});
