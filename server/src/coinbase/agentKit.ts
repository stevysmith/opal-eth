
import { AgentKit, walletActionProvider, erc20ActionProvider } from '@coinbase/agentkit';
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
    try {
      const wallet = walletActionProvider();
      const erc20 = erc20ActionProvider();
      
      // Set action types using Object.defineProperty to ensure they are enumerable
      Object.defineProperty(wallet, 'type', {
        value: 'wallet',
        enumerable: true,
        configurable: true,
        writable: true
      });
      
      Object.defineProperty(erc20, 'type', {
        value: 'erc20',
        enumerable: true,
        configurable: true,
        writable: true
      });

      console.log('Initializing wallet action:', wallet);
      console.log('Initializing erc20 action:', erc20);
      
      this.agentKit = await AgentKit.from({
        cdpApiKeyName: this.config.apiKeyName,
        cdpApiKeyPrivateKey: this.config.apiKeyPrivateKey,
        actionProviders: [wallet, erc20],
      });
    } catch (error) {
      console.error('Error initializing AgentKit:', error);
      throw error;
    }
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      console.log('Creating MPC wallet for agent:', agentId);
      
      const actions = this.agentKit.getActions();
      console.log('Available actions:', actions.map(a => ({ type: a.type, methods: Object.keys(a) })));
      
      const walletAction = actions.find(action => action.type === 'wallet');
      console.log('Found wallet action:', walletAction ? 'yes' : 'no', walletAction);
      
      if (!walletAction) {
        throw new Error('Wallet action provider not found');
      }

      console.log('Attempting to create wallet...');
      const wallet = await walletAction.createWallet();
      console.log('Wallet creation response:', wallet);

      if (!wallet) {
        throw new Error('Wallet creation returned null/undefined');
      }

      console.log('Inserting wallet record into database...');
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
        agentKitState: {
          initialized: !!this.agentKit,
          hasActions: this.agentKit?.getActions()?.length > 0
        }
      });
      throw error; // Throw original error to preserve stack trace
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
      const walletAction = this.agentKit.getActions().find(action => action.type === 'wallet');
      if (!walletAction) {
        throw new Error('Wallet action not found');
      }
      const wallet = await walletAction.getWallet(walletId);
      const balance = await wallet.getBalance('USDC');
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      const walletAction = this.agentKit.getActions().find(action => action.type === 'wallet');
      if (!walletAction) {
        throw new Error('Wallet action not found');
      }
      const wallet = await walletAction.getWallet(fromWalletId);
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
