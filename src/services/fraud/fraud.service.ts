import { prisma } from '../../database/prisma.js';
import { logger } from '../../utils/logger.js';

interface FraudThresholds {
  eventsPerMin: number;
  duplicateRate: number;
  maxDevicesPerUser: number;
}

async function thresholds(): Promise<FraudThresholds> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'fraud_thresholds' } });
  const raw = row?.value as Partial<FraudThresholds> | null;
  return {
    eventsPerMin: Math.max(raw?.eventsPerMin ?? 120, 1),
    duplicateRate: raw?.duplicateRate ?? 0.3,
    maxDevicesPerUser: Math.max(raw?.maxDevicesPerUser ?? 5, 1),
  };
}

interface RiskResult {
  restricted: boolean;
  flagged: boolean;
}

/**
 * Heuristic fraud evaluation on event intake.
 * - velocity: too many events per minute for one user
 * - device churn: same user roaming across too many device ids
 *
 * Findings are persisted as `FraudEvent` rows. CRITICAL rule hits auto-restrict
 * the account (status RESTRICTED + Earning Mode RESTRICTED).
 */
export async function evaluateEventRisk(userId: string, deviceId?: string | null): Promise<RiskResult> {
  const t = await thresholds();
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000);

  const [recentCount, deviceCount] = await Promise.all([
    prisma.advertisementEvent.count({ where: { userId, receivedAt: { gte: minuteAgo } } }),
    deviceId ? prisma.device.count({ where: { userId, status: 'ACTIVE' } }) : Promise.resolve(0),
  ]);

  let restricted = false;
  let flagged = false;

  if (recentCount >= t.eventsPerMin) {
    flagged = true;
    const severity = recentCount >= t.eventsPerMin * 3 ? 'CRITICAL' : 'HIGH';
    await prisma.fraudEvent.create({
      data: {
        userId,
        ruleCode: 'events_velocity',
        severity,
        details: { eventsPerMin: recentCount, threshold: t.eventsPerMin } as never,
        status: 'OPEN',
      },
    });
    if (severity === 'CRITICAL') restricted = true;
  }

  if (deviceId && deviceCount > t.maxDevicesPerUser) {
    flagged = true;
    await prisma.fraudEvent.create({
      data: {
        userId,
        ruleCode: 'device_churn',
        severity: 'MEDIUM',
        details: { devices: deviceCount, threshold: t.maxDevicesPerUser } as never,
        status: 'OPEN',
      },
    });
  }

  if (restricted) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'RESTRICTED' } });
      await tx.userEarningState.updateMany({
        where: { userId },
        data: { status: 'RESTRICTED' },
      });
    });
    logger.warn({ userId, ruleCode: 'events_velocity' }, 'auto-restricted account by fraud rule');
  }

  return { restricted, flagged };
}
