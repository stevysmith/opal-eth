
import { AgentKit, CdpWalletProvider, walletActionProvider, erc20ActionProvider } from '@coinbase/agentkit';
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";

class CoinbaseService {
  private agentKit: AgentKit;
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
  };

  constructor(config: { apiKeyName: string; apiKeyPrivateKey: string }) {
    this.config = {
      apiKeyName: config.apiKeyName,
      apiKeyPrivateKey: config.apiKeyPrivateKey.replace(/\\n/g, "\n"),
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };
    this.initializeAgentKit();
  }

  private async initializeAgentKit() {
    const walletProvider = await CdpWalletProvider.configureWithWallet({
      ...this.config,
      cdpWalletData: undefined // We'll manage wallet data through our database
    });

    this.agentKit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        walletActionProvider(),
        erc20ActionProvider(),
      ],
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

  async getWalletForAgent(agentId: number): Promise<string | null> {
    const [wallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, agentId))
      .limit(1);

    return wallet?.walletId || null;
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
}

const coinbaseService = new CoinbaseService({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
});

export default coinbaseService;
