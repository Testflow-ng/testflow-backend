import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scopedFilter, assertScoped, orgRoleAllowed, orgRoleRank, scoped,
} from '../src/utils/orgScope.js';
import { createOrgSchema, inviteSchema, RESERVED_SLUGS } from '../src/validators/everybody.schema.js';

describe('orgScope helpers (unit)', () => {
  it('scopedFilter forces the gate org id over any client value', () => {
    assert.deepEqual(scopedFilter('orgA', { organization: 'evil', x: 1 }), { x: 1, organization: 'orgA' });
  });

  it('assertScoped throws on unscoped tenant queries (default-deny)', () => {
    assert.throws(() => assertScoped({ role: 'admin' }), /without an organization condition/);
    assert.throws(() => assertScoped({}), /without an organization condition/);
    assert.doesNotThrow(() => assertScoped({ organization: 'orgA' }));
    assert.doesNotThrow(() => assertScoped({ $and: [{ x: 1 }, { organization: 'orgA' }] }));
  });

  it('role checks are exact-match (no hierarchy escalation)', () => {
    assert.equal(orgRoleAllowed('examiner', ['owner', 'admin']), false);
    assert.equal(orgRoleAllowed('admin', ['owner', 'admin']), true);
    assert.ok(orgRoleRank('owner') > orgRoleRank('admin'));
    assert.ok(orgRoleRank('admin') > orgRoleRank('examiner'));
    assert.ok(orgRoleRank('examiner') > orgRoleRank('student'));
  });

  it('scoped() always injects organization into filters', () => {
    const calls = [];
    const Fake = { find: (f) => { calls.push(f); return []; } };
    scoped(Fake, 'orgA').find({ role: 'student' });
    assert.deepEqual(calls[0], { role: 'student', organization: 'orgA' });
  });
});

describe('everybody validators (unit)', () => {
  it('rejects reserved subdomains at the service layer list level', () => {
    for (const s of ['api', 'admin', 'ads', 'www', 'login']) assert.ok(RESERVED_SLUGS.includes(s), s);
  });

  it('createOrg: name too short and bad slug are 422-shaped', () => {
    const bad = createOrgSchema.safeParse({ body: { name: 'A', slug: 'Bad Slug!' } });
    assert.equal(bad.success, false);
    const ok = createOrgSchema.safeParse({ body: { name: 'Advance Academy' } });
    assert.equal(ok.success, true);
  });

  it('invite: owner role cannot be invited (must start lower)', () => {
    const bad = inviteSchema.safeParse({ params: { organizationId: '507f1f77bcf86cd799439011' }, body: { email: 'a@b.co', role: 'owner' } });
    assert.equal(bad.success, false);
    const ok = inviteSchema.safeParse({ params: { organizationId: '507f1f77bcf86cd799439011' }, body: { email: 'a@b.co', role: 'examiner' } });
    assert.equal(ok.success, true);
  });
});
