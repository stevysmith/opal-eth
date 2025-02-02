import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { agents, type SelectAgent, type PlatformConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import { botManager } from "./services/bot-manager";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Create new agent
  app.post("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const [agent] = await db.insert(agents).values({
        ...req.body,
        userId: req.user.id,
      }).returning();

      // Initialize bot if it's a Telegram agent
      if (agent.platform === "telegram") {
        const config = agent.platformConfig as PlatformConfig;
        if (config?.token) {
          try {
            await botManager.initializeAgent(agent.id);
            // Update agent status to active
            await db
              .update(agents)
              .set({ active: true })
              .where(eq(agents.id, agent.id));
            agent.active = true;
          } catch (error) {
            console.error("Failed to initialize bot:", error);
            // Don't fail the request, just mark the agent as inactive
            agent.active = false;
          }
        }
      }

      res.json(agent);
    } catch (error) {
      console.error("Error creating agent:", error);
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  // List user's agents
  app.get("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userAgents = await db.select().from(agents).where(eq(agents.userId, req.user.id));
    res.json(userAgents);
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
        await db
          .update(agents)
          .set({ active: false })
          .where(eq(agents.id, agent.id));
        res.json({ active: false });
      } else {
        await botManager.initializeAgent(agent.id);
        await db
          .update(agents)
          .set({ active: true })
          .where(eq(agents.id, agent.id));
        res.json({ active: true });
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