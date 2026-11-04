-- AlterTable
ALTER TABLE "public"."payout_methods" ADD COLUMN     "min_payout" DECIMAL(20,6) NOT NULL DEFAULT 0;
