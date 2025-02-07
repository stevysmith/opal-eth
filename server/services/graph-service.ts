import { request, gql } from "graphql-request";
import OpenAI from "openai";
import { Telegraf } from "telegraf";
import { db } from "@db";
import { graphNotifications } from "@db/schema";
import { eq } from "drizzle-orm";

const GRAPH_API_URL =
  "https://gateway-arbitrum.network.thegraph.com/api/7ad5dec0c95579e6812957254486d013/subgraphs/id/HUZDsRpEVP2AvzDCyzDHtdc64dyDxx8FQjzsmqSg4H3B";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const formatPoolStats = async (data: any) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // Updated to use gpt-4o-mini model
      messages: [
        {
          role: "system",
          content:
            "You are a DeFi analytics expert that creates concise, informative updates about Uniswap pool activity.",
        },
        {
          role: "user",
          content: `Format the following Uniswap pool data into a clear, concise message suitable for a Telegram channel. Include key metrics and any notable changes: ${JSON.stringify(data, null, 2)}`,
        },
      ],
    });

    return response.choices[0]?.message?.content || "Error formatting message";
  } catch (error) {
    console.error("Error formatting pool stats:", error);
    return JSON.stringify(data, null, 2);
  }
};

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
          token0 {
            symbol
          }
          token1 {
            symbol
          }
        }
      }
    `;

    const variables = {
      poolAddress: poolAddress.toLowerCase(),
    };

    return request(GRAPH_API_URL, query, variables);
  }

  async getTopPools(limit: number = 3) {
    const query = gql`
      query getTopPools($limit: Int!) {
        pools(first: $limit, orderBy: volumeUSD, orderDirection: desc) {
          id
          volumeUSD
          token0 {
            symbol
          }
          token1 {
            symbol
          }
        }
      }
    `;

    return request(GRAPH_API_URL, query, { limit });
  }

  async getGlobalStats() {
    const query = gql`
      {
        factory(id: "0x1F98431c8aD98523631AE4a59f267346ea31F984") {
          poolCount
          txCount
          totalVolumeUSD
          totalVolumeETH
        }
      }
    `;

    return request(GRAPH_API_URL, query);
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
    }
  }
}