-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_relationship_id_reward_type_key" ON "public"."referral_rewards"("relationship_id", "reward_type");
