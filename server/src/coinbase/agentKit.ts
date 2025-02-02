
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

class USDCPaymentService {
  private wallet: any = null;
  private readonly agentId: number;
  private agentKit: AgentKit | null = null;
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
  };

  constructor(agentId: number) {
    this.agentId = agentId;
    this.config = {
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };
  }

  async initialize() {
    // Initialize CDP Wallet Provider
    const walletProvider = await CdpWalletProvider.configureWithWallet({
      ...this.config,
      cdpWalletData: undefined
    });

    // Initialize AgentKit with all required providers
    this.agentKit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: this.config.apiKeyName,
          apiKeyPrivateKey: this.config.apiKeyPrivateKey,
        }),
        cdpWalletActionProvider({
          apiKeyName: this.config.apiKeyName,
          apiKeyPrivateKey: this.config.apiKeyPrivateKey,
        }),
      ],
    });

    // Check if wallet exists in database
    const [existingWallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, this.agentId))
      .limit(1);

    if (!this.agentKit) {
      throw new Error('Failed to initialize AgentKit');
    }

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
