import {
  AgentKit,
  CdpWalletProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
} from "@coinbase/agentkit";
import { db } from "@db";
import { mpcWallets } from "@db/schema";
import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { Interface } from "ethers";

class CoinbaseService {
  private agentKit: AgentKit;
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
    treasuryAddress: string;
  };

  // USDC contract addresses for different networks
  private readonly USDC_CONTRACTS = {
    "base-sepolia": "0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897", // Base Sepolia USDC
    "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base Mainnet USDC
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
      if (this.agentKit) {
        return; // Already initialized
      }

      // First configure the wallet provider
      const walletProvider = await CdpWalletProvider.configureWithWallet({
        apiKeyName: this.config.apiKeyName,
        apiKeyPrivateKey: this.config.apiKeyPrivateKey,
        networkId: this.config.networkId,
      });

      // Initialize AgentKit with providers
      this.agentKit = await AgentKit.from({
        walletProvider,
        actionProviders: [
          cdpApiActionProvider({
            apiKeyName: this.config.apiKeyName,
            apiKeyPrivateKey: this.config.apiKeyPrivateKey,
          }),
          erc20ActionProvider({
            walletProvider,
            networkId: this.config.networkId,
            chainId: "0x14a33", // Base Sepolia chain ID
            provider: walletProvider,
            contractAddress:
              this.USDC_CONTRACTS[
                this.config.networkId as keyof typeof this.USDC_CONTRACTS
              ],
            spender: this.config.treasuryAddress,
          }),
        ],
      });

      console.log("CoinbaseService initialized successfully");
    } catch (error) {
      console.error("Error initializing CoinbaseService:", error);
      throw error;
    }
  }

  private async ensureInitialized() {
    if (!this.agentKit) {
      await this.initialize();
    }
  }

  async approveUsdc(): Promise<string> {
    try {
      const walletProvider = await CdpWalletProvider.configureWithWallet({
        apiKeyName: this.config.apiKeyName,
        apiKeyPrivateKey: this.config.apiKeyPrivateKey,
        networkId: this.config.networkId,
      });

      const usdcAddress =
        this.USDC_CONTRACTS[
          this.config.networkId as keyof typeof this.USDC_CONTRACTS
        ];

      const approvalAmount = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // max uint256

      const tx = await walletProvider.sendTransaction({
        to: usdcAddress,
        data: new Interface([
          "function approve(address spender, uint256 amount)"
        ]).encodeFunctionData("approve", [this.config.treasuryAddress, approvalAmount]),
        maxFeePerGas: "5000000000", // 5 gwei
        maxPriorityFeePerGas: "2000000000", // 2 gwei
        chain: {
          id: 84532,
          name: 'Base Sepolia',
          network: 'base-sepolia',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
          },
          rpcUrls: {
            default: { http: ['https://sepolia.base.org'] }
          }
        }
      });

      console.log("Approve transaction hash:", tx.hash);
      await tx.wait();

      return tx.hash;
    } catch (error) {
      console.error("Error approving USDC:", error);
      throw error;
    }
  }

  async hasUsdcApproval(): Promise<boolean> {
    try {
      const actions = this.agentKit.getActions();
      const allowanceAction = actions.find(
        (a) => a.name === "ERC20ActionProvider_get_allowance",
      );
      if (!allowanceAction) {
        throw new Error("Allowance action not found");
      }

      const usdcAddress =
        this.USDC_CONTRACTS[
          this.config.networkId as keyof typeof this.USDC_CONTRACTS
        ];
      const allowance = await allowanceAction.invoke({
        contractAddress: usdcAddress,
        spender: this.config.treasuryAddress,
      });

      return BigInt(allowance) > 0n;
    } catch (error) {
      console.error("Error checking USDC approval:", error);
      return false;
    }
  }

  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    try {
      // Get available actions
      const actions = this.agentKit.getActions();
      console.log(
        "Available actions for sendUsdc:",
        actions.map((a) => a.name),
      );

      // Get the transfer action first
      const transferAction = actions.find(
        (a) => a.name === "ERC20ActionProvider_transfer",
      );
      if (!transferAction) {
        console.log(
          "Available actions:",
          actions.map((a) => ({ name: a.name, methods: Object.keys(a) })),
        );
        throw new Error(
          "Transfer action not found. Available actions: " +
            actions.map((a) => a.name).join(", "),
        );
      }

      // Log the schema shape to understand expected parameters
      console.log("Transfer action schema shape:", {
        description: transferAction.description,
        shape: Object.keys(transferAction.schema._def.shape()),
      });

      // Get USDC contract address for current network
      const usdcAddress =
        this.USDC_CONTRACTS[
          this.config.networkId as keyof typeof this.USDC_CONTRACTS
        ];
      if (!usdcAddress) {
        throw new Error(
          `No USDC contract address configured for network: ${this.config.networkId}`,
        );
      }

      // Convert amount to USDC base units (6 decimals)
      const baseUnits = BigInt(Math.round(parseFloat(amount) * 1_000_000));

      // Create the transfer parameters
      const transferParams = {
        amount: baseUnits.toString(),
        contractAddress: usdcAddress,
        destination: toAddress,
      };

      console.log("Attempting USDC transfer with params:", {
        ...transferParams.args,
        originalAmount: amount,
        amountAsString: baseUnits.toString(),
        network: this.config.networkId,
      });

      // Call the transfer method using invoke
      const tx = await transferAction.invoke(transferParams);

      console.log("Transfer response:", tx);
      return tx.hash;
    } catch (error) {
      console.error("Error sending USDC:", error);
      throw new Error(
        "Failed to send USDC: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    }
  }

  async getUsdcBalance(walletAddress: string): Promise<string> {
    try {
      // Get available actions
      const actions = this.agentKit.getActions();
      const balanceAction = actions.find(
        (a) => a.name === "ERC20ActionProvider_get_balance",
      );

      if (!balanceAction) {
        throw new Error("Balance action not found");
      }

      // Get USDC contract address for current network
      const usdcAddress =
        this.USDC_CONTRACTS[
          this.config.networkId as keyof typeof this.USDC_CONTRACTS
        ];
      if (!usdcAddress) {
        throw new Error(
          `No USDC contract address configured for network: ${this.config.networkId}`,
        );
      }

      // Get USDC balance using invoke
      const balance = await balanceAction.invoke({
        args: {
          wallet: walletAddress,
          contractAddress: usdcAddress,
        },
      });

      return balance.toString();
    } catch (error) {
      console.error("Error getting USDC balance:", error);
      throw new Error("Failed to get USDC balance");
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