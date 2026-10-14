import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Env must be set before any module that imports config/env.js is loaded.
process.env.NODE_ENV = 'test';
process.env.R2_ACCOUNT_ID = 'acct';
process.env.R2_ACCESS_KEY_ID = 'AKIATEST';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.R2_BUCKET = 'bkt';
process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';

const { computePrice } = await import('../src/utils/ads/pricing.js');
const { canTransition, assertTransition, TRANSITIONS, STATUS } = await import('../src/utils/ads/campaignState.js');
const content = await import('../src/utils/ads/content.js');
const { rank, relevance } = await import('../src/utils/ads/ranker.js');
const { optimizeAdImage } = await import('../src/services/ads/image.service.js');
const { paystackProvider } = await import('../src/services/ads/payment/paystack.js');
const r2 = await import('../src/utils/r2.js');
const { computeSchedule } = await import('../src/services/ads/moderation.service.js');

describe('pricing', () => {
  const flat = { dailyFeeKobo: 100000, pricingPolicy: 'flat', tiers: [] };
  it('multiplies the configured daily fee by days (₦1,000/day)', () => {
    assert.equal(computePrice(flat, 1).totalKobo, 100000);
    assert.equal(computePrice(flat, 7).totalKobo, 700000);
  });
  it('follows the admin-configured fee, not a constant', () => {
    assert.equal(computePrice({ ...flat, dailyFeeKobo: 250000 }, 3).totalKobo, 750000);
  });
  it('applies the best matching tier discount', () => {
    const tiered = { dailyFeeKobo: 100000, pricingPolicy: 'tiered', tiers: [{ minDays: 7, percentOff: 10 }, { minDays: 14, percentOff: 20 }] };
    assert.equal(computePrice(tiered, 6).totalKobo, 600000);
    assert.equal(computePrice(tiered, 7).totalKobo, 630000);
    assert.equal(computePrice(tiered, 14).totalKobo, 1120000);
  });
  it('ignores tiers under the flat policy and rejects bad durations', () => {
    assert.equal(computePrice({ ...flat, tiers: [{ minDays: 2, percentOff: 50 }] }, 5).totalKobo, 500000);
    assert.throws(() => computePrice(flat, 0), { code: 'INVALID_DURATION' });
    assert.throws(() => computePrice(flat, 1.5), { code: 'INVALID_DURATION' });
  });
});

describe('campaign state machine', () => {
  it('allows the happy path', () => {
    const path = ['draft', 'pending_payment', 'pending_review', 'active', 'expired', 'archived'];
    for (let i = 0; i < path.length - 1; i += 1) assert.ok(canTransition(path[i], path[i + 1]), `${path[i]}→${path[i + 1]}`);
  });
  it('never lets unpaid/unapproved campaigns go live', () => {
    for (const from of ['draft', 'pending_payment', 'rejected', 'cancelled', 'archived', 'expired']) {
      assert.equal(canTransition(from, 'active'), false, from);
      assert.equal(canTransition(from, 'scheduled'), false, from);
    }
    assert.throws(() => assertTransition('draft', 'active'), { code: 'INVALID_TRANSITION' });
  });
  it('terminal states have no exits and every target is a known state', () => {
    assert.deepEqual(TRANSITIONS.archived, []);
    assert.deepEqual(TRANSITIONS.cancelled, []);
    const known = new Set(Object.values(STATUS));
    for (const targets of Object.values(TRANSITIONS)) targets.forEach((t) => assert.ok(known.has(t)));
  });
  it('expired campaigns cannot be revived (republish creates a new one)', () => {
    assert.equal(canTransition('expired', 'active'), false);
    assert.equal(canTransition('removed', 'active'), false);
  });
});

describe('content validation', () => {
  it('counts words', () => {
    assert.equal(content.countWords(''), 0);
    assert.equal(content.countWords('  one   two\nthree '), 3);
  });
  it('accepts https URLs and rejects unsafe ones', () => {
    assert.ok(content.parseDestinationUrl('https://shop.example.com/promo?a=1').ok);
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pw@example.com',
      'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://intranet/x', 'https://example.com:8443/', 'not a url']) {
      assert.equal(content.parseDestinationUrl(bad).ok, false, bad);
    }
  });
  it('normalizes WhatsApp numbers and rejects invalid ones', () => {
    assert.equal(content.parseWhatsappNumber('08012345678').number, '2348012345678');
    assert.equal(content.parseWhatsappNumber('+234 801 234 5678').number, '2348012345678');
    assert.equal(content.parseWhatsappNumber('+44 7911 123456').number, '447911123456');
    for (const bad of ['', '123', 'abcdefghijk', '+2348012345', '0801234']) assert.equal(content.parseWhatsappNumber(bad).ok, false, bad);
    assert.equal(content.whatsappHref('2348012345678'), 'https://wa.me/2348012345678');
  });
  it('de-duplicates and normalizes keywords; plain text rejects markup', () => {
    assert.deepEqual(content.normalizeKeywords([' Law ', 'law', 'Data  Science']), ['law', 'data science']);
    assert.equal(content.plainText(50, 'T').safeParse('<script>x</script>').success, false);
    assert.equal(content.plainText(50, 'T').safeParse('Learn faster').success, true);
  });
});

describe('deterministic ranker', () => {
  const mk = (id, keywords, endsAt = '2030-01-01') => ({ _id: id, keywords, endsAt });
  it('prefers keyword relevance, then fewest impressions today, then ending soonest', () => {
    const ctx = { subjectCodes: ['CHM101'], subjects: ['General Chemistry'], department: 'Chemistry' };
    const out = rank([mk('a', []), mk('b', ['chemistry']), mk('c', ['law'])], ctx).map((r) => r.campaign._id);
    assert.equal(out[0], 'b');
    const tie = rank([mk('x', []), mk('y', [])], ctx, { impressionsToday: (c) => (c._id === 'x' ? 10 : 2) }).map((r) => r.campaign._id);
    assert.deepEqual(tie, ['y', 'x']);
    const soon = rank([mk('p', [], '2030-06-01'), mk('q', [], '2030-02-01')], ctx).map((r) => r.campaign._id);
    assert.deepEqual(soon, ['q', 'p']);
  });
  it('is deterministic', () => {
    const cs = [mk('1', ['a']), mk('2', ['a']), mk('3', ['a'])];
    assert.deepEqual(rank(cs, {}).map((r) => r.campaign._id), rank([...cs].reverse(), {}).map((r) => r.campaign._id));
    assert.equal(relevance(mk('z', ['organic chemistry']), { subjects: ['Organic Chemistry'] }), 2);
  });
});

describe('image validation & optimization', () => {
  const limits = { imageTargetBytes: 1024 * 1024, imageMaxBytes: 2 * 1024 * 1024 };
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#3355aa' } }).png().toBuffer();

  it('accepts a real image and re-encodes it to a capped WebP', async () => {
    const out = await optimizeAdImage(await png(2400, 1200), limits);
    assert.equal(out.format, 'webp');
    assert.ok(out.width <= 1280 && out.bytes <= limits.imageTargetBytes);
    assert.equal((await sharp(out.buffer).metadata()).format, 'webp');
  });
  it('does not trust names/MIME: text renamed to .png is rejected', async () => {
    await assert.rejects(optimizeAdImage(Buffer.from('<?php echo 1; ?> GIF89a'), limits), { code: 'INVALID_IMAGE' });
  });
  it('rejects unsupported real formats, tiny images and oversize files', async () => {
    const gif = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fff' } }).gif().toBuffer();
    await assert.rejects(optimizeAdImage(gif, limits), { code: 'UNSUPPORTED_IMAGE_FORMAT' });
    await assert.rejects(optimizeAdImage(await png(100, 50), limits), { code: 'IMAGE_TOO_SMALL' });
    await assert.rejects(optimizeAdImage(Buffer.alloc(2 * 1024 * 1024 + 1), limits), { code: 'IMAGE_TOO_LARGE' });
  });
  it('strips EXIF metadata', async () => {
    const withExif = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#fff' } })
      .jpeg().withExif({ IFD0: { Copyright: 'secret-owner' } }).toBuffer();
    const out = await optimizeAdImage(withExif, limits);
    assert.equal((await sharp(out.buffer).metadata()).exif, undefined);
  });
});

describe('payment webhook signature (paystack adapter)', () => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ADS-1' } }));
  const sign = (b, key = 'sk_test_unit') => crypto.createHmac('sha512', key).update(b).digest('hex');
  it('accepts a correct HMAC-SHA512 over the raw body', () => assert.ok(paystackProvider.verifyWebhookSignature(body, sign(body))));
  it('rejects tampered bodies, wrong keys and missing signatures', () => {
    assert.equal(paystackProvider.verifyWebhookSignature(Buffer.from('{"x":1}'), sign(body)), false);
    assert.equal(paystackProvider.verifyWebhookSignature(body, sign(body, 'other')), false);
    assert.equal(paystackProvider.verifyWebhookSignature(body, undefined), false);
    assert.equal(paystackProvider.verifyWebhookSignature(body, 'abc'), false);
  });
  it('parses charge events', () => {
    assert.deepEqual(paystackProvider.parseWebhook(JSON.parse(body)), { type: 'charge.success', reference: 'ADS-1' });
    assert.equal(paystackProvider.parseWebhook({}), null);
  });
});

describe('scheduling', () => {
  const now = new Date('2026-03-01T10:00:00Z');
  it('starts immediately and ends durationDays later', () => {
    const s = computeSchedule(now, undefined, 3);
    assert.equal(s.startsAt.getTime(), now.getTime());
    assert.equal(s.endsAt.toISOString(), '2026-03-04T10:00:00.000Z');
  });
  it('honours a future preferred start date, ignores a past one', () => {
    assert.equal(computeSchedule(now, new Date('2026-03-05T00:00:00Z'), 2).endsAt.toISOString(), '2026-03-07T00:00:00.000Z');
    assert.equal(computeSchedule(now, new Date('2026-02-01T00:00:00Z'), 1).startsAt.getTime(), now.getTime());
  });
});
before(() => {});

describe('Cloudflare R2 signer (AWS SigV4)', () => {
  it('matches the official AWS SigV4 S3 GET-object test vector', () => {
    const { signature } = r2.signV4({
      method: 'GET', path: '/test.txt', amzDate: '20130524T000000Z', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
    });
    assert.equal(signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('builds a presigned PUT URL scoped to the bucket/key with an expiry', () => {
    const p = r2.presignPut('receipts/u1/file', { expiresSec: 120 });
    const u = new URL(p.uploadUrl);
    assert.equal(u.host, 'acct.r2.cloudflarestorage.com');
    assert.equal(u.pathname, '/bkt/receipts/u1/file');
    assert.equal(u.searchParams.get('X-Amz-Expires'), '120');
    assert.match(u.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
    assert.equal(p.publicUrl, 'https://cdn.example.com/receipts/u1/file');
  });
});

describe('destination safety', () => {
  it('refuses link shorteners and anything Safe Browsing flags; allows the rest', async () => {
    const safety = await import('../src/utils/ads/urlSafety.js');
    assert.match(await safety.checkDestinationSafety('https://bit.ly/abc'), /Shortened/);
    assert.match(await safety.checkDestinationSafety('https://www.tinyurl.com/x'), /Shortened/);
    safety.setSafeBrowsingForTests(async (u) => u.includes('evil'));
    assert.match(await safety.checkDestinationSafety('https://evil.example.com'), /unsafe/);
    assert.equal(await safety.checkDestinationSafety('https://shop.example.com'), null);
    safety.setSafeBrowsingForTests(async () => { throw new Error('down'); });
    assert.equal(await safety.checkDestinationSafety('https://shop.example.com'), null); // fails open, logged
    safety.setSafeBrowsingForTests(null);
  });
});

describe('in-memory rate limiter', () => {
  it('allows up to max then answers 429 RATE_LIMITED', async () => {
    const { rateLimit } = await import('../src/middleware/rateLimit.js');
    const mw = rateLimit({ windowMs: 60_000, max: 2, key: () => 'k' });
    const run = () => new Promise((r) => mw({}, {}, r));
    assert.equal(await run(), undefined);
    assert.equal(await run(), undefined);
    const err = await run();
    assert.equal(err.statusCode, 429);
    assert.equal(err.code, 'RATE_LIMITED');
  });
});

describe('training feature extraction (privacy-conscious buckets)', async () => {
  const f = await import('../src/utils/ads/features.js');
  const { campaignKeyOf } = await import('../src/utils/ads/pseudonym.js');
  const raw = {
    sessionType: 'exam', subjectCodes: ['chm101', 'CHM101'], department: '  Chemistry ', level: '200', correct: 33, totalQuestions: 40,
    answered: 40, timeTakenSeconds: 1500, durationMinutes: 30, strikes: 1, streakCount: 5,
    // None of the following may ever reach a feature record:
    studentId: 'STUDENT-ID-1', email: 'a@b.test', fullName: 'Ada Lovelace', questions: [{ stem: 'SECRET STEM', selectedOption: 2 }],
  };
  const now = new Date('2026-03-02T22:30:00Z'); // Monday 23:30 WAT

  it('buckets values instead of exposing them', () => {
    const x = f.extractSessionFeatures(raw, { now, adsSeenToday: 1 });
    assert.deepEqual(x, {
      sessionType: 'exam', subjectCodes: ['CHM101'], department: 'chemistry', level: '200', accuracyBand: '80_100', answeredBand: '90_100',
      timeUseBand: '80_100', lengthBand: 'long', strikesBand: '1', streakBand: '3_6', partOfDay: 'night', dayType: 'weekday', adsSeenTodayBand: '1',
    });
  });
  it('never leaks identities, raw answers or exact numbers', () => {
    const json = JSON.stringify(f.extractSessionFeatures(raw, { now }));
    for (const secret of ['STUDENT-ID-1', 'a@b.test', 'Ada', 'SECRET STEM', '"33"', '1500']) assert.equal(json.includes(secret), false, secret);
  });
  it('bucket boundaries and unknowns', () => {
    assert.equal(f.accuracyBand(39.9), 'lt40'); assert.equal(f.accuracyBand(40), '40_59'); assert.equal(f.accuracyBand(80), '80_100');
    assert.equal(f.accuracyBand(null), 'unknown'); assert.equal(f.timeUseBand(10, 0), 'unknown');
    assert.equal(f.streakBand(0), '0'); assert.equal(f.streakBand(7), '7plus'); assert.equal(f.strikesBand(5), '2plus');
    const empty = f.extractSessionFeatures({ sessionType: 'post_utme' }, { now });
    assert.equal(empty.accuracyBand, 'unknown'); assert.deepEqual(empty.subjectCodes, []); assert.equal(empty.department, null);
  });
  it('uses Nigerian local time (WAT) for part of day / weekend', () => {
    assert.equal(f.partOfDay(new Date('2026-03-02T05:00:00Z')), 'morning'); // 06:00 WAT
    assert.equal(f.partOfDay(new Date('2026-03-02T11:30:00Z')), 'afternoon'); // 12:30 WAT
    assert.equal(f.dayType(new Date('2026-03-07T11:30:00Z')), 'weekend'); // Saturday
    assert.equal(f.dayType(new Date('2026-03-06T23:30:00Z')), 'weekend'); // Fri 23:30 UTC = Sat 00:30 WAT
  });
  it('campaign features describe shape only — never content', () => {
    const c = { destination: { type: 'whatsapp', whatsapp: '2348012345678' }, keywords: ['law', 'bar'], title: 'My secret ad title', description: 'word '.repeat(50), durationDays: 5, startsAt: new Date('2026-03-01'), endsAt: new Date('2026-03-06') };
    const x = f.extractCampaignFeatures(c, { now: new Date('2026-03-02T12:00:00Z'), relevance: 2 });
    assert.deepEqual(x, { destType: 'whatsapp', keywordCount: 2, keywordMatch: true, titleLenBand: 'short', descWordsBand: '31_100', durationBand: '4_7', ageBand: '0_1', remainingBand: '3_7' });
    const json = JSON.stringify(x);
    for (const s of ['secret', '2348012345678', 'law']) assert.equal(json.includes(s), false, s);
  });
  it('campaign keys are stable pseudonyms, not ids', () => {
    const id = '507f1f77bcf86cd799439011';
    assert.equal(campaignKeyOf(id), campaignKeyOf(id));
    assert.notEqual(campaignKeyOf(id), id);
    assert.match(campaignKeyOf(id), /^[a-f0-9]{24}$/);
    assert.notEqual(campaignKeyOf(id), campaignKeyOf('507f1f77bcf86cd799439012'));
  });

  const campaigns = Array.from({ length: 30 }, (_, i) => ({ _id: `c${i}`, destination: { type: 'url' }, keywords: [], title: 'T', description: 'd', durationDays: 3, endsAt: new Date('2030-01-01') }));
  const ranked = campaigns.map((campaign, i) => ({ campaign, relevance: i === 0 ? 2 : 0 }));
  const base = { now: new Date('2026-03-02T10:47:31Z'), rankerVersion: 'deterministic-v1', session: { sessionType: 'exam' }, keyOf: campaignKeyOf, retentionDays: 365 };

  it('builds a served decision: hour-precision time, selected rank 1, capped candidates, retention date', () => {
    const r = f.buildDecisionRecord({ ...base, decisionId: 'd1', serveId: 's1', outcome: 'served', ranked, impressionsToday: () => 4 });
    assert.equal(r.ts.toISOString(), '2026-03-02T10:00:00.000Z');
    assert.equal(r.candidates.length, 25);
    assert.equal(r.candidateCount, 30);
    assert.equal(r.candidates[0].selected, true);
    assert.equal(r.candidates.filter((c) => c.selected).length, 1);
    assert.equal(r.selectedKey, campaignKeyOf('c0'));
    assert.equal(r.serveId, 's1');
    assert.deepEqual(r.policy, { name: 'rules', propensity: 1, exploration: false });
    assert.equal(Math.round((r.expireAt - base.now) / 864e5), 365);
  });
  it('builds a no-ad decision with a reason and no serve link', () => {
    const r = f.buildDecisionRecord({ ...base, decisionId: 'd2', serveId: 'ignored', outcome: 'no_ad', noAdReason: 'frequency_capped', ranked: [] });
    assert.equal(r.noAdReason, 'frequency_capped'); assert.equal(r.serveId, undefined); assert.equal(r.selectedKey, undefined); assert.equal(r.candidates.length, 0);
  });
  it('decision records contain no identifiers or content', () => {
    const r = f.buildDecisionRecord({ ...base, decisionId: 'd3', serveId: 's3', outcome: 'served', ranked, session: f.extractSessionFeatures(raw, { now }) });
    const json = JSON.stringify(r);
    for (const bad of ['studentKey', 'sessionKey', 'sessionId', 'STUDENT-ID-1', 'a@b.test', 'Ada', 'SECRET STEM', '"c0"', '"title":', '"description":', '"url":']) {
      assert.equal(json.includes(bad), false, bad);
    }
  });
  it('export record: flat JSONL shape, label only for served ads, no _id', () => {
    const doc = { ...f.buildDecisionRecord({ ...base, decisionId: 'd4', serveId: 's4', outcome: 'served', ranked }), _id: 'x', label: { impression: true, visibleMs: 2200, click: true, whatsappClick: false, skip: false } };
    const out = f.toExportRecord(doc);
    assert.equal(out._id, undefined);
    assert.deepEqual(out.label, { impression: true, visibleMs: 2200, click: true, whatsappClick: false, skip: false });
    assert.equal(f.toExportRecord({ ...doc, outcome: 'no_ad', noAdReason: 'no_eligible_campaign' }).label, null);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
  });
});

describe('centralized identity helpers', async () => {
  const id = await import('../src/utils/identity.js');
  const { verifyPkce, challengeFor } = await import('../src/utils/pkce.js');
  const { withMinDuration } = await import('../src/utils/timing.js');
  const { planMembership } = await import('../src/scripts/migrate-memberships.js').catch(() => ({}));

  it('derives memberships from the legacy role until the migration runs', () => {
    assert.ok(id.hasMembership({ role: 'student' }, 'student'));
    assert.ok(id.hasMembership({ role: 'advertiser' }, 'ads', 'advertiser'));
    assert.equal(id.hasMembership({ role: 'advertiser' }, 'student'), false);
    assert.equal(id.hasMembership({ role: 'admin' }, 'student'), false); // admin roles stay global
  });
  it('real memberships win, and one account can hold several products', () => {
    const u = { role: 'student', memberships: [{ product: 'student', role: 'student' }, { product: 'ads', role: 'advertiser' }] };
    assert.ok(id.hasMembership(u, 'student') && id.hasMembership(u, 'ads'));
    assert.equal(id.hasMembership(u, 'ads', 'analyst'), false); // role within the product is checked
    assert.equal(id.defaultActiveProduct(u, 'ads'), 'ads');
    assert.equal(id.defaultActiveProduct(u, 'bogus'), 'student'); // invalid context falls back
    assert.equal(id.defaultActiveProduct({ role: 'admin' }), null);
  });
  it('only known products are joinable', () => {
    assert.ok(id.isJoinable('ads') && id.isJoinable('student') && id.isJoinable('everybody'));
    const u = { role: 'student', memberships: [{ product: 'everybody', role: 'organizer' }] };
    assert.ok(id.hasMembership(u, 'everybody', 'organizer'));
    assert.equal(id.hasMembership(u, 'student'), false);
    assert.equal(id.defaultActiveProduct(u), 'everybody');
    assert.equal(id.isJoinable('crypto'), false);
    assert.equal(id.isProduct('__proto__'), false);
  });
  it('student filter is membership-based with a legacy-role fallback', () => {
    const q = id.studentQuery({ isPostUtmePaid: true });
    assert.equal(q.isPostUtmePaid, true);
    assert.deepEqual(q.$and, [id.STUDENT_FILTER]);
    assert.deepEqual(id.studentQuery({ $and: [{ a: 1 }] }).$and.length, 2);
  });
  it('PKCE S256 (RFC 7636 test vector) and rejection of wrong/short verifiers', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    assert.equal(challengeFor(verifier), challenge);
    assert.ok(verifyPkce(verifier, challenge));
    assert.equal(verifyPkce(`${verifier}x`, challenge), false);
    assert.equal(verifyPkce('short', challenge), false);
    assert.equal(verifyPkce(verifier, 'nope'), false);
  });
  it('withMinDuration never answers sooner than the floor', async () => {
    const t = Date.now();
    await withMinDuration(120, async () => 'x');
    assert.ok(Date.now() - t >= 115);
  });
  it('migration plan: roles → memberships, idempotent, no linking on unverified email', () => {
    assert.ok(planMembership, 'script exports planMembership');
    assert.deepEqual(planMembership({ role: 'student', createdAt: new Date(0) }, false).memberships.map((m) => m.product), ['student']);
    const adv = planMembership({ role: 'advertiser', isEmailVerified: true }, true);
    assert.deepEqual(adv.memberships.map((m) => m.product), ['ads']);
    assert.equal(adv.set.role, 'student');
    assert.equal(planMembership({ role: 'student', memberships: [{ product: 'student' }] }, false).action, 'skip'); // idempotent
    assert.equal(planMembership({ role: 'admin' }, false).action, 'skip');
    assert.equal(planMembership({ role: 'admin', isEmailVerified: false }, true).action, 'review'); // ads profile on unverified email
    assert.deepEqual(planMembership({ role: 'student', isEmailVerified: true }, true).memberships.map((m) => m.product), ['student', 'ads']);
  });
});

describe('CSRF origin protection', async () => {
  const { config } = await import('../src/config/env.js');
  const { csrfProtect } = await import('../src/middleware/csrf.js');
  const run = (req) => new Promise((resolve) => {
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    csrfProtect({ method: 'POST', originalUrl: '/api/x', cookies: {}, ...req, get: (h) => headers[h.toLowerCase()] }, {}, resolve);
  });
  it('rejects unsafe requests from unknown origins; allows allow-listed, missing origin and safe methods', async () => {
    assert.equal((await run({ headers: { Origin: 'https://evil.example' } })).code, 'CSRF_ORIGIN');
    assert.equal(await run({ headers: { Origin: config.CLIENT_URL } }), undefined);
    assert.equal(await run({ headers: {} }), undefined); // non-browser client
    assert.equal(await run({ method: 'GET', headers: { Origin: 'https://evil.example' } }), undefined);
    assert.equal(await run({ originalUrl: '/api/ads/payments/webhook', headers: { Origin: 'https://evil.example' } }), undefined);
  });
});
