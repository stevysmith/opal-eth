import { AgentKit, Wallet } from '@coinbase/agentkit';
import { db } from '@db';
import { mpcWallets } from '@db/schema';
import { eq } from 'drizzle-orm';

// Initialize AgentKit with environment variables
export const initializeAgentKit = () => {
  if (!process.env.CDP_API_KEY_NAME || !process.env.CDP_API_KEY_PRIVATE_KEY) {
    throw new Error('Missing required Coinbase CDP API credentials');
  }

  return AgentKit.create({
    apiKeyName: process.env.CDP_API_KEY_NAME,
    privateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
  });
};

export class USDCPaymentService {
  private wallet: Wallet | null = null;
  private readonly agentId: number;
  private readonly agentKit: AgentKit;

  constructor(agentId: number) {
    this.agentId = agentId;
    this.agentKit = initializeAgentKit();
  }

  async initialize() {
    // Check if wallet exists in database
    const [existingWallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, this.agentId))
      .limit(1);

    if (existingWallet) {
      this.wallet = await this.agentKit.loadWallet(existingWallet.walletId);
    } else {
      // Create new wallet if none exists
      this.wallet = await this.agentKit.createWallet();
      await db.insert(mpcWallets).values({
        agentId: this.agentId,
        walletId: this.wallet.id,
        createdAt: new Date(),
      });
    }
  }

  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    const tx = await this.wallet.transfer({
      to: toAddress,
      amount,
      tokenType: 'USDC',
    });

    return tx.hash;
  }

  async getBalance(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    const balance = await this.wallet.getBalance('USDC');
    return balance;
  }
}

// Export a function to create payment service instances
export const createUSDCPaymentService = async (agentId: number) => {
  const service = new USDCPaymentService(agentId);
  await service.initialize();
  return service;
};