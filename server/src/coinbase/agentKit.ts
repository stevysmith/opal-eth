
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

const initializeAgentKit = async () => {
  if (!process.env.CDP_API_KEY_NAME || !process.env.CDP_API_KEY_PRIVATE_KEY) {
    throw new Error('Missing required Coinbase CDP API credentials');
  }

  const config = {
    apiKeyName: process.env.CDP_API_KEY_NAME,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    networkId: process.env.NETWORK_ID || "base-sepolia",
  };

  const walletProvider = await CdpWalletProvider.configureWithWallet({
    ...config,
    cdpWalletData: undefined
  });

  return await AgentKit.from({
    walletProvider,
    actionProviders: [
      walletActionProvider(),
      erc20ActionProvider(),
      cdpApiActionProvider({
        apiKeyName: config.apiKeyName,
        apiKeyPrivateKey: config.apiKeyPrivateKey,
      }),
      cdpWalletActionProvider({
        apiKeyName: config.apiKeyName,
        apiKeyPrivateKey: config.apiKeyPrivateKey,
      }),
    ],
  });
};

class USDCPaymentService {
  private wallet: any = null;
  private readonly agentId: number;
  private agentKit: AgentKit | null = null;

  constructor(agentId: number) {
    this.agentId = agentId;
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

    if (!this.agentKit) {
      throw new Error('Failed to initialize AgentKit');
    }

    const walletProvider = await this.agentKit.getWalletProvider();

    if (existingWallet) {
      // Load existing wallet
      this.wallet = await walletProvider.getWallet(existingWallet.walletId);
    } else {
      // Create new wallet
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

export const createUSDCPaymentService = async (agentId: number) => {
  const service = new USDCPaymentService(agentId);
  await service.initialize();
  return service;
};
