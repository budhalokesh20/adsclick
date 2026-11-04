import { Decimal } from 'decimal.js';
import { prisma } from '../../database/prisma.js';
import type { AdPayload, AdRequestContext, CampaignContext, EventValidation, IAdProvider, ProviderRevenue, RawAdEvent } from './types.js';

const EVENT_TYPES = new Set(['IMPRESSION', 'ENGAGEMENT', 'REVENUE']);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * MockAdProvider — development/testing only.
 *
 * Simulates the full advertisement lifecycle with deterministic creatives and
 * a configured CPM. It never claims real advertising revenue: rows produced by
 * this provider are flagged via `sandbox` on the provider record and are never
 * treated as withdrawable money (wallet allocation ships in Phase 5, still
 * gated by sandbox semantics).
 */
export class MockAdProvider implements IAdProvider {
  readonly id = 'mock';

  private async activeCampaigns() {
    return prisma.advertisingCampaign.findMany({
      where: {
        provider: { code: 'mock', status: 'ACTIVE' },
        status: 'ACTIVE',
        startsAt: { lte: new Date() },
        endsAt: { gte: new Date() },
      },
      include: { provider: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async loadAd(_ctx: AdRequestContext): Promise<AdPayload | null> {
    const campaigns = await this.activeCampaigns();
    if (campaigns.length === 0) return null;

    const campaign = campaigns[Math.floor(Math.random() * campaigns.length)]!;
    const creatives = (campaign.provider.config as { creatives?: string[] })?.creatives ?? [];
    const creativeId = creatives[Math.floor(Math.random() * creatives.length)] ?? 'ad-001';

    return {
      provider: this.id,
      campaignExternalId: campaign.externalCampaignId,
      advertisementExternalId: creativeId,
      headline: `Sponsored creative ${creativeId}`,
      creativeUrl: `https://mock.adshare.local/creatives/${creativeId}.png`,
      ctaText: 'Learn more',
    };
  }

  async validateEvent(raw: RawAdEvent): Promise<EventValidation> {
    if (!EVENT_TYPES.has(raw.eventType)) {
      return { ok: false, reason: 'unsupported_event_type' };
    }

    const occurred = new Date(raw.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      return { ok: false, reason: 'invalid_occurred_at' };
    }
    if (Date.now() - occurred.getTime() > MAX_AGE_MS) {
      return { ok: false, reason: 'event_too_old' };
    }

    const campaign = await prisma.advertisingCampaign.findFirst({
      where: {
        externalCampaignId: raw.campaignExternalId,
        provider: { code: raw.provider },
      },
      include: { provider: true },
    });
    if (!campaign) {
      return { ok: false, reason: 'unknown_campaign' };
    }
    if (campaign.provider.code !== this.id) {
      return { ok: false, reason: 'provider_mismatch' };
    }
    if (campaign.status !== 'ACTIVE') {
      return { ok: false, reason: 'campaign_not_active' };
    }

    const creatives = (campaign.provider.config as { creatives?: string[] })?.creatives ?? [];
    if (!creatives.includes(raw.advertisementExternalId)) {
      return { ok: false, reason: 'unknown_creative' };
    }

    return { ok: true };
  }

  async resolveRevenue(campaign: CampaignContext): Promise<ProviderRevenue | null> {
    if (campaign.payoutType !== 'CPM') return null;
    // Model a single impression's share of a CPM (per-1000) payout.
    const gross = new Decimal(campaign.payoutAmount).dividedBy(1000);
    return { grossUsd: gross, currency: campaign.currency };
  }
}
