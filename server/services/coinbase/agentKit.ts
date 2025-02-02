
import { AgentKit, CdpWalletProvider } from '@coinbase/agentkit';
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";

interface AgentKitConfig {
  apiKeyName: string;
  apiKeyPrivateKey: string;
}

class CoinbaseService {
  private agentKit: AgentKit;

  constructor(config: AgentKitConfig) {
    this.initializeAgentKit(config);
  }

  private async initializeAgentKit(config: AgentKitConfig) {
    const walletProvider = await CdpWalletProvider.configure({
      apiKeyName: config.apiKeyName,
      apiKeyPrivateKey: config.apiKeyPrivateKey,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    });

    this.agentKit = await AgentKit.from({
      walletProvider,
      actionProviders: []
    });
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      const walletProvider = await this.agentKit.getWalletProvider();
      const wallet = await walletProvider.createWallet();

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
      const walletProvider = await this.agentKit.getWalletProvider();
      const wallet = await walletProvider.getWallet(walletId);
      const balance = await wallet.balance('USDC');
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      const walletProvider = await this.agentKit.getWalletProvider();
      const wallet = await walletProvider.getWallet(fromWalletId);
      const tx = await wallet.send({
        to: toAddress,
        amount,
        asset: 'USDC'
      });
      return tx.hash;
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

const coinbaseService = new CoinbaseService({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
});

export default coinbaseService;
