import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { agents } from "@db/schema";
import { eq } from "drizzle-orm";

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  // Create new agent
  app.post("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const agent = await db.insert(agents).values({
      ...req.body,
      userId: req.user.id,
    }).returning();
    res.json(agent[0]);
  });

  // List user's agents
  app.get("/api/agents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userAgents = await db.select().from(agents).where(eq(agents.userId, req.user.id));
    res.json(userAgents);
  });

  const httpServer = createServer(app);
  return httpServer;
}
