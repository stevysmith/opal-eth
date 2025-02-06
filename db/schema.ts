import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  walletAddress: text("wallet_address"),  // Added for USDC payouts
});

export const mpcWallets = pgTable("mpc_wallets", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  walletId: text("wallet_id").notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date()),
});

// Define the platform config schema
const platformConfigSchema = z.object({
  token: z.string(),
  channelId: z.string(),
});

export type PlatformConfig = z.infer<typeof platformConfigSchema>;

// Extend the agent schema with proper platformConfig typing
export const agentSchema = z.object({
  id: z.number(),
  userId: z.number(),
  name: z.string(),
  template: z.enum(["poll", "qa", "giveaway"]),
  persona: z.object({
    description: z.string(),
    tone: z.string(),
  }),
  platform: z.enum(["telegram", "discord"]),
  platformConfig: platformConfigSchema,
  active: z.boolean(),
  createdAt: z.string(),
});

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  template: text("template").notNull(), // poll, qa, giveaway
  persona: jsonb("persona").notNull(),
  platform: text("platform").notNull(), // telegram, discord
  platformConfig: jsonb("platform_config").notNull(),
  active: boolean("active").default(false).notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const polls = pgTable("polls", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  question: text("question").notNull(),
  options: jsonb("options").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date()),
});

export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id").notNull().references(() => polls.id),
  userId: text("user_id").notNull(), // Telegram/Discord user ID
  selectedOption: integer("selected_option").notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date()),
});

export const giveaways = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  prize: text("prize").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  winnerId: text("winner_id"), // Telegram/Discord user ID of winner
  createdAt: timestamp("created_at").notNull().default(new Date()),
});

export const giveawayEntries = pgTable("giveaway_entries", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull().references(() => giveaways.id),
  userId: text("user_id").notNull(), // Telegram/Discord user ID
  walletAddress: text("wallet_address").notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date()),
});

// Relations
export const agentRelations = relations(agents, ({ one, many }) => ({
  user: one(users, {
    fields: [agents.userId],
    references: [users.id],
  }),
  polls: many(polls),
  giveaways: many(giveaways),
  mpcWallet: one(mpcWallets, {
    fields: [agents.id],
    references: [mpcWallets.agentId],
  }),
}));

export const pollRelations = relations(polls, ({ one, many }) => ({
  agent: one(agents, {
    fields: [polls.agentId],
    references: [agents.id],
  }),
  votes: many(votes),
}));

export const giveawayRelations = relations(giveaways, ({ one, many }) => ({
  agent: one(agents, {
    fields: [giveaways.agentId],
    references: [agents.id],
  }),
  entries: many(giveawayEntries),
}));

// Schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;


// Update the agent schemas to use the new typing
export const insertAgentSchema = createInsertSchema(agents, {
  platformConfig: z.object({
    token: z.string(),
    channelId: z.string(),
  }),
});
export const selectAgentSchema = createSelectSchema(agents, {
  platformConfig: z.object({
    token: z.string(),
    channelId: z.string(),
  }),
});

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type SelectAgent = z.infer<typeof agentSchema>;

// Add schemas for new tables
export const insertPollSchema = createInsertSchema(polls);
export const selectPollSchema = createSelectSchema(polls);
export type InsertPoll = typeof polls.$inferInsert;
export type SelectPoll = typeof polls.$inferSelect;

export const insertGiveawaySchema = createInsertSchema(giveaways);
export const selectGiveawaySchema = createSelectSchema(giveaways);
export type InsertGiveaway = typeof giveaways.$inferInsert;
export type SelectGiveaway = typeof giveaways.$inferSelect;