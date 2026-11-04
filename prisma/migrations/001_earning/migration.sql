-- CreateEnum
CREATE TYPE "public"."EarningStatus" AS ENUM ('DISABLED', 'ENABLING', 'ACTIVE', 'PAUSED', 'RESTRICTED', 'ERROR');

-- CreateTable
CREATE TABLE "public"."user_earning_states" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "public"."EarningStatus" NOT NULL DEFAULT 'DISABLED',
    "enabled_at" TIMESTAMPTZ,
    "paused_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_earning_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_earning_states_user_id_key" ON "public"."user_earning_states"("user_id");

-- AddForeignKey
ALTER TABLE "public"."user_earning_states" ADD CONSTRAINT "user_earning_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
