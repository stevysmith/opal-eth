import { AgentKit } from '@coinbase/agentkit';
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";

interface AgentKitConfig {
  apiKey: string;
  apiSecret: string;
}

class CoinbaseService {
  private agentKit: AgentKit;
  private config: AgentKitConfig;

  constructor(config: AgentKitConfig) {
    this.config = config;
    this.agentKit = AgentKit.initialize({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      environment: 'PRODUCTION'
    });
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      // Create a new MPC wallet for the agent using the appropriate method
      const wallet = await this.agentKit.createMPCWallet();

      // Store wallet details in database
      await db.insert(mpcWallets).values({
        agentId,
        walletId: wallet.id,
        createdAt: new Date(),
      });

      return wallet.id;
    } catch (error) {
      console.error('Error creating MPC wallet:', error);
      throw new Error('Failed to create MPC wallet');
    }
  }

  async getWalletBalance(walletId: string): Promise<string> {
    try {
      const balance = await this.agentKit.getWalletBalance({
        walletId,
        currency: 'USDC'
      });
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      const transaction = await this.agentKit.createTransaction({
        fromWalletId,
        toAddress,
        amount,
        currency: 'USDC'
      });

      return transaction.id;
    } catch (error) {
      console.error('Error sending USDC:', error);
      throw new Error('Failed to send USDC');
    }
  }

  async getWalletForAgent(agentId: number): Promise<string | null> {
    const [wallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, agentId))
      .limit(1);

    return wallet?.walletId || null;
  }
}

// Create singleton instance with environment variables
const coinbaseService = new CoinbaseService({
  apiKey: process.env.COINBASE_AGENTKIT_API_KEY!,
  apiSecret: process.env.COINBASE_AGENTKIT_API_SECRET!,
});

export default coinbaseService;