import { AgentKit, CdpWalletProvider } from "@coinbase/agentkit";
import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";
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
  }

  async initialize() {
    try {
      // Configure the Coinbase SDK
      Coinbase.configure({
        apiKeyName: this.config.apiKeyName,
        privateKey: this.config.apiKeyPrivateKey,
      });

      // Configure CDP Wallet Provider
      const walletProvider = await CdpWalletProvider.configureWithWallet({
        apiKeyName: this.config.apiKeyName,
        apiKeyPrivateKey: this.config.apiKeyPrivateKey,
        networkId: this.config.networkId,
      });

      // Initialize AgentKit with the wallet provider
      this.agentKit = await AgentKit.from({
        walletProvider,
      });

      console.log("CoinbaseService initialized successfully");
    } catch (error) {
      console.error("Error initializing CoinbaseService:", error);
      throw error;
    }
  }

  async createMpcWallet(agentId: number): Promise<string> {
    try {
      console.log("Creating MPC wallet for agent:", agentId);

      // Create a new wallet using Coinbase SDK
      const wallet = await Wallet.create({
        networkId: this.config.networkId as Coinbase.networks,
      });

      if (!wallet) {
        throw new Error("Wallet creation failed");
      }

      // Get the default address of the wallet
      const address = await wallet.getDefaultAddress();

      console.log("Wallet created:", {
        address,
        agentId,
      });

      // Export wallet data for persistence
      const walletData = wallet.export();

      // Store the wallet information in the database
      await db.insert(mpcWallets).values({
        agentId,
        walletId: address,
        walletData: JSON.stringify(walletData), // Store the export data for reinitialization
        createdAt: new Date(),
      });

      // Request funds from faucet if on testnet
      if (this.config.networkId === "base-sepolia") {
        try {
          const faucetTx = await wallet.faucet();
          console.log("Faucet transaction:", faucetTx);
        } catch (error) {
          console.warn("Faucet request failed:", error);
        }
      }

      return address;
    } catch (error) {
      console.error("Error creating MPC wallet:", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getWalletForAgent(agentId: number): Promise<string | null> {
    try {
      const [walletRecord] = await db
        .select()
        .from(mpcWallets)
        .where(eq(mpcWallets.agentId, agentId))
        .limit(1);

      return walletRecord?.walletId || null;
    } catch (error) {
      console.error("Error getting wallet for agent:", error);
      throw new Error("Failed to get wallet for agent");
    }
  }

  async sendUsdc(
    fromWalletAddress: string,
    toAddress: string,
    amount: string,
  ): Promise<string> {
    try {
      // Retrieve the wallet record to get the export data
      const [walletRecord] = await db
        .select()
        .from(mpcWallets)
        .where(eq(mpcWallets.walletId, fromWalletAddress))
        .limit(1);

      if (!walletRecord?.walletData) {
        throw new Error("Wallet data not found");
      }

      // Re-instantiate the wallet
      const wallet = await Wallet.import(JSON.parse(walletRecord.walletData));

      // Create gasless USDC transfer
      const transfer = await wallet.createTransfer({
        amount: parseFloat(amount),
        assetId: Coinbase.assets.Usdc,
        destination: toAddress,
        gasless: true,
        skipBatching: true, // Process immediately
      });

      // Wait for transfer to complete
      const completedTransfer = await transfer.wait();
      return completedTransfer.hash;
    } catch (error) {
      console.error("Error sending USDC:", error);
      throw new Error("Failed to send USDC");
    }
  }

  async getWalletBalance(walletAddress: string): Promise<string> {
    try {
      // Retrieve the wallet record to get the export data
      const [walletRecord] = await db
        .select()
        .from(mpcWallets)
        .where(eq(mpcWallets.walletId, walletAddress))
        .limit(1);

      if (!walletRecord?.walletData) {
        throw new Error("Wallet data not found");
      }

      // Re-instantiate the wallet
      const wallet = await Wallet.import(JSON.parse(walletRecord.walletData));

      // Get USDC balance
      const balance = await wallet.getBalance(Coinbase.assets.Usdc);
      return balance.toString();
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      throw new Error("Failed to get wallet balance");
    }
  }
}

// Initialize the service with environment variables
const coinbaseService = new CoinbaseService({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
});

// Initialize the service when it's created
coinbaseService.initialize().catch((error) => {
  console.error("Failed to initialize CoinbaseService:", error);
});

export default coinbaseService;
