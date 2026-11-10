process.env.NODE_ENV = 'test';
process.env.TRIAL_DISABLED = 'true';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

describe('changing the free address (integration)', { skip }, () => {
  let addDomain; let listDomains; let findSiteByHostname; let Organization;
  before(async () => {
    await mongoose.connect(URI);
    ({ addDomain, listDomains } = await import('../src/services/orgDomain.service.js'));
    ({ findSiteByHostname } = await import('../src/services/orgSite.service.js'));
    ({ Organization } = await import('../src/models/Organization.js'));
  });
  after(async () => { await mongoose.disconnect(); });

  it('a new free address replaces the old one, which stops resolving', async () => {
    const tag = Date.now().toString(36);
    const org = await Organization.create({ name: 'Old', slug: `old${tag}`, ownerUser: new mongoose.Types.ObjectId() });
    await addDomain(org, { type: 'subdomain', hostname: `first${tag}.testflow.com.ng` });
    assert.ok(await findSiteByHostname(`first${tag}.testflow.com.ng`));
    await addDomain(org, { type: 'subdomain', hostname: `second${tag}.testflow.com.ng` });
    const { items } = await listDomains(org._id);
    assert.deepEqual(items.map((d) => d.hostname), [`second${tag}.testflow.com.ng`]);
    assert.ok(await findSiteByHostname(`second${tag}.testflow.com.ng`));
    assert.equal(await findSiteByHostname(`first${tag}.testflow.com.ng`), null);
    assert.equal(await findSiteByHostname(`old${tag}.testflow.com.ng`), null);
  });
});
