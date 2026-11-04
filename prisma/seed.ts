import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/passwords.js';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS: Record<string, { value: unknown; valueType: 'NUMBER' | 'STRING' | 'BOOLEAN' | 'JSON'; isPublic: boolean }> = {
  revenue_share_pct: { value: 60, valueType: 'NUMBER', isPublic: true },
  platform_share_pct: { value: 40, valueType: 'NUMBER', isPublic: true },
  min_withdrawal_amount: { value: 10, valueType: 'NUMBER', isPublic: true },
  referral_signup_bonus: { value: 0, valueType: 'NUMBER', isPublic: true },
  referral_first_impression_reward: { value: 0, valueType: 'NUMBER', isPublic: true },
  referral_reward_currency: { value: 'USD', valueType: 'STRING', isPublic: true },
  earning_mode_enabled: { value: false, valueType: 'BOOLEAN', isPublic: true },
  settlement_mode: { value: 'instant', valueType: 'STRING', isPublic: true },
  withdrawal_fee_flat: { value: 0, valueType: 'NUMBER', isPublic: true },
  withdrawal_tax_pct: { value: 0, valueType: 'NUMBER', isPublic: true },
  fraud_thresholds: {
    value: { eventsPerMin: 120, duplicateRate: 0.3, maxDevicesPerUser: 5 },
    valueType: 'JSON',
    isPublic: false,
  },
  ad_provider_default: { value: 'mock', valueType: 'STRING', isPublic: true },
  device_info_required: { value: false, valueType: 'BOOLEAN', isPublic: true },
  device_info_enabled: { value: true, valueType: 'BOOLEAN', isPublic: true },
  overlay_approved: { value: false, valueType: 'BOOLEAN', isPublic: false },
};

const ROLES: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  FINANCE: ['finance.read', 'finance.write', 'withdrawals.manage', 'settings.finance'],
  SUPPORT: ['users.read', 'users.manage', 'fraud.manage'],
  ANALYST: ['analytics.read', 'users.read', 'finance.read'],
};

async function main(): Promise<void> {
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: def.value as never, valueType: def.valueType, isPublic: def.isPublic },
    });
  }

  for (const [code, permissions] of Object.entries(ROLES)) {
    await prisma.adminRole.upsert({
      where: { code },
      update: { name: code.replace('_', ' '), permissions: permissions as never },
      create: { code, name: code.replace('_', ' '), permissions: permissions as never },
    });
  }

  const adminEmail = env.ADMIN_SEED_EMAIL;
  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const superRole = await prisma.adminRole.findUnique({ where: { code: 'SUPER_ADMIN' } });
    if (!superRole) throw new Error('SUPER_ADMIN role missing');
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(env.ADMIN_SEED_PASSWORD),
        name: 'AdShare Administrator',
        roles: { create: { adminRoleId: superRole.id } },
      },
    });
    console.log(`Seeded admin user: ${admin.email} (password from ADMIN_SEED_PASSWORD)`);
  }

  await prisma.advertisingProvider.upsert({
    where: { code: 'mock' },
    update: {},
    create: {
      code: 'mock',
      name: 'Mock Ad Provider (sandbox)',
      sandbox: true,
      config: {
        creatives: ['ad-001', 'ad-002', 'ad-003', 'ad-004', 'ad-005'],
      },
    },
  });

  const mockProvider = await prisma.advertisingProvider.findUniqueOrThrow({ where: { code: 'mock' } });
  await prisma.advertisingCampaign.upsert({
    where: { providerId_externalCampaignId: { providerId: mockProvider.id, externalCampaignId: 'mock-campaign-001' } },
    update: {},
    create: {
      providerId: mockProvider.id,
      externalCampaignId: 'mock-campaign-001',
      name: 'Mock CPM Campaign (sandbox)',
      status: 'ACTIVE',
      payoutType: 'CPM',
      payoutAmount: 2.5,
      currency: 'USD',
      startsAt: new Date(Date.now() - 30 * 86_400_000),
      endsAt: new Date(Date.now() + 365 * 86_400_000),
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
