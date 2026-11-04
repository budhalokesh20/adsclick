import { z } from 'zod';

export const adEventSchema = z.object({
  eventUuid: z.string().uuid(),
  provider: z.string().min(1).max(50),
  campaignExternalId: z.string().min(1).max(100),
  advertisementExternalId: z.string().min(1).max(100),
  eventType: z.enum(['IMPRESSION', 'ENGAGEMENT', 'REVENUE']),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type AdEventInput = z.infer<typeof adEventSchema>;
