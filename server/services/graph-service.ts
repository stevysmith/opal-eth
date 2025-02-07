import { request, gql } from "graphql-request";
import OpenAI from "openai";
import { Telegraf } from "telegraf";
import { db } from "@db";
import { graphNotifications } from "@db/schema";
import { eq } from "drizzle-orm";

const GRAPH_API_URL =
  "https://gateway-arbitrum.network.thegraph.com/api/7ad5dec0c95579e6812957254486d013/subgraphs/id/HUZDsRpEVP2AvzDCyzDHtdc64dyDxx8FQjzsmqSg4H3B";

// Initialize OpenAI
// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const formatPoolStats = async (data: any) => {
  try {
    // If data is empty or undefined, return an error message
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      return "⚠️ Unable to fetch DeFi statistics at the moment. The network may be experiencing temporary issues. Please try again in a few minutes.";
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a DeFi analytics expert that creates concise, informative updates about Uniswap pool activity. Format the response to be easily readable in a Telegram message with emojis and bullet points. Include insights about changes and trends when possible.",
        },
        {
          role: "user",
          content: `Analyze and summarize the following DeFi data in a clear, informative way that highlights key metrics and notable changes. Data: ${JSON.stringify(data, null, 2)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    // Parse the JSON response and format it for Telegram
    const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");
    return aiResponse.message || "Error formatting message";
  } catch (error) {
    console.error("Error formatting pool stats:", error);
    // More descriptive fallback message
    if (error.message?.includes("indexers")) {
      return "🔄 The DeFi analytics service is currently syncing with the latest blockchain data. Please try again in a few minutes.";
    }
    // Fallback to basic formatting if AI fails
    const stats = data.factory || data.pool || data.pools;
    return `📊 DeFi Analytics Update\n\n${JSON.stringify(stats, null, 2)}`;
  }
};

// Helper function to add retry logic for Graph queries
async function retryRequest(queryFn: () => Promise<any>, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      if (attempt === maxRetries || !error.message?.includes("indexers")) {
        throw error;
      }
      // Wait before retrying, with exponential backoff
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

export class GraphService {
  private bot: Telegraf;

  constructor(telegramToken: string) {
    this.bot = new Telegraf(telegramToken);
  }

  async getPoolStats(poolAddress: string) {
    const query = gql`
      query getPoolStats($poolAddress: String!) {
        pool(id: $poolAddress) {
          token0Price
          token1Price
          feeTier
          liquidity
          volumeUSD
          totalValueLockedUSD
          volumeToken0
          volumeToken1
          token0 {
            symbol
            name
            totalValueLocked
          }
          token1 {
            symbol
            name
            totalValueLocked
          }
          poolDayData(first: 2, orderBy: date, orderDirection: desc) {
            volumeUSD
            date
          }
        }
      }
    `;

    const variables = {
      poolAddress: poolAddress.toLowerCase(),
    };

    return retryRequest(() => request(GRAPH_API_URL, query, variables));
  }

  async getTopPools(limit: number = 5) {
    const query = gql`
      query getTopPools($limit: Int!) {
        pools(
          first: $limit
          orderBy: volumeUSD
          orderDirection: desc
          where: { volumeUSD_gt: "0" }
        ) {
          id
          volumeUSD
          totalValueLockedUSD
          token0Price
          token1Price
          token0 {
            symbol
            name
          }
          token1 {
            symbol
            name
          }
          poolDayData(first: 1, orderBy: date, orderDirection: desc) {
            volumeUSD
          }
        }
      }
    `;

    return retryRequest(() => request(GRAPH_API_URL, query, { limit }));
  }

  async getGlobalStats() {
    const query = gql`
      {
        factory(id: "0x1F98431c8aD98523631AE4a59f267346ea31F984") {
          poolCount
          totalValueLockedUSD
          totalVolumeUSD
          txCount
        }
        uniswapDayDatas(first: 2, orderBy: date, orderDirection: desc) {
          date
          volumeUSD
          totalValueLockedUSD
          txCount
        }
      }
    `;

    return retryRequest(() => request(GRAPH_API_URL, query));
  }

  async sendNotification(agentId: number, channelId: string) {
    try {
      // Get notification preferences
      const notification = await db.query.graphNotifications.findFirst({
        where: eq(graphNotifications.agentId, agentId),
      });

      if (!notification || !notification.active) return;

      let data;
      const config = notification.queryConfig as any;

      switch (notification.queryType) {
        case "pool_stats":
          data = await this.getPoolStats(config.poolAddress);
          break;
        case "volume_stats":
          data = await this.getTopPools(config.topN);
          break;
        case "global_stats":
          data = await this.getGlobalStats();
          break;
        default:
          throw new Error(`Unknown query type: ${notification.queryType}`);
      }

      const formattedMessage = await formatPoolStats(data);
      await this.bot.telegram.sendMessage(channelId, formattedMessage);

      // Update last run time
      await db
        .update(graphNotifications)
        .set({ lastRun: new Date() })
        .where(eq(graphNotifications.id, notification.id));
    } catch (error) {
      console.error("Error sending notification:", error);
      // Try to send an error message to the channel
      try {
        await this.bot.telegram.sendMessage(
          channelId,
          "⚠️ Unable to fetch DeFi analytics at this time. Will retry on next scheduled update."
        );
      } catch (telegramError) {
        console.error("Error sending error notification:", telegramError);
      }
      throw error; // Propagate error to caller
    }
  }
}