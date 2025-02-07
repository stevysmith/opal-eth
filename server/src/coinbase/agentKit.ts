import {
  AgentKit,
  ViemWalletProvider,
  erc20ActionProvider, // ✅ Add this!
} from "@coinbase/agentkit";
import { db } from "@db";
import { ethers } from "ethers";

import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

class CoinbaseService {
  private agentKit: AgentKit;
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
    treasuryAddress: string;
  };

  constructor(config: { apiKeyName: string; apiKeyPrivateKey: string }) {
    this.config = {
      apiKeyName: config.apiKeyName,
      apiKeyPrivateKey: config.apiKeyPrivateKey.replace(/\\n/g, "\n"),
      networkId: process.env.NETWORK_ID || "base-sepolia",
      treasuryAddress: process.env.TREASURY_WALLET_ADDRESS || "",
    };

    if (!this.config.treasuryAddress) {
      throw new Error(
        "TREASURY_WALLET_ADDRESS environment variable is required",
      );
    }
  }

  async initialize() {
    try {
      if (this.agentKit) return; // Already initialized

      console.log("🔍 Using Viem to configure wallet with private key");

      // Ensure private key is formatted correctly
      const rawPrivateKey = process.env.TREASURY_WALLET_PRIVATE_KEY!;
      const privateKey = rawPrivateKey.startsWith("0x")
        ? rawPrivateKey
        : `0x${rawPrivateKey}`;

      // Create Viem Wallet Client using the correct treasury wallet
      const account = privateKeyToAccount(privateKey);
      const client = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(),
      });

      const walletProvider = new ViemWalletProvider(client);

      this.agentKit = await AgentKit.from({
        walletProvider,
        actionProviders: [
          erc20ActionProvider({ walletProvider, networkId: "base-sepolia" }), // ✅ Ensure ERC20 actions are available
        ],
      });

      // Verify which wallet is being used
      const agentKitAddress = await walletProvider.getAddress();
      console.log(`✅ AgentKit is now using wallet: ${agentKitAddress}`);
      console.log(
        `✅ Treasury Wallet (Expected): ${this.config.treasuryAddress}`,
      );
    } catch (error) {
      console.error("❌ Error initializing CoinbaseService:", error);
      throw error;
    }
  }

  private async ensureInitialized() {
    if (!this.agentKit) await this.initialize();
  }

  async getUsdcBalance(walletAddress: string): Promise<string> {
    try {
      await this.ensureInitialized();

      const actions = this.agentKit.getActions();
      const balanceAction = actions.find(
        (a) => a.name === "ERC20ActionProvider_get_balance",
      );
      if (!balanceAction) throw new Error("Balance action not found");

      const balance = await balanceAction.invoke({
        contractAddress: "usdc", // AgentKit resolves USDC contract automatically
        wallet: walletAddress,
      });

      console.log(`💰 USDC Balance for ${walletAddress}: ${balance}`);
      return balance.toString();
    } catch (error) {
      console.error("❌ Error getting USDC balance:", error);
      throw new Error("Failed to get USDC balance");
    }
  }

  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    try {
      await this.ensureInitialized();

      if (!ethers.isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
      }

      const senderAddress = this.config.treasuryAddress;
      const baseUnits = ethers.parseUnits(amount, 6).toString();

      console.log(`🚀 Sending ${amount} USDC (${baseUnits} base units) from ${senderAddress} to ${toAddress}`);

      // Use AgentKit's built-in transfer method
      const actions = this.agentKit.getActions();
      const transferAction = actions.find(a => a.name === "ERC20ActionProvider_transfer");
      if (!transferAction) throw new Error("Transfer action not found");

      console.log("🔍 Transfer Action Details:", transferAction);

      const txResponse = await transferAction.invoke({
        contractAddress: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8", // USDC Contract
        destination: toAddress,
        amount: baseUnits,
      });

      console.log("🛠 Full Transaction Response Object:", JSON.stringify(txResponse, null, 2));

      // Extract transaction hash dynamically from string
      const txHashMatch = txResponse.match(/Transaction hash for the transfer: (0x[a-fA-F0-9]{64})/);
      const txHash = txHashMatch ? txHashMatch[1] : null;

      if (!txHash) {
        throw new Error("⚠️ Transaction response is missing a valid hash.");
      }

      console.log(`✅ USDC Sent! Transaction Hash: ${txHash}`);
      return txHash;
    } catch (error) {
      console.error("❌ Error sending USDC:", error);
      throw error;
    }
  }

}

// Initialize the service with environment variables
const coinbaseService = new CoinbaseService({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
});

// Initialize the service on startup
coinbaseService.initialize().catch((error) => {
  console.error("❌ Failed to initialize CoinbaseService:", error);
});

export default coinbaseService;
