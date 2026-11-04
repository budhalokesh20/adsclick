-- AlterTable
ALTER TABLE "public"."payout_methods" ADD COLUMN     "fee_amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;
