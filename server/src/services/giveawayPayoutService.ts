import { eq } from 'drizzle-orm';
import { db } from '@db';
import { giveaways, giveawayEntries } from '@db/schema';
import coinbaseService from '../coinbase/agentKit';

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

    // Get winner's wallet address from giveaway entries
    const [winnerEntry] = await db
      .select()
      .from(giveawayEntries)
      .where(eq(giveawayEntries.userId, winnerId))
      .limit(1);

    if (!winnerEntry?.walletAddress) {
      throw new Error('Winner has no wallet address configured. They need to set up their wallet address first.');
    }

    // Get or create MPC wallet for the agent
    let walletId = await coinbaseService.getWalletForAgent(giveaway.agentId);
    if (!walletId) {
      walletId = await coinbaseService.createMpcWallet(giveaway.agentId);
    }

    // Verify agent has sufficient balance
    const balance = await coinbaseService.getWalletBalance(walletId);
    const defaultAmount = '10'; // Default 10 USDC for testing

    if (parseFloat(balance) < parseFloat(defaultAmount)) {
      throw new Error(`Insufficient USDC balance. Available: ${balance} USDC, Required: ${defaultAmount} USDC`);
    }

    try {
      const txHash = await coinbaseService.sendUsdc(walletId, winnerEntry.walletAddress, defaultAmount);

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
    let walletId = await coinbaseService.getWalletForAgent(agentId);
    if (!walletId) {
      walletId = await coinbaseService.createMpcWallet(agentId);
    }
    return coinbaseService.getWalletBalance(walletId);
  }
}

export const giveawayPayoutService = new GiveawayPayoutService();