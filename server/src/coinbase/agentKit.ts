
import { AgentKit } from '@coinbase/agentkit';
import { WalletProvider, CdpWalletProvider } from '@coinbase/agentkit';
import { walletActionProvider, erc20ActionProvider } from '@coinbase/agentkit';
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
    this.agentKit = await AgentKit.from({
      cdpApiKeyName: this.config.apiKeyName,
      cdpApiKeyPrivateKey: this.config.apiKeyPrivateKey,
      actionProviders: [
        walletActionProvider(),
        erc20ActionProvider(),
      ],
    });
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      const actions = await this.agentKit.getActions();
      const walletAction = actions.find(action => action.type === 'wallet');
      if (!walletAction) {
        throw new Error('Wallet action provider not found');
      }
      
      const wallet = await walletAction.createWallet();
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
    try {
      const [wallet] = await db
        .select()
        .from(mpcWallets)
        .where(eq(mpcWallets.agentId, agentId))
        .limit(1);

      return wallet?.walletId || null;
    } catch (error) {
      console.error('Error getting wallet for agent:', error);
      throw new Error('Failed to get wallet for agent');
    }
  }

  async getWalletBalance(walletId: string): Promise<string> {
    try {
      const wallet = await this.agentKit.getActions()[0].getWallet(walletId);
      const balance = await wallet.getBalance('USDC');
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      const wallet = await this.agentKit.getActions()[0].getWallet(fromWalletId);
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
