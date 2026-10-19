import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { requestOrigin } from '../utils/requestOrigin.js';
import { findSiteByHostname, publicSiteView, normalizeSurface, tenantAdsFor } from '../services/orgSite.service.js';
import { siteCardPng } from '../services/ogImage.service.js';
import { sitePageHtml, missingPageHtml } from '../utils/shareHtml.js';
import { requestedTenantHost } from '../middleware/resolveTenant.js';
import * as identity from '../services/identity.service.js';
import * as content from '../services/orgContent.service.js';
import * as sitting from '../services/orgExamSitting.service.js';
import * as payments from '../services/orgStudentPayments.service.js';
import { setAuthCookies, clearAuthCookies } from '../services/token.service.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { recordAction } from '../services/audit.service.js';

/**
 * The tenant site API: what the frontend calls when it is opened on an organisation's own address
 * (the customer support matrix in section 8 of the requirements doc).
 *
 * Three rules run through the file:
 *  1. The organisation comes from the address, never from the body, so a caller cannot reach a
 *     tenant it is not standing on.
 *  2. A student account belongs to one organisation. Sign-in checks the membership, and an account
 *     with a membership elsewhere is refused here.
 *  3. The public site and the share image read the *published* surface only, so an unpublished
 *     draft can never leak through a tenant hostname.
 */

const requirePublished = (resolved) => {
  if (!resolved.config?.published) {
    throw new AppError(404, 'TENANT_NOT_FOUND', 'This site is not set up yet.');
  }
};

const requireStudent = async (orgId, user) => {
  const membership = await OrgMembership.findOne({
    organization: orgId,
    user: user._id,
    role: 'student',
    status: 'active',
  }).lean();
  if (!membership) {
    throw new AppError(403, 'NO_MEMBERSHIP', 'This account is not a student of this organisation.');
  }
  return membership;
};

/** GET /api/v1/public/site */
export const getSite = asyncHandler(async (req, res) => {
  requirePublished(req.tenant);
  const ads = await tenantAdsFor(req.tenant.org);
  res.json(publicSiteView(req.tenant, requestOrigin(req), ads));
});

/** GET /api/v1/public/site/og.png — the 1200x630 share card, on the organisation's brand. */
export const getSiteCard = asyncHandler(async (req, res) => {
  requirePublished(req.tenant);
  const surface = normalizeSurface(req.tenant.config.published);
  const png = await siteCardPng({
    name: surface.brand.name || req.tenant.org.name,
    tagline: surface.brand.tagline,
    primaryColor: surface.brand.primaryColor,
    accentColor: surface.brand.accentColor,
  });
  res
    .type('png')
    .set('Cache-Control', 'public, max-age=3600')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(png);
});

/**
 * GET /api/v1/public/site/page — the HTML a host rewrites a crawler to.
 *
 * The Open Graph tags have to be in the first response, which is why this is HTML and not JSON. An
 * unknown host still gets a readable 404, since a person may have followed a shared link.
 */
export const getSiteHtml = asyncHandler(async (req, res) => {
  const resolved = await findSiteByHostname(requestedTenantHost(req));
  if (!resolved?.config?.published) {
    res.status(404).type('html').send(missingPageHtml());
    return;
  }
  const ads = await tenantAdsFor(resolved.org);
  const view = publicSiteView(resolved, requestOrigin(req), ads);
  res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(sitePageHtml({ site: view, url: view.meta.canonicalUrl, imageUrl: view.meta.ogImageUrl }));
});

/** GET /api/v1/public/site/pages/:page — 404 when the owner has switched the page off. */
export const getSitePage = asyncHandler(async (req, res) => {
  requirePublished(req.tenant);
  const surface = normalizeSurface(req.tenant.config.published);
  const page = req.params.page;
  if (!Object.prototype.hasOwnProperty.call(surface.pages, page) || surface.pages[page] === false) {
    throw new AppError(404, 'PAGE_NOT_FOUND', 'That page is not available on this site.');
  }
  const ads = await tenantAdsFor(req.tenant.org);
  res.json({ page, ...publicSiteView(req.tenant, requestOrigin(req), ads) });
});

/** GET /api/v1/public/exams — the organisation's published exams, for its signed-in students. */
export const getExams = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  const { items } = await content.listExams(req.tenant.org._id, { status: 'published', limit: 100 });
  res.json({
    items: items.map((e) => ({
      id: e.id,
      title: e.title,
      questionCount: e.questionCount,
      durationMinutes: e.durationMinutes,
      priceMinor: e.priceMinor,
      currency: e.currency,
      mode: e.mode,
      startsAt: e.startsAt,
      status: e.status,
    })),
  });
});

/** GET /api/v1/public/auth/me */
export const me = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json({ user: req.user });
});

/** GET /api/v1/public/announcements — visible posts, pinned first. */
export const getAnnouncements = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await content.listAnnouncements(req.tenant.org._id));
});

/** GET /api/v1/public/results — this student's finished papers. */
export const getResults = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await sitting.getMyResults(req.tenant.org._id, req.user._id, req.query));
});

/** GET /api/v1/public/results/:attemptId — one paper, gated by `showCorrections`. */
export const getResult = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await sitting.getMyResult(req.tenant.org._id, req.user._id, req.params.attemptId));
});

/** POST /api/v1/public/exams/:examId/start — server-clock start (or resume). */
export const startExam = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  const { attempt } = await sitting.startAttempt(req.tenant.org, req.user, req.params.examId, req.body ?? {});
  res.status(201).json({ attempt });
});

/** PATCH /api/v1/public/attempts/:attemptId/answers — save one answer. */
export const saveAnswer = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await sitting.saveAnswer(req.tenant.org._id, req.user._id, req.params.attemptId, req.body));
});

/** POST /api/v1/public/attempts/:attemptId/submit — mark the paper and return what may be seen. */
export const submitAttempt = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await sitting.submitAttempt(req.tenant.org._id, req.user._id, req.params.attemptId));
});

/** POST /api/v1/public/questions/:questionId/flag — report a question from a paper. */
export const flagQuestion = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await content.flagQuestion(req.tenant.org, req.user, req.params.questionId, req.body));
});

/** POST /api/v1/public/exams/:examId/checkout — start paying for a priced exam. */
export const checkoutExam = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || null;
  const result = await payments.initializeExamCheckout(req.tenant.org, req.user, req.params.examId, { idempotencyKey });
  res.status(result.alreadyPaid ? 200 : 201).json(result);
});

/** GET /api/v1/public/payments/verify?reference= — re-check with the provider; idempotent. */
export const verifyPayment = asyncHandler(async (req, res) => {
  await requireStudent(req.tenant.org._id, req.user);
  res.json(await payments.verifyExamPayment(req.tenant.org._id, req.user._id, req.query.reference));
});

/** POST /api/v1/public/payments/webhook — Paystack server-to-server, signature-checked. */
export const paymentWebhook = asyncHandler(async (req, res) => {
  const result = await payments.handleOrgPaymentWebhook(
    req.rawBody ?? Buffer.from(''),
    req.get('x-paystack-signature'),
    req.body,
  );
  res.json(result);
});

/** POST /api/v1/public/auth/register — a new student of this organisation. */
export const register = asyncHandler(async (req, res) => {
  const user = await identity.registerAccount({ product: 'student', ...req.body }, req);
  try {
    await OrgMembership.create({ organization: req.tenant.org._id, user: user._id, role: 'student', status: 'active' });
  } catch (error) {
    // No half-made student: if the membership cannot be written, the account goes too.
    await user.deleteOne().catch(() => {});
    throw error;
  }
  await recordAction({
    actorId: user._id, action: 'TENANT_REGISTER', targetId: req.tenant.org._id, targetType: 'Organization',
    metadata: { host: req.tenant.host }, req,
  });
  setAuthCookies(res, user, 'student');
  res.status(201).json({ user });
});

/** POST /api/v1/public/auth/login — only a student of this organisation. */
export const login = asyncHandler(async (req, res) => {
  const { user, activeProduct } = await identity.loginAccount(req.body, req);
  await requireStudent(req.tenant.org._id, user);
  setAuthCookies(res, user, activeProduct);
  res.json({ user });
});

/** POST /api/v1/public/auth/logout */
export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookies(res);
  res.status(204).send();
});
