import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { MockAdProvider } from '../../src/services/ad-provider/mock.provider.js';

describe('MockAdProvider revenue math', () => {
  const provider = new MockAdProvider();

  it('converts a CPM payout to a per-impression share', async () => {
    const revenue = await provider.resolveRevenue({
      campaignId: 'c1',
      providerId: 'p1',
      payoutType: 'CPM',
      payoutAmount: new Decimal(2.5),
      currency: 'USD',
    });
    expect(revenue).not.toBeNull();
    expect(revenue!.currency).toBe('USD');
    expect(revenue!.grossUsd.toString()).toBe('0.0025');
  });

  it('returns null for non-CPM payout models', async () => {
    const revenue = await provider.resolveRevenue({
      campaignId: 'c1',
      providerId: 'p1',
      payoutType: 'CPA',
      payoutAmount: new Decimal(1),
      currency: 'USD',
    });
    expect(revenue).toBeNull();
  });

  it('compares 2.50/1000 exactly without float drift', () => {
    const gross = new Decimal(2.5).dividedBy(1000);
    expect(gross.plus(0.0025).minus(0.005).toString()).toBe('0');
  });
});
