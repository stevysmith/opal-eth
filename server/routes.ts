import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { agents, polls, giveaways, type SelectAgent, type PlatformConfig } from "@db/schema";
import { eq, and, gt } from "drizzle-orm";
import { botManager } from "./services/bot-manager";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Create new agent
  app.post("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
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
      res.status(500).json({ error: "Failed to fetch agents" });
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
          await botManager.initializeAgent(agent.id);
          const [updatedAgent] = await db
            .update(agents)
            .set({ active: true })
            .where(eq(agents.id, agent.id))
            .returning();
          res.json(updatedAgent);
        } catch (error) {
          console.error("Error initializing bot:", error);
          res.status(500).json({ 
            error: "Failed to initialize bot",
            details: error instanceof Error ? error.message : "Unknown error"
          });
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