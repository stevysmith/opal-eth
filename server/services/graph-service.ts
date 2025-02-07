import { request, gql } from "graphql-request";
import OpenAI from "openai";
import { Telegraf } from "telegraf";
import { db } from "@db";
import { graphNotifications } from "@db/schema";
import { eq } from "drizzle-orm";

// Documentation for Graph Integration
/**
 * Graph Integration Details
 * Subgraph: Uniswap V3 Analytics
 * Deployment URL: https://thegraph.com/hosted-service/subgraph/uniswap/uniswap-v3
 * 
 * Implementation Features:
 * 1. Real-time DeFi analytics using The Graph protocol
 * 2. AI-powered query generation and response formatting
 * 3. Advanced error handling with retries
 * 4. Automated notifications for key DeFi metrics
 * 
 * Key Query Types:
 * - Pool Statistics (Volume, Liquidity, Fees)
 * - Volume Analytics (Historical and Real-time)
 * - Token Metrics (Price, Volume, Liquidity)
 * - Liquidity Analysis (Positions, Concentrations)
 * - Market Trends (Price Movements, Volume Patterns)
 */

const GRAPH_API_URL = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enhanced error handling for type safety
interface GraphError extends Error {
  message: string;
  stack?: string;
}

// Helper function to add retry logic for Graph queries with improved error typing
async function retryRequest(queryFn: () => Promise<any>, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log("[GraphService] Executing GraphQL query:", {
        attempt,
        query: queryFn.toString()
      });
      return await queryFn();
    } catch (error: unknown) {
      const graphError = error as GraphError;
      console.error("[GraphService] Query error:", {
        attempt,
        error: graphError.message,
        stack: graphError.stack
      });
      if (attempt === maxRetries || !graphError.message?.includes("indexers")) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

export class GraphService {
  private bot: Telegraf;

  constructor(telegramToken: string) {
    this.bot = new Telegraf(telegramToken);
  }

  async formatPoolStats(data: any) {
    try {
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        return "⚠️ Unable to fetch DeFi statistics at the moment. The network may be experiencing temporary issues. Please try again in a few minutes.";
      }

      // Enhanced prompt for more detailed and structured analysis
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a DeFi analytics expert that creates detailed, structured updates about Uniswap pool activity. Format your response as a JSON object with a 'message' field containing the formatted message. Use markdown formatting, emojis, and clear sections to present the information effectively. Include percentage changes and highlight significant movements.",
          },
          {
            role: "user",
            content: `Please provide a comprehensive analysis of this DeFi data with key metrics, trends, and notable changes: ${JSON.stringify(data, null, 2)}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");
      return aiResponse.message || "Error formatting message";
    } catch (error) {
      console.error("Error formatting pool stats:", error);
      if (error.message?.includes("indexers")) {
        return "🔄 The DeFi analytics service is currently syncing with the latest blockchain data. Please try again in a few minutes.";
      }
      const stats = data.factory || data.pool || data.pools;
      return `📊 DeFi Analytics Update\n\n${JSON.stringify(stats, null, 2)}`;
    }
  }

  // Added: Historical volume analysis with time-weighted metrics
  async getHistoricalVolumeAnalysis(timeframe: '24h' | '7d' | '30d') {
    const daysAgo = timeframe === '24h' ? 1 : timeframe === '7d' ? 7 : 30;
    const timestamp = Math.floor(Date.now() / 1000) - (daysAgo * 24 * 60 * 60);

    const query = gql`
      query getHistoricalVolume($timestamp: Int!) {
        uniswapDayDatas(
          where: { date_gt: $timestamp }
          orderBy: date
          orderDirection: desc
        ) {
          date
          volumeUSD
          volumeETH
          feesUSD
          tvlUSD
          txCount
        }
      }
    `;

    return retryRequest(() => request(GRAPH_API_URL, query, { timestamp }));
  }

  // Added: Liquidity concentration analysis
  async getLiquidityConcentration(poolAddress: string) {
    const query = gql`
      query getLiquidityConcentration($poolAddress: String!) {
        pool(id: $poolAddress) {
          tick
          feeTier
          liquidity
          sqrtPrice
          token0Price
          token1Price
          ticks(first: 1000, orderBy: tickIdx) {
            tickIdx
            liquidityNet
            liquidityGross
            price0
            price1
          }
        }
      }
    `;

    return retryRequest(() => request(GRAPH_API_URL, query, { poolAddress: poolAddress.toLowerCase() }));
  }

  // Added: Market trend analysis with price impact
  async getMarketTrendAnalysis(poolAddress: string, timeframe: '24h' | '7d') {
    const hoursAgo = timeframe === '24h' ? 24 : 168;
    const timestamp = Math.floor(Date.now() / 1000) - (hoursAgo * 60 * 60);

    const query = gql`
      query getMarketTrends($poolAddress: String!, $timestamp: Int!) {
        pool(id: $poolAddress) {
          token0 {
            symbol
            decimals
          }
          token1 {
            symbol
            decimals
          }
          swaps(
            first: 1000
            orderBy: timestamp
            where: { timestamp_gt: $timestamp }
          ) {
            timestamp
            amount0
            amount1
            amountUSD
          }
          poolDayData(
            first: ${timeframe === '24h' ? '24' : '7'}
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            tvlUSD
            token0Price
            token1Price
          }
        }
      }
    `;

    return retryRequest(() => request(GRAPH_API_URL, query, {
      poolAddress: poolAddress.toLowerCase(),
      timestamp
    }));
  }

  async generateGraphQuery(userQuestion: string): Promise<string> {
    try {
      console.log("[GraphService] Generating query for question:", userQuestion);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a DeFi data expert. Generate a complete, valid GraphQL query for the Uniswap v3 subgraph that answers the user's question. For volume queries, use the factory entity with totalVolumeUSD field. Example query for volume:
            {
              factory(id: "0x1F98431c8aD98523631AE4a59f267346ea31F984") {
                totalVolumeUSD
                totalVolumeETH
              }
            }

            Available entities and fields:
            - Factory: poolCount, txCount, totalVolumeUSD, totalVolumeETH, totalFeesUSD, totalValueLockedUSD
            - Pool: token0{symbol,name}, token1{symbol,name}, feeTier, liquidity, volumeUSD, totalValueLockedUSD
            - Token: symbol, name, volume, volumeUSD, totalValueLocked, poolCount, txCount
            - Swap: timestamp, amount0, amount1, amountUSD
            - UniswapDayData: volumeUSD, volumeETH, feesUSD, txCount, tvlUSD
            - PoolDayData: pool{id}, volumeUSD, tvlUSD, token0Price, token1Price

            Return only the GraphQL query string, no explanations or JSON wrapper.`
          },
          {
            role: "user",
            content: userQuestion
          }
        ]
      });

      let query = response.choices[0]?.message?.content || "";

      // Clean up the query
      query = query.trim();

      // Log the generated query
      console.log("[GraphService] Raw generated query:", query);

      // Add factory ID if missing
      if (query.includes('factory {') && !query.includes('factory(id:')) {
        query = query.replace('factory {', 'factory(id: "0x1F98431c8aD98523631AE4a59f267346ea31F984") {');
      }

      // Validate query structure
      if (!query.startsWith('{') || !query.endsWith('}')) {
        console.error("[GraphService] Invalid query structure:", query);
        throw new Error("Generated query is not properly formatted");
      }

      console.log("[GraphService] Final processed query:", query);

      return query;
    } catch (error) {
      console.error("Error generating GraphQL query:", error);
      throw new Error("Failed to generate query from question");
    }
  }

  async executeUserQuery(userQuestion: string): Promise<any> {
    const query = await this.generateGraphQuery(userQuestion);
    console.log("[GraphService] Generated query from question:", {
      question: userQuestion,
      query
    });

    return retryRequest(() => request(GRAPH_API_URL, query));
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
          txCount
          totalVolumeUSD
          totalVolumeETH
        }
      }
    `;

    console.log("[GraphService] Executing getGlobalStats with query:", query);
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
          if (config.timeRange) {
            data = await this.getHistoricalVolumeAnalysis(config.timeRange);
          } else {
            data = await this.getTopPools(config.topN);
          }
          break;
        case "market_trends":
          data = await this.getMarketTrendAnalysis(config.poolAddress, config.timeRange);
          break;
        case "liquidity_analysis":
          data = await this.getLiquidityConcentration(config.poolAddress);
          break;
        case "global_stats":
          data = await this.getGlobalStats();
          break;
        default:
          throw new Error(`Unknown query type: ${notification.queryType}`);
      }

      const formattedMessage = await this.formatPoolStats(data);
      await this.bot.telegram.sendMessage(channelId, formattedMessage, { parse_mode: 'Markdown' });

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