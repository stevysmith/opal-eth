class CoinbaseService {
  private agentKit: AgentKit;

  // Configuration for network and treasury management
  private config: {
    apiKeyName: string;
    apiKeyPrivateKey: string;
    networkId: string;
    treasuryAddress: string;
  };

  // Key Methods:
  async initialize() { /* Initializes AgentKit with Viem wallet provider */ }
  async getUsdcBalance(walletAddress: string) { /* Checks USDC balance */ }
  async sendUsdc(toAddress: string, amount: string) { /* Sends USDC */ }
}
```

### 2. Giveaway Payout Service (server/src/services/giveawayPayoutService.ts)
Handles automated USDC distributions for giveaway winners.

```typescript
class GiveawayPayoutService {
  async processGiveawayWinner(giveawayId: number, winnerId: string) {
    // Automates winner selection and USDC transfer
  }
}
```

## Integration Points

### 1. Social Bot Integration
The project integrates AgentKit with Telegram bots for:
- Automated giveaway management
- DeFi analytics queries
- USDC prize distribution

### 2. CDP Tools Integration
We utilize multiple CDP tools:
- AgentKit for wallet operations
- Base Sepolia testnet for transactions
- USDC for giveaway prizes

## Innovative Features & Patterns

### 1. Automated USDC Giveaways
```typescript
// Example: Creating a giveaway with USDC prize
/giveaway 5 USDC in 1 hour

// Behind the scenes in bot-manager.ts:
const handleGiveawayCommand = async (ctx: Context) => {
  // Parse command and create giveaway
  const [giveaway] = await db.insert(giveaways).values({
    prize: "5 USDC",
    endTime: new Date(Date.now() + 3600000)
  }).returning();

  // When giveaway ends:
  const winner = selectWinner();
  const payoutResult = await giveawayPayoutService.processGiveawayWinner(
    giveaway.id,
    winner.userId
  );
}
```

### 2. Reusable AgentKit Patterns

#### Treasury Wallet Management
```typescript
// Secure initialization pattern
const initializeWallet = async () => {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http()
  });

  const walletProvider = new ViemWalletProvider(client);
  return await AgentKit.from({
    walletProvider,
    actionProviders: [
      erc20ActionProvider({ walletProvider, networkId: "base-sepolia" })
    ]
  });
};
```

#### Safe USDC Transfer Pattern
```typescript
// Reusable USDC transfer function with validation
async sendUsdc(toAddress: string, amount: string): Promise<string> {
  // Input validation
  if (!ethers.isAddress(toAddress)) {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }

  // Convert to base units
  const baseUnits = ethers.parseUnits(amount, 6).toString();

  // Execute transfer using AgentKit
  const transferAction = this.agentKit.getActions()
    .find(a => a.name === "ERC20ActionProvider_transfer");

  const txResponse = await transferAction.invoke({
    contractAddress: "usdc",
    destination: toAddress,
    amount: baseUnits
  });

  return extractTxHash(txResponse);
}
```

### 3. Error Handling Patterns

```typescript
// Comprehensive error handling for AgentKit operations
class AgentKitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly action?: string,
    public readonly params?: any
  ) {
    super(message);
    this.name = 'AgentKitError';
  }
}

const handleAgentKitOperation = async (operation: () => Promise<any>) => {
  try {
    return await operation();
  } catch (error) {
    if (error.message.includes('insufficient funds')) {
      throw new AgentKitError(
        'Insufficient funds for transaction',
        'INSUFFICIENT_FUNDS'
      );
    }
    // Handle other specific errors
    throw error;
  }
};
```

## Future Extensions

### 1. Modular Bot Actions
```typescript
// Example: Extensible bot action system
interface BotAction {
  command: string;
  execute: (ctx: Context) => Promise<void>;
  description: string;
}

class GiveawayAction implements BotAction {
  command = 'giveaway';
  async execute(ctx: Context) {
    // Implementation
  }
  description = 'Create a USDC giveaway';
}
```

### 2. Enhanced Analytics Integration
```typescript
// Example: DeFi analytics with automated insights
class DeFiAnalytics {
  async getPoolStats() {
    const data = await graphService.queryPools();
    return this.generateInsights(data);
  }

  private async generateInsights(data: any) {
    // Use AI to generate natural language insights
    const insights = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Generate concise DeFi insights from pool data"
        },
        {
          role: "user",
          content: JSON.stringify(data)
        }
      ]
    });

    return insights.choices[0].message.content;
  }
}
```

## Security Considerations

1. Treasury Wallet Management
- Secure private key handling
- Environment variable configuration
- Transaction verification

2. Error Handling
- Comprehensive error catching
- Transaction verification
- Balance checking before transfers

## Prize Track Alignment

### Most Innovative Use of AgentKit
Our implementation stands out by:
1. Combining social engagement with crypto
2. Automating USDC distributions
3. Making crypto interactions accessible through chat

### Best Agent Project Using CDP Tools
We integrate multiple CDP tools:
1. AgentKit for wallet operations
2. USDC for payments
3. Base Sepolia for testing

### Viral Consumer App Potential
Features that make our app viral:
1. Simple chat interface
2. Automated crypto giveaways
3. Real-time DeFi insights

## Setup Instructions

### Environment Variables
```env
CDP_API_KEY_NAME=your_api_key_name
CDP_API_KEY_PRIVATE_KEY=your_private_key
TREASURY_WALLET_ADDRESS=your_wallet_address
TREASURY_WALLET_PRIVATE_KEY=your_wallet_private_key
```

### Initialization
```typescript
const coinbaseService = new CoinbaseService({
  apiKeyName: process.env.CDP_API_KEY_NAME!,
  apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
});