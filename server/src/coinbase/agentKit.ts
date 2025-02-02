import { 
  AgentKit, 
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  type WalletActionProvider,
  type ERC20ActionProvider
} from '@coinbase/agentkit';
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";

class CoinbaseService {
  private agentKit: AgentKit | null = null;
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
  };

  constructor() {
    // Validate required environment variables
    const apiKeyName = process.env.CDP_API_KEY_NAME;
    const apiKeyPrivateKey = process.env.CDP_API_KEY_PRIVATE_KEY;

    if (!apiKeyName || !apiKeyPrivateKey) {
      throw new Error('Missing required CDP API credentials');
    }

    this.config = {
      apiKeyName,
      apiKeyPrivateKey: apiKeyPrivateKey.replace(/\\n/g, "\n"),
      networkId: "base-sepolia", // Use testnet by default
    };
  }

  private async ensureInitialized() {
    if (!this.agentKit) {
      try {
        // Initialize the action providers
        const wallet = walletActionProvider();
        const erc20 = erc20ActionProvider();

        // Initialize AgentKit
        this.agentKit = await AgentKit.create({
          apiKeyName: this.config.apiKeyName,
          apiKeyPrivateKey: this.config.apiKeyPrivateKey,
          network: this.config.networkId,
          actionProviders: [wallet, erc20],
        });

        console.log('AgentKit initialized successfully');
      } catch (error) {
        console.error('Failed to initialize AgentKit:', error);
        throw error;
      }
    }
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      await this.ensureInitialized();
      if (!this.agentKit) throw new Error('AgentKit not initialized');

      console.log('Creating MPC wallet for agent:', agentId);

      const wallet = await this.agentKit.createWallet();
      if (!wallet?.id) {
        throw new Error('Failed to create wallet - no wallet ID returned');
      }

      console.log('Created wallet:', wallet.id);

      await db.insert(mpcWallets).values({
        agentId,
        walletId: wallet.id,
        createdAt: new Date(),
      });

      return wallet.id;
    } catch (error) {
      console.error('Error creating MPC wallet:', {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getWalletForAgent(agentId: number): Promise<string | null> {
    try {
      const [wallet] = await db
        .select()
        .from(mpcWallets)
        .where(eq(mpcWallets.agentId, agentId))
        .limit(1);

      return wallet?.walletId || null;
    } catch (error) {
      console.error('Error getting wallet for agent:', error);
      throw error;
    }
  }

  async getWalletBalance(walletId: string): Promise<string> {
    try {
      await this.ensureInitialized();
      if (!this.agentKit) throw new Error('AgentKit not initialized');

      const wallet = await this.agentKit.getWallet(walletId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const balance = await wallet.getBalance('USDC');
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw error;
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      await this.ensureInitialized();
      if (!this.agentKit) throw new Error('AgentKit not initialized');

      const wallet = await this.agentKit.getWallet(fromWalletId);
      if (!wallet) {
        throw new Error('Source wallet not found');
      }

      const tx = await wallet.send({
        to: toAddress,
        amount,
        asset: 'USDC'
      });

      if (!tx?.hash) {
        throw new Error('Transaction failed - no hash returned');
      }

      return tx.hash;
    } catch (error) {
      console.error('Error sending USDC:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const coinbaseService = new CoinbaseService();
export default coinbaseService;