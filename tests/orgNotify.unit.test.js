import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

describe('Everybody mail — organisation sender', () => {
  it('uses the organisation name with the TestFlow address', async () => {
    const { senderFor } = await import('../src/services/email.service.js');
    assert.equal(senderFor('Lagos Academy'), '"Lagos Academy" <hello@testflow.com.ng>');
  });

  it('strips characters that could break out of the header', async () => {
    const { senderFor } = await import('../src/services/email.service.js');
    const line = senderFor('Evil"\r\nBcc: x@y.z <a@b.c>');
    assert.ok(!/[\r\n]/.test(line));
    assert.match(line, /^"[^"<>]*" <hello@testflow\.com\.ng>$/);
  });

  it('falls back to the default sender with no name', async () => {
    const { senderFor } = await import('../src/services/email.service.js');
    assert.equal(senderFor(), 'Testflow <hello@testflow.com.ng>');
  });
});
