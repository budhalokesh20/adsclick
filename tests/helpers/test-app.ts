import { createApp } from '../../src/app.js';
import { prisma } from '../../src/database/prisma.js';

export { createApp, prisma };

export async function resetDatabase(): Promise<void> {
  // Wipe dynamic data between suites, preserving schema.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "user_sessions", "devices", "referral_relationships", "referral_codes",
    "notifications", "referral_rewards", "wallet_transactions", "withdrawal_requests",
    "payment_methods", "revenue_allocations", "revenue_events", "verified_impressions",
    "advertisement_events", "advertising_campaigns", "user_profiles", "wallets", "users"
    RESTART IDENTITY CASCADE`);
}
