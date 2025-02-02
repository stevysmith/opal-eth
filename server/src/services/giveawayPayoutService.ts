import { eq } from 'drizzle-orm';
import { db } from '@db';
import { giveaways, giveawayEntries, users } from '@db/schema';
import { createUSDCPaymentService } from '../coinbase/agentKit';

export class GiveawayPayoutService {
  async processGiveawayWinner(giveawayId: number, winnerId: string) {
    // Get giveaway details
    const [giveaway] = await db
      .select()
      .from(giveaways)
      .where(eq(giveaways.id, giveawayId))
      .limit(1);

    if (!giveaway) {
      throw new Error('Giveaway not found');
    }

    // Get winner's wallet address
    // Note: winnerId here is the platform-specific user ID (Telegram/Discord)
    const [winnerEntry] = await db
      .select({
        user: users,
        entry: giveawayEntries
      })
      .from(giveawayEntries)
      .where(eq(giveawayEntries.userId, winnerId))
      .leftJoin(users, eq(users.username, giveawayEntries.userId))
      .limit(1);

    if (!winnerEntry?.user?.walletAddress) {
      throw new Error('Winner has no wallet address configured. They need to set up their wallet address first.');
    }

    // Initialize payment service
    const paymentService = await createUSDCPaymentService(giveaway.agentId);

    // Verify agent has sufficient balance
    const balance = await paymentService.getBalance();
    const defaultAmount = '10'; // Default 10 USDC for testing

    if (parseFloat(balance) < parseFloat(defaultAmount)) {
      throw new Error(`Insufficient USDC balance. Available: ${balance} USDC, Required: ${defaultAmount} USDC`);
    }

    try {
      const txHash = await paymentService.sendUsdc(winnerEntry.user.walletAddress, defaultAmount);

      // Update giveaway with winner
      await db.update(giveaways)
        .set({ winnerId })
        .where(eq(giveaways.id, giveawayId));

      return {
        success: true,
        txHash,
        amount: defaultAmount,
        winner: winnerId,
      };
    } catch (error) {
      console.error('Failed to process payout:', error);
      throw new Error('Failed to process USDC payout. Please check agent wallet balance and configuration.');
    }
  }

  async getGiveawayBalance(agentId: number): Promise<string> {
    const paymentService = await createUSDCPaymentService(agentId);
    return paymentService.getBalance();
  }
}

export const giveawayPayoutService = new GiveawayPayoutService();