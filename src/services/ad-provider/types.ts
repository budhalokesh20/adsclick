import type { Decimal } from 'decimal.js';

export interface AdRequestContext {
  userId: string;
  deviceId?: string | null;
}

export interface AdPayload {
  provider: string;
  campaignExternalId: string;
  advertisementExternalId: string;
  headline: string;
  creativeUrl: string;
  ctaText?: string;
}

export type AdEventType = 'IMPRESSION' | 'ENGAGEMENT' | 'REVENUE';

export interface RawAdEvent {
  eventUuid: string;
  provider: string;
  campaignExternalId: string;
  advertisementExternalId: string;
  eventType: AdEventType;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface EventValidation {
  ok: boolean;
  reason?: string;
}

export interface ProviderRevenue {
  grossUsd: Decimal;
  currency: string;
}

export interface CampaignContext {
  campaignId: string;
  providerId: string;
  payoutType: 'CPM' | 'CPA' | 'CPC';
  payoutAmount: Decimal;
  currency: string;
}

/**
 * Provider-agnostic advertising interface.
 * Adapters must be independent: adding a provider must never touch the
 * earning/wallet engines.
 */
export interface IAdProvider {
  readonly id: string;
  loadAd(ctx: AdRequestContext): Promise<AdPayload | null>;
  validateEvent(raw: RawAdEvent): Promise<EventValidation>;
  resolveRevenue(campaign: CampaignContext): Promise<ProviderRevenue | null>;
}
