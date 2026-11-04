import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { MockAdProvider } from '../../services/ad-provider/mock.provider.js';
import type { IAdProvider, RawAdEvent } from '../../services/ad-provider/types.js';
import { allocateVerifiedImpression } from '../../services/finance/revenue-processor.js';
import { evaluateEventRisk } from '../../services/fraud/fraud.service.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { getEarningStatus } from '../earning/earning.service.js';
import type { AdEventInput } from './advertisements.schemas.js';

const providers = new Map<string, IAdProvider>([['mock', new MockAdProvider()]]);

function getProvider(code: string): IAdProvider | null {
  return providers.get(code) ?? null;
}

export async function assertEarningActive(userId: string): Promise<void> {
  const status = await getEarningStatus(userId);
  if (status.status !== 'ACTIVE') {
    throw forbidden('EARNING_NOT_ACTIVE', 'Earning Mode must be active for this action');
  }
}

export async function getAvailableAd(userId: string, deviceId?: string | null) {
  await assertEarningActive(userId);

  const providerCode = 'mock';
  const provider = getProvider(providerCode);
  if (!provider) throw notFound('Advertising provider unavailable');

  const ad = await provider.loadAd({ userId, deviceId });
  if (!ad) throw notFound('No advertisement available right now');
  return ad;
}

function eventKey(raw: RawAdEvent): string {
  return createHash('sha256')
    .update([raw.provider, raw.eventType, raw.campaignExternalId, raw.advertisementExternalId, raw.occurredAt].join('|'))
    .digest('hex');
}

export async function ingestAdEvent(userId: string, input: AdEventInput, deviceId?: string | null) {
  await assertEarningActive(userId);

  const existing = await prisma.advertisementEvent.findUnique({
    where: { eventUuid: input.eventUuid },
    select: { id: true, validationStatus: true },
  });
  if (existing) {
    return {
      accepted: true,
      eventId: existing.id,
      validationStatus: existing.validationStatus,
      duplicate: true,
    };
  }

  const provider = getProvider(input.provider);
  if (!provider) {
    throw badRequest('UNKNOWN_PROVIDER', 'Unsupported advertising provider');
  }

  const raw: RawAdEvent = {
    eventUuid: input.eventUuid,
    provider: input.provider,
    campaignExternalId: input.campaignExternalId,
    advertisementExternalId: input.advertisementExternalId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    payload: input.payload,
  };

  const validation = await provider.validateEvent(raw);
  const key = eventKey(raw);

  // Heuristic fraud screening (velocity/device churn; may auto-restrict).
  await evaluateEventRisk(userId, deviceId);

  try {
    const event = await prisma.advertisementEvent.create({
      data: {
        eventUuid: input.eventUuid,
        providerId: (await prisma.advertisingProvider.findUniqueOrThrow({ where: { code: input.provider } })).id,
        userId,
        deviceId: deviceId ?? null,
        eventType: validation.ok ? input.eventType : 'REJECTED',
        eventKey: key,
        rawPayload: raw as unknown as Prisma.InputJsonValue,
        validationStatus: validation.ok ? 'VERIFIED' : 'REJECTED',
        rejectionReason: validation.ok ? null : validation.reason ?? 'validation_failed',
        receivedAt: new Date(),
        processedAt: new Date(),
      },
      select: { id: true },
    });

    if (validation.ok && input.eventType === 'IMPRESSION') {
      const impression = await recordVerifiedImpression(event.id, userId, input);
      if (impression) {
        // Phase 5: commit the revenue split to the ledger (idempotent).
        await allocateVerifiedImpression(impression.id);
      }
    }

    return {
      accepted: true,
      eventId: event.id,
      validationStatus: validation.ok ? 'VERIFIED' : 'REJECTED',
      duplicate: false,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Lost a race: another request already processed this event.
      const winner = await prisma.advertisementEvent.findUnique({
        where: { eventUuid: input.eventUuid },
        select: { id: true, validationStatus: true },
      });
      if (winner) {
        return { accepted: true, eventId: winner.id, validationStatus: winner.validationStatus, duplicate: true };
      }
    }
    throw err;
  }
}

async function recordVerifiedImpression(
  eventId: string,
  userId: string,
  input: AdEventInput,
): Promise<{ id: string } | null> {
  const campaign = await prisma.advertisingCampaign.findFirst({
    where: { externalCampaignId: input.campaignExternalId },
    select: {
      id: true,
      payoutType: true,
      payoutAmount: true,
      currency: true,
      provider: { select: { id: true } },
    },
  });
  if (!campaign) return null;

  const provider = new MockAdProvider();
  const revenue = await provider.resolveRevenue({
    campaignId: campaign.id,
    providerId: campaign.provider.id,
    payoutType: campaign.payoutType,
    payoutAmount: new Decimal(campaign.payoutAmount.toString()),
    currency: campaign.currency,
  });

  const created = await prisma.$transaction(async (tx) => {
    const impression = await tx.verifiedImpression.create({
      data: {
        eventId,
        userId,
        campaignId: campaign.id,
        impressionAt: new Date(input.occurredAt),
        revenueGross: revenue ? revenue.grossUsd : new Decimal(0),
        currency: revenue?.currency ?? campaign.currency,
        settlementStatus: 'PENDING',
      },
      select: { id: true },
    });
    if (revenue) {
      await tx.revenueEvent.create({
        data: {
          providerId: campaign.provider.id,
          campaignId: campaign.id,
          verifiedImpressionId: impression.id,
          type: 'PROVIDER_REVENUE',
          grossAmount: revenue.grossUsd,
          currency: revenue.currency,
          status: 'RECEIVED',
          recognizedAt: new Date(),
        },
      });
    }
    return { id: impression.id };
  });
  return created;
}
