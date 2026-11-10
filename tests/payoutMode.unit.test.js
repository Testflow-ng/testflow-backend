import './_env.test.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('payout mode is direct', () => {
  it('reports direct and refuses withdrawals', async () => {
    const { payoutMode } = await import('../src/config/payoutMode.js');
    assert.equal(payoutMode(), 'direct');
    const { toPayoutView } = await import('../src/services/orgMoney.service.js');
    assert.equal(toPayoutView({ status: 'active' }).mode, 'direct');
    const { requestWithdrawal } = await import('../src/services/orgWithdrawal.service.js');
    await assert.rejects(requestWithdrawal('64b000000000000000000001', '64b000000000000000000002', { amountKobo: 500000 }), { code: 'WITHDRAWALS_OFF' });
  });
});
