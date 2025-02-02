import { 
  AgentKit,
  CdpWalletProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider
} from '@coinbase/agentkit';
import { db } from '@db';
import { mpcWallets } from '@db/schema';
import { eq } from 'drizzle-orm';

// Initialize CDP Wallet Provider
const initializeAgentKit = async () => {
  if (!process.env.CDP_API_KEY_NAME || !process.env.CDP_API_KEY_PRIVATE_KEY) {
    throw new Error('Missing required Coinbase CDP API credentials');
  }

  const config = {
    apiKeyName: process.env.CDP_API_KEY_NAME,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    networkId: process.env.NETWORK_ID || "base-sepolia",
  };

  const walletProvider = await CdpWalletProvider.configure(config);

  return await AgentKit.from({
    walletProvider,
    actionProviders: [
      walletActionProvider(),
      erc20ActionProvider(),
      cdpApiActionProvider({
        apiKeyName: process.env.CDP_API_KEY_NAME,
        apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      cdpWalletActionProvider({
        apiKeyName: process.env.CDP_API_KEY_NAME,
        apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    ],
  });
};

export class USDCPaymentService {
  private wallet: any = null;
  private readonly agentId: number;
  private readonly agentKit: AgentKit;

  constructor(agentId: number) {
    this.agentId = agentId;
    this.agentKit = null as any; // Will be initialized in initialize()
  }

  async initialize() {
    // Initialize AgentKit
    this.agentKit = await initializeAgentKit();

    // Check if wallet exists in database
    const [existingWallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, this.agentId))
      .limit(1);

    if (existingWallet) {
      // Load existing wallet
      const walletProvider = await this.agentKit.getWalletProvider();
      this.wallet = await walletProvider.getWallet(existingWallet.walletId);
    } else {
      // Create new wallet
      const walletProvider = await this.agentKit.getWalletProvider();
      const newWallet = await walletProvider.createWallet();
      this.wallet = newWallet;

      await db.insert(mpcWallets).values({
        agentId: this.agentId,
        walletId: newWallet.id,
        createdAt: new Date(),
      });
    }
  }

  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    const tx = await this.wallet.send({
      to: toAddress,
      amount,
      asset: 'USDC',
    });

    return tx.hash;
  }

  async getBalance(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    const balance = await this.wallet.balance('USDC');
    return balance.toString();
  }
}

// Export a function to create payment service instances
export const createUSDCPaymentService = async (agentId: number) => {
  const service = new USDCPaymentService(agentId);
  await service.initialize();
  return service;
};