import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries } from "@db/schema";
import { eq } from "drizzle-orm";
import schedule from "node-schedule";

const INIT_TIMEOUT = 10000; // 10 seconds timeout for bot initialization

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();

  async initializeAgent(agentId: number) {
    try {
      // Get agent details from database
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (!agent || agent.platform !== "telegram") {
        throw new Error("Invalid agent configuration");
      }

      const config = agent.platformConfig as { token: string; channelId: string };
      if (!config?.token) {
        throw new Error("Missing Telegram bot token");
      }

      // Initialize bot if not exists
      if (!this.bots.has(agentId)) {
        const bot = new Telegraf(config.token);

        // Set up command handlers based on template
        switch (agent.template) {
          case "poll":
            this.setupPollCommands(bot, agentId);
            break;
          case "giveaway":
            this.setupGiveawayCommands(bot, agentId);
            break;
          case "qa":
            this.setupQACommands(bot, agentId);
            break;
        }

        // Launch bot with timeout
        const launchPromise = bot.launch();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Bot initialization timed out")), INIT_TIMEOUT);
        });

        try {
          await Promise.race([launchPromise, timeoutPromise]);
          this.bots.set(agentId, bot);
          return bot;
        } catch (error) {
          console.error(`Failed to initialize bot ${agentId}:`, error);
          throw error;
        }
      }

      return this.bots.get(agentId)!;
    } catch (error) {
      console.error(`Error in initializeAgent for agent ${agentId}:`, error);
      throw error;
    }
  }

  private setupPollCommands(bot: Telegraf<Context<Update>>, agentId: number) {
    bot.command("poll", async (ctx) => {
      try {
        const message = ctx.message.text.substring(6); // Remove '/poll '
        const [question, optionsStr] = message.split('" [');

        if (!question || !optionsStr) {
          return ctx.reply("Invalid format. Use: /poll \"Question\" [\"Option1\",\"Option2\"]");
        }

        const options = JSON.parse(optionsStr);
        if (!Array.isArray(options)) {
          return ctx.reply("Options must be an array");
        }

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + 24); // 24 hour polls

        const [poll] = await db.insert(polls).values({
          agentId,
          question: question.replace(/^"|"$/g, ''),
          options: options,
          startTime: new Date(),
          endTime,
        }).returning();

        // Send poll message
        const optionsMessage = options
          .map((opt: string, i: number) => `${i + 1}. ${opt}`)
          .join("\n");

        await ctx.reply(
          `📊 New Poll:\n\n${poll.question}\n\n${optionsMessage}\n\nVote using: /vote ${poll.id} <option number>`
        );

        // Schedule poll end
        this.jobs.set(poll.id, schedule.scheduleJob(endTime, async () => {
          const results = await db
            .select()
            .from(votes)
            .where(eq(votes.pollId, poll.id));

          const counts = results.reduce((acc: Record<number, number>, vote) => {
            acc[vote.selectedOption] = (acc[vote.selectedOption] || 0) + 1;
            return acc;
          }, {});

          const resultsMessage = options
            .map((opt: string, i: number) => 
              `${opt}: ${counts[i] || 0} votes`)
            .join("\n");

          await ctx.reply(
            `📊 Poll Results:\n\n${poll.question}\n\n${resultsMessage}`
          );
        }));
      } catch (error) {
        console.error("Error creating poll:", error);
        ctx.reply("Failed to create poll. Please try again.");
      }
    });

    bot.command("vote", async (ctx) => {
      try {
        const [, pollId, optionNum] = ctx.message.text.split(" ");
        const option = parseInt(optionNum) - 1;

        const [poll] = await db
          .select()
          .from(polls)
          .where(eq(polls.id, parseInt(pollId)))
          .limit(1);

        if (!poll) {
          return ctx.reply("Poll not found");
        }

        if (new Date() > poll.endTime) {
          return ctx.reply("This poll has ended");
        }

        if (option < 0 || option >= (poll.options as string[]).length) {
          return ctx.reply("Invalid option number");
        }

        await db.insert(votes).values({
          pollId: poll.id,
          userId: ctx.from.id.toString(),
          selectedOption: option,
        });

        ctx.reply("Vote recorded!");
      } catch (error) {
        console.error("Error recording vote:", error);
        ctx.reply("Failed to record vote. Please try again.");
      }
    });
  }

  private setupGiveawayCommands(bot: Telegraf<Context<Update>>, agentId: number) {
    bot.command("giveaway", async (ctx) => {
      try {
        const message = ctx.message.text.substring(9); // Remove '/giveaway '
        const [prize, duration] = message.split('" ');

        if (!prize || !duration) {
          return ctx.reply('Invalid format. Use: /giveaway "Prize" <duration in hours>');
        }

        const durationHours = parseInt(duration);
        if (isNaN(durationHours)) {
          return ctx.reply("Duration must be a number of hours");
        }

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + durationHours);

        const [giveaway] = await db.insert(giveaways).values({
          agentId,
          prize: prize.replace(/^"|"$/g, ''),
          startTime: new Date(),
          endTime,
        }).returning();

        await ctx.reply(
          `🎉 New Giveaway!\n\nPrize: ${giveaway.prize}\nEnds in: ${durationHours} hours\n\nEnter using: /enter ${giveaway.id}`
        );

        // Schedule giveaway end
        this.jobs.set(giveaway.id, schedule.scheduleJob(endTime, async () => {
          const entries = await db
            .select()
            .from(giveawayEntries)
            .where(eq(giveawayEntries.giveawayId, giveaway.id));

          if (entries.length === 0) {
            await ctx.reply(`Giveaway for ${giveaway.prize} ended with no participants!`);
            return;
          }

          // Pick random winner
          const winner = entries[Math.floor(Math.random() * entries.length)];

          await db
            .update(giveaways)
            .set({ winnerId: winner.userId })
            .where(eq(giveaways.id, giveaway.id));

          await ctx.reply(
            `🎉 Giveaway Ended!\n\nPrize: ${giveaway.prize}\nWinner: @${winner.userId}\n\nCongratulations!`
          );
        }));
      } catch (error) {
        console.error("Error creating giveaway:", error);
        ctx.reply("Failed to create giveaway. Please try again.");
      }
    });

    bot.command("enter", async (ctx) => {
      try {
        const giveawayId = parseInt(ctx.message.text.split(" ")[1]);

        const [giveaway] = await db
          .select()
          .from(giveaways)
          .where(eq(giveaways.id, giveawayId))
          .limit(1);

        if (!giveaway) {
          return ctx.reply("Giveaway not found");
        }

        if (new Date() > giveaway.endTime) {
          return ctx.reply("This giveaway has ended");
        }

        await db.insert(giveawayEntries).values({
          giveawayId: giveaway.id,
          userId: ctx.from.id.toString(),
        });

        ctx.reply("You've been entered into the giveaway!");
      } catch (error) {
        console.error("Error entering giveaway:", error);
        ctx.reply("Failed to enter giveaway. Please try again.");
      }
    });
  }

  private setupQACommands(bot: Telegraf<Context<Update>>, agentId: number) {
    // For Q&A, we'll just log the questions for now
    bot.on("text", (ctx) => {
      const message = ctx.message.text;
      console.log(`Q&A Bot ${agentId} received: ${message}`);
      ctx.reply("Thank you for your question! It has been logged.");
    });
  }

  async stopAgent(agentId: number) {
    const bot = this.bots.get(agentId);
    if (bot) {
      await bot.stop();
      this.bots.delete(agentId);
    }
  }

  async stopAll() {
    for (const [agentId] of this.bots) {
      await this.stopAgent(agentId);
    }

    // Clear all scheduled jobs
    for (const job of this.jobs.values()) {
      job.cancel();
    }
    this.jobs.clear();
  }
}

export const botManager = new BotManager();