import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { agents, polls, giveaways, type SelectAgent, type PlatformConfig, votes, giveawayEntries } from "@db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { botManager } from "./services/bot-manager";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Update the POST /api/agents route to include token validation
  app.post("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Check if token is already in use
      if (req.body.platform === "telegram") {
        const token = req.body.platformConfig?.token;
        if (!token) {
          return res.status(400).json({ error: "Missing Telegram bot token" });
        }

        const existingAgent = await db.query.agents.findFirst({
          where: and(
            eq(agents.platform, "telegram"),
            eq(agents.active, true)
          )
        });

        if (existingAgent && existingAgent.platformConfig.token === token) {
          return res.status(400).json({ 
            error: "Token already in use", 
            message: "This Telegram bot token is already being used by another agent. Each agent needs its own unique bot token. Please create a new bot in Telegram and use its token." 
          });
        }
      }

      const [agent] = await db
        .insert(agents)
        .values({
          ...req.body,
          userId: req.user.id,
          active: false, // Start as inactive
        })
        .returning();

      // Initialize bot if it's a Telegram agent
      if (agent.platform === "telegram") {
        const config = agent.platformConfig as PlatformConfig;
        if (config?.token) {
          try {
            // Initialize bot with timeout
            await Promise.race([
              botManager.initializeAgent(agent.id),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Bot initialization timed out")), 15000)
              )
            ]);

            // Update agent status to active
            const [updatedAgent] = await db
              .update(agents)
              .set({ active: true })
              .where(eq(agents.id, agent.id))
              .returning();

            res.json({
              ...updatedAgent,
              message: `Bot successfully initialized! Check ${config.channelId} for a welcome message.`
            });
            return;
          } catch (error) {
            console.error("Failed to initialize bot:", error);
            // Don't fail the request, just mark the agent as inactive and return with error details
            const [updatedAgent] = await db
              .update(agents)
              .set({ active: false })
              .where(eq(agents.id, agent.id))
              .returning();

            res.json({
              ...updatedAgent,
              error: error instanceof Error ? error.message : "Failed to initialize bot",
              message: "Bot creation succeeded but failed to connect. Make sure the bot token is valid and the bot is an admin in the channel."
            });
            return;
          }
        }
      }

      res.json(agent);
    } catch (error) {
      console.error("Error creating agent:", error);
      res.status(500).json({ 
        error: "Failed to create agent",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // List user's agents with active polls and giveaways
  app.get("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.userId, req.user.id));

      // Fetch active polls and giveaways for each agent
      const enrichedAgents = await Promise.all(userAgents.map(async (agent) => {
        const now = new Date();

        const activePolls = agent.template === "poll" 
          ? await db
              .select()
              .from(polls)
              .where(
                and(
                  eq(polls.agentId, agent.id),
                  gt(polls.endTime, now)
                )
              )
          : [];

        const activeGiveaways = agent.template === "giveaway"
          ? await db
              .select()
              .from(giveaways)
              .where(
                and(
                  eq(giveaways.agentId, agent.id),
                  gt(giveaways.endTime, now)
                )
              )
          : [];

        return {
          ...agent,
          activePolls,
          activeGiveaways,
        };
      }));

      res.json(enrichedAgents);
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ 
        error: "Failed to fetch agents",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // List user's agents with active polls and giveaways
  app.get("/api/agents/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      console.log("Unauthorized access attempt to agent details");
      return res.sendStatus(401);
    }

    try {
      const agentId = parseInt(req.params.id);
      console.log(`Fetching agent ${agentId} for user ${req.user.id}`);

      if (isNaN(agentId)) {
        console.log(`Invalid agent ID: ${req.params.id}`);
        return res.status(400).json({ error: "Invalid agent ID" });
      }

      console.log(`Attempting to find agent with query:`, {
        agentId,
        userId: req.user.id
      });

      const agent = await db.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.userId, req.user.id)
        )
      });

      console.log('Query result:', agent);

      if (!agent) {
        console.log(`Agent ${agentId} not found for user ${req.user.id}`);
        return res.status(404).json({ error: "Agent not found" });
      }

      console.log(`Found agent ${agentId}, fetching polls and giveaways`);
      const now = new Date();

      // Get both active and past polls/giveaways
      const allPolls = agent.template === "poll"
        ? await db
            .select()
            .from(polls)
            .where(eq(polls.agentId, agent.id))
            .orderBy(desc(polls.createdAt))
        : [];

      const allGiveaways = agent.template === "giveaway"
        ? await db
            .select()
            .from(giveaways)
            .where(eq(giveaways.agentId, agent.id))
            .orderBy(desc(giveaways.createdAt))
        : [];

      // For active items, also fetch participation details
      const enrichedPolls = await Promise.all(allPolls.map(async (poll) => {
        const pollVotes = await db
          .select()
          .from(votes)
          .where(eq(votes.pollId, poll.id));

        const voteCounts = (poll.options as string[]).map((_, index) => 
          pollVotes.filter(v => v.selectedOption === index).length
        );

        return {
          ...poll,
          isActive: new Date(poll.endTime) > now,
          totalVotes: pollVotes.length,
          voteCounts
        };
      }));

      const enrichedGiveaways = await Promise.all(allGiveaways.map(async (giveaway) => {
        const entries = await db
          .select()
          .from(giveawayEntries)
          .where(eq(giveawayEntries.giveawayId, giveaway.id));

        return {
          ...giveaway,
          isActive: new Date(giveaway.endTime) > now,
          totalEntries: entries.length
        };
      }));

      res.json({
        ...agent,
        polls: enrichedPolls,
        giveaways: enrichedGiveaways
      });
    } catch (error) {
      console.error("Error fetching agent:", error);
      res.status(500).json({ 
        error: "Failed to fetch agent details",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Toggle agent activation
  app.post("/api/agents/:id/toggle", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const agentId = parseInt(req.params.id);
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (!agent || agent.userId !== req.user.id) {
        return res.status(404).json({ error: "Agent not found" });
      }

      if (agent.active) {
        await botManager.stopAgent(agent.id);
        const [updatedAgent] = await db
          .update(agents)
          .set({ active: false })
          .where(eq(agents.id, agent.id))
          .returning();
        res.json(updatedAgent);
      } else {
        try {
          const success = await botManager.initializeAgent(agent.id);
          const [updatedAgent] = await db
            .update(agents)
            .set({ active: success }) // Only set active if initialization succeeded
            .where(eq(agents.id, agent.id))
            .returning();
          res.json(updatedAgent);
        } catch (error) {
          console.error("Error initializing bot:", error);
          // If it's just a launch timeout but messages work, consider it a success
          if (error instanceof Error && error.message === "Launch timeout") {
            const [updatedAgent] = await db
              .update(agents)
              .set({ active: true })
              .where(eq(agents.id, agent.id))
              .returning();
            res.json(updatedAgent);
          } else {
            const [updatedAgent] = await db
              .update(agents)
              .set({ active: false })
              .where(eq(agents.id, agent.id))
              .returning();
            res.status(500).json({ 
              ...updatedAgent,
              error: "Failed to initialize bot",
              details: error instanceof Error ? error.message : "Unknown error"
            });
          }
        }
      }
    } catch (error) {
      console.error("Error toggling agent:", error);
      res.status(500).json({ error: "Failed to toggle agent" });
    }
  });

  // Clean up bots when server shuts down
  process.on('SIGTERM', async () => {
    await botManager.stopAll();
    process.exit(0);
  });

  const httpServer = createServer(app);
  return httpServer;
}