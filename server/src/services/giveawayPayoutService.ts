import { db } from "@db";
import { giveaways, giveawayEntries } from "@db/schema";
import { eq } from "drizzle-orm";
import coinbaseService from "../coinbase/agentKit";

class GiveawayPayoutService {
  async processGiveawayWinner(giveawayId: number, winnerId: string) {
    try {
      // Get giveaway details
      const [giveaway] = await db
        .select()
        .from(giveaways)
        .where(eq(giveaways.id, giveawayId))
        .limit(1);

      if (!giveaway) {
        throw new Error("Giveaway not found");
      }

      // Get winner's wallet address
      const [winnerEntry] = await db
        .select()
        .from(giveawayEntries)
        .where(eq(giveawayEntries.giveawayId, giveawayId))
        .where(eq(giveawayEntries.userId, winnerId))
        .limit(1);

      if (!winnerEntry?.walletAddress) {
        throw new Error("Winner wallet address not found");
      }

      // Parse prize amount (assuming prize is in format "X USDC")
      const amount = giveaway.prize.split(" ")[0];

      // Send USDC directly to the winner
      const txHash = await coinbaseService.sendUsdc(
        winnerEntry.walletAddress,
        amount,
      );

      // Update giveaway with winner
      await db
        .update(giveaways)
        .set({ winnerId })
        .where(eq(giveaways.id, giveawayId));

      return {
        amount,
        txHash,
        winnerAddress: winnerEntry.walletAddress,
      };
    } catch (error) {
      console.error("Error processing giveaway winner:", error);
      throw error;
    }
  }
}

export const giveawayPayoutService = new GiveawayPayoutService();
