
import { CdpAgentkit } from '@coinbase/cdp-agentkit-core';
import { CdpToolkit } from '@coinbase/cdp-langchain';
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";

class CoinbaseWalletProvider {
  private agentKit: CdpAgentkit;
  private wallet: any = null;
  private readonly networkId: string;

  constructor(config: { apiKeyName: string; apiKeyPrivateKey: string }) {
    this.networkId = process.env.NETWORK_ID || "base-sepolia";
    this.initializeAgentKit(config);
  }

  private async initializeAgentKit(config: { apiKeyName: string; apiKeyPrivateKey: string }) {
    this.agentKit = await CdpAgentkit.configureWithWallet({
      apiKeyName: config.apiKeyName,
      apiKeyPrivateKey: config.apiKeyPrivateKey.replace(/\\n/g, "\n"),
      networkId: this.networkId,
    });
  }

  async getAddress(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }
    return this.wallet.address;
  }

  getNetwork() {
    return {
      networkId: this.networkId,
      chainId: this.networkId === "base-sepolia" ? "0x14a34" : "0x14a33",
      protocolFamily: "evm"
    };
  }

  getName(): string {
    return "CoinbaseWalletProvider";
  }

  async getBalance(): Promise<bigint> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }
    const balance = await this.wallet.balance('USDC');
    return BigInt(balance);
  }

  async nativeTransfer(to: `0x${string}`, value: string): Promise<`0x${string}`> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }
    const tx = await this.wallet.send({
      to,
      amount: value,
      asset: 'USDC'
    });
    return tx.hash as `0x${string}`;
  }

  async createWallet(agentId: number): Promise<string> {
    try {
      this.wallet = await this.agentKit.createWallet();
      await db.insert(mpcWallets).values({
        agentId,
        walletId: this.wallet.id,
        createdAt: new Date(),
      });
      return this.wallet.id;
    } catch (error) {
      console.error('Error creating MPC wallet:', error);
      throw new Error('Failed to create MPC wallet');
    }
  }

  async loadWallet(walletId: string): Promise<void> {
    this.wallet = await this.agentKit.getWallet(walletId);
  }
}

class CoinbaseService {
  private walletProvider: CoinbaseWalletProvider;

  constructor(config: { apiKeyName: string; apiKeyPrivateKey: string }) {
    this.walletProvider = new CoinbaseWalletProvider(config);
  }

  async createMpcWallet(agentId: number): Promise<string> {
    return this.walletProvider.createWallet(agentId);
  }

  async getWalletForAgent(agentId: number): Promise<string | null> {
    const [wallet] = await db
      .select()
      .from(mpcWallets)
      .where(eq(mpcWallets.agentId, agentId))
      .limit(1);

    if (wallet) {
      await this.walletProvider.loadWallet(wallet.walletId);
    }
    return wallet?.walletId || null;
  }

  async getWalletBalance(walletId: string): Promise<string> {
    try {
      await this.walletProvider.loadWallet(walletId);
      const balance = await this.walletProvider.getBalance();
      return balance.toString();
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async sendUsdc(fromWalletId: string, toAddress: string, amount: string): Promise<string> {
    try {
      await this.walletProvider.loadWallet(fromWalletId);
      const txHash = await this.walletProvider.nativeTransfer(toAddress as `0x${string}`, amount);
      return txHash;
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
