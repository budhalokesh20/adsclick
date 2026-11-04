CREATE EXTENSION IF NOT EXISTS citext;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'RESTRICTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "public"."DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "public"."PayoutType" AS ENUM ('CPM', 'CPA', 'CPC');

-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('IMPRESSION', 'ENGAGEMENT', 'REVENUE', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "public"."ValidationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."SettlementStatus" AS ENUM ('PENDING', 'ALLOCATED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."RevenueType" AS ENUM ('PROVIDER_REVENUE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "public"."RevenueStatus" AS ENUM ('RECEIVED', 'COMMITTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."TxnType" AS ENUM ('AD_REWARD', 'REFERRAL_REWARD', 'WITHDRAWAL_HOLD', 'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_REJECTION', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "public"."TxnDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "public"."TxnStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."WithdrawalStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethodType" AS ENUM ('MOCK', 'BANK', 'PAYPAL', 'CRYPTO');

-- CreateEnum
CREATE TYPE "public"."MethodStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."ReferralRelStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."ReferralRewardType" AS ENUM ('SIGNUP_BONUS', 'FIRST_VERIFIED_IMPRESSION');

-- CreateEnum
CREATE TYPE "public"."RewardStatus" AS ENUM ('PENDING', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('EARNING', 'WALLET', 'WITHDRAWAL', 'REFERRAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."FraudStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."SettingValueType" AS ENUM ('NUMBER', 'STRING', 'BOOLEAN', 'JSON');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "last_ip" TEXT,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "country_code" CHAR(2),
    "locale" TEXT,
    "notification_prefs" JSONB NOT NULL DEFAULT '{"earnings":true,"withdrawals":true,"marketing":false}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_device_id" TEXT NOT NULL,
    "platform" "public"."DevicePlatform" NOT NULL,
    "model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "push_token" TEXT,
    "last_seen_at" TIMESTAMPTZ,
    "status" "public"."DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "replaced_by_session_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_user_roles" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "admin_role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "public"."ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "value_type" "public"."SettingValueType" NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_admin_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."advertising_providers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "callback_secret_enc" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "advertising_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."advertising_campaigns" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "payout_type" "public"."PayoutType" NOT NULL,
    "payout_amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "event_filters" JSONB,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "advertising_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."advertisement_events" (
    "id" UUID NOT NULL,
    "event_uuid" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "campaign_id" UUID,
    "advertisement_external_id" TEXT,
    "user_id" UUID,
    "device_id" UUID,
    "event_type" "public"."EventType" NOT NULL,
    "event_key" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "validation_status" "public"."ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "provider_reference" TEXT,
    "risk_score" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verified_impressions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "impression_at" TIMESTAMPTZ NOT NULL,
    "revenue_gross" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "settlement_status" "public"."SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."revenue_events" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "verified_impression_id" UUID,
    "type" "public"."RevenueType" NOT NULL,
    "gross_amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "public"."RevenueStatus" NOT NULL DEFAULT 'RECEIVED',
    "recognized_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance_available" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "balance_pending" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lifetime_earned" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total_withdrawn" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "txn_type" "public"."TxnType" NOT NULL,
    "direction" "public"."TxnDirection" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "public"."TxnStatus" NOT NULL DEFAULT 'COMPLETED',
    "balance_after_available" DECIMAL(20,6) NOT NULL,
    "balance_after_pending" DECIMAL(20,6) NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "idempotency_key" TEXT,
    "description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciled_at" TIMESTAMPTZ,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."revenue_allocations" (
    "id" UUID NOT NULL,
    "verified_impression_id" UUID NOT NULL,
    "revenue_event_id" UUID,
    "user_id" UUID NOT NULL,
    "gross_revenue" DECIMAL(20,6) NOT NULL,
    "user_share_pct" DECIMAL(5,2) NOT NULL,
    "platform_share_pct" DECIMAL(5,2) NOT NULL,
    "user_amount" DECIMAL(20,6) NOT NULL,
    "platform_amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "public"."SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ,

    CONSTRAINT "revenue_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_type" "public"."PaymentMethodType" NOT NULL,
    "label" TEXT,
    "account_details_enc" TEXT NOT NULL,
    "status" "public"."MethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."withdrawal_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "payment_method_id" UUID,
    "status" "public"."WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "fee_amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "hold_txn_id" UUID,
    "payout_txn_id" UUID,
    "review_note" TEXT,
    "reviewed_by_admin_id" UUID,
    "risk_flags" JSONB,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,
    "processed_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."referral_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."referral_relationships" (
    "id" UUID NOT NULL,
    "referrer_user_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "code_used" TEXT NOT NULL,
    "status" "public"."ReferralRelStatus" NOT NULL DEFAULT 'PENDING',
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."referral_rewards" (
    "id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "reward_type" "public"."ReferralRewardType" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "public"."RewardStatus" NOT NULL DEFAULT 'PENDING',
    "wallet_txn_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fraud_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "rule_code" TEXT NOT NULL,
    "severity" "public"."FraudSeverity" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "public"."FraudStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "fraud_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "public"."user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_external_device_id_key" ON "public"."devices"("user_id", "external_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "public"."user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_replaced_by_session_id_key" ON "public"."user_sessions"("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "public"."user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "public"."admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_code_key" ON "public"."admin_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_roles_admin_user_id_admin_role_id_key" ON "public"."admin_user_roles"("admin_user_id", "admin_role_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_created_at_idx" ON "public"."audit_logs"("actor_type", "actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "public"."audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "public"."system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "advertising_providers_code_key" ON "public"."advertising_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "advertising_campaigns_provider_id_external_campaign_id_key" ON "public"."advertising_campaigns"("provider_id", "external_campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "advertisement_events_event_uuid_key" ON "public"."advertisement_events"("event_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "advertisement_events_event_key_key" ON "public"."advertisement_events"("event_key");

-- CreateIndex
CREATE INDEX "advertisement_events_user_id_created_at_idx" ON "public"."advertisement_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "advertisement_events_validation_status_processed_at_idx" ON "public"."advertisement_events"("validation_status", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "verified_impressions_event_id_key" ON "public"."verified_impressions"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_events_verified_impression_id_key" ON "public"."revenue_events"("verified_impression_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "public"."wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "public"."wallet_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "public"."wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "public"."wallet_transactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_allocations_verified_impression_id_key" ON "public"."revenue_allocations"("verified_impression_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_allocations_revenue_event_id_key" ON "public"."revenue_allocations"("revenue_event_id");

-- CreateIndex
CREATE INDEX "withdrawal_requests_user_id_created_at_idx" ON "public"."withdrawal_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_idx" ON "public"."withdrawal_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_user_id_key" ON "public"."referral_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "public"."referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_relationships_referred_user_id_key" ON "public"."referral_relationships"("referred_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_relationships_referrer_user_id_referred_user_id_key" ON "public"."referral_relationships"("referrer_user_id", "referred_user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "public"."notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "fraud_events_status_created_at_idx" ON "public"."fraud_events"("status", "created_at");

-- AddForeignKey
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "public"."user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_role_id_fkey" FOREIGN KEY ("admin_role_id") REFERENCES "public"."admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."system_settings" ADD CONSTRAINT "system_settings_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."advertising_campaigns" ADD CONSTRAINT "advertising_campaigns_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."advertising_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."advertisement_events" ADD CONSTRAINT "advertisement_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."advertising_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."advertisement_events" ADD CONSTRAINT "advertisement_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."advertising_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."advertisement_events" ADD CONSTRAINT "advertisement_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."advertisement_events" ADD CONSTRAINT "advertisement_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verified_impressions" ADD CONSTRAINT "verified_impressions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."advertisement_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verified_impressions" ADD CONSTRAINT "verified_impressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verified_impressions" ADD CONSTRAINT "verified_impressions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."advertising_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_events" ADD CONSTRAINT "revenue_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."advertising_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_events" ADD CONSTRAINT "revenue_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."advertising_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_events" ADD CONSTRAINT "revenue_events_verified_impression_id_fkey" FOREIGN KEY ("verified_impression_id") REFERENCES "public"."verified_impressions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_allocations" ADD CONSTRAINT "revenue_allocations_verified_impression_id_fkey" FOREIGN KEY ("verified_impression_id") REFERENCES "public"."verified_impressions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_allocations" ADD CONSTRAINT "revenue_allocations_revenue_event_id_fkey" FOREIGN KEY ("revenue_event_id") REFERENCES "public"."revenue_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."revenue_allocations" ADD CONSTRAINT "revenue_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_hold_txn_fkey" FOREIGN KEY ("hold_txn_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payout_txn_fkey" FOREIGN KEY ("payout_txn_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referral_codes" ADD CONSTRAINT "referral_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referral_relationships" ADD CONSTRAINT "referral_relationships_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referral_relationships" ADD CONSTRAINT "referral_relationships_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referral_rewards" ADD CONSTRAINT "referral_rewards_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "public"."referral_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fraud_events" ADD CONSTRAINT "fraud_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fraud_events" ADD CONSTRAINT "fraud_events_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain-level integrity constraints (complement Prisma schema)
ALTER TABLE wallets ADD CONSTRAINT wallets_balance_available_nonneg CHECK (balance_available >= 0);
ALTER TABLE wallets ADD CONSTRAINT wallets_balance_pending_nonneg CHECK (balance_pending >= 0);
ALTER TABLE wallets ADD CONSTRAINT wallets_lifetime_earned_nonneg CHECK (lifetime_earned >= 0);
ALTER TABLE wallets ADD CONSTRAINT wallets_total_withdrawn_nonneg CHECK (total_withdrawn >= 0);
ALTER TABLE referral_relationships ADD CONSTRAINT referral_relationships_no_self CHECK (referrer_user_id <> referred_user_id);

-- One active withdrawal per user
CREATE UNIQUE INDEX withdrawal_requests_one_active_idx ON withdrawal_requests(user_id)
  WHERE status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING');
