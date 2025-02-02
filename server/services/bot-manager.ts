import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries } from "@db/schema";
import { eq, and } from "drizzle-orm";
import schedule from "node-schedule";

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();

  async stopAgent(agentId: number) {
    const bot = this.bots.get(agentId);
    if (bot) {
      try {
        console.log(`[Bot ${agentId}] Stopping bot...`);
        await bot.stop();
        console.log(`[Bot ${agentId}] Bot stopped successfully`);
        // Remove all jobs associated with this agent
        for (const [jobId, job] of this.jobs.entries()) {
          job.cancel();
          this.jobs.delete(jobId);
        }
        // Wait a bit after stopping to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`[Bot ${agentId}] Error stopping bot:`, error);
      }
      this.bots.delete(agentId);
    }
  }

  async initializeAgent(agentId: number) {
    try {
      // Stop any existing bot first
      await this.stopAgent(agentId);
      console.log(`[Bot ${agentId}] Creating new bot instance...`);

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

      // Initialize new bot
      const bot = new Telegraf(config.token);

      // Add middleware for logging all updates
      bot.use(async (ctx, next) => {
        console.log(`[Bot ${agentId}] Received update:`, {
          type: ctx.updateType,
          message: ctx.message,
          from: ctx.from,
        });
        await next();
      });

      // Set up basic commands first
      bot.command("start", (ctx) => {
        console.log(`[Bot ${agentId}] Start command received from:`, ctx.from);
        ctx.reply(`👋 Welcome! I'm a ${agent.template} bot.\n\nAvailable commands:\n${this.getCommandList(agent.template)}`);
      });
    
      bot.command("help", (ctx) => {
        ctx.reply(`Available commands:\n${this.getCommandList(agent.template)}`);
      });

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

      // Add error handler for unhandled errors
      bot.catch((error, ctx) => {
        console.error(`[Bot ${agentId}] Unhandled error:`, error);
        ctx.reply("Sorry, something went wrong. Please try again later.");
      });

      // Start bot in polling mode with retries
      console.log(`[Bot ${agentId}] Starting bot in polling mode...`);
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await bot.launch();
            console.log(`[Bot ${agentId}] Bot launched successfully`);
            break;
          } catch (error) {
            if (error.message.includes('409: Conflict')) {
              console.log(`[Bot ${agentId}] Launch attempt ${attempt} failed with conflict, retrying after delay...`);
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        console.error(`[Bot ${agentId}] Failed to launch bot:`, error);
        throw error;
      }

      // Test channel connection
      try {
        await bot.telegram.sendMessage(
          config.channelId,
          `🤖 Bot restarted and ready!\n\nTemplate: ${agent.template}\nName: ${agent.name}\n\nUse the following commands:\n${this.getCommandList(agent.template)}`
        );
        console.log(`[Bot ${agentId}] Successfully sent test message to channel ${config.channelId}`);
      } catch (error) {
        console.error(`[Bot ${agentId}] Failed to send test message:`, error);
        throw new Error("Failed to send test message to channel. Make sure the bot is an admin in the channel.");
      }

      // Store bot instance
      this.bots.set(agentId, bot);
      return true;
    } catch (error) {
      console.error(`[Bot ${agentId}] Failed to initialize:`, error);
      await this.stopAgent(agentId);
      throw error;
    }
  }

  private getCommandList(template: string): string {
    switch (template) {
      case "poll":
        return "📊 /poll \"Question\" [\"Option1\",\"Option2\"]\n🗳️ /vote <poll_id> <option_number>";
      case "giveaway":
        return "🎉 /giveaway \"Prize\" in <duration_in_mins|hours|h>\n🎫 /enter <giveaway_id>";
      case "qa":
        return "❓ Just send your questions in the chat!";
      default:
        return "";
    }
  }

  private setupPollCommands(bot: Telegraf<Context<Update>>, agentId: number) {
    bot.command("poll", async (ctx) => {
      try {
        console.log(`[Bot ${agentId}] Received poll command:`, ctx.message.text);
        const message = ctx.message.text.substring(6).trim(); // Remove '/poll ' and trim

        // Find the question part (everything up to the first [)
        const questionEndIndex = message.lastIndexOf('" [');
        if (questionEndIndex === -1) {
          return ctx.reply("Invalid format. Use: /poll \"Question\" [\"Option1\",\"Option2\"]");
        }

        const question = message.substring(0, questionEndIndex + 1);
        const optionsStr = message.substring(questionEndIndex + 2);

        console.log(`[Bot ${agentId}] Parsed poll:`, { question, optionsStr });

        if (!question || !optionsStr) {
          return ctx.reply("Invalid format. Use: /poll \"Question\" [\"Option1\",\"Option2\"]");
        }

        // Clean up the options string and parse it
        const cleanOptionsStr = optionsStr
          .replace(/,\s*]/g, ']') // Remove trailing commas before ]
          .replace(/\s+/g, ' '); // Normalize whitespace

        let options;
        try {
          options = JSON.parse(cleanOptionsStr);
        } catch (error) {
          console.error(`[Bot ${agentId}] Error parsing options:`, error);
          return ctx.reply(
            "Invalid options format. Make sure to use proper JSON array syntax.\n" +
            'Example: /poll "What is your favorite color?" ["Red","Blue","Green"]'
          );
        }

        if (!Array.isArray(options) || options.length < 2) {
          return ctx.reply("You must provide at least 2 options");
        }

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + 24); // 24 hour polls

        console.log(`[Bot ${agentId}] Creating poll in database:`, {
          question: question.replace(/^"|"$/g, ''),
          options,
          endTime
        });

        const [poll] = await db.insert(polls).values({
          agentId,
          question: question.replace(/^"|"$/g, ''),
          options: options,
          startTime: new Date(),
          endTime,
        }).returning();

        console.log(`[Bot ${agentId}] Poll created:`, poll);

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
        console.error(`[Bot ${agentId}] Error creating poll:`, error);
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
    console.log(`[Bot ${agentId}] Setting up giveaway commands`);

    bot.command("giveaway", async (ctx) => {
      try {
        console.log(`[Bot ${agentId}] Received giveaway command:`, ctx.message.text);
        const message = ctx.message.text.substring(9).trim(); // Remove '/giveaway '

        // Updated regex to better handle the command format
        const match = message.match(/^"([^"]+)"\s+in\s+(\d+)\s*(mins?|hours?|h)$/i);

        if (!match) {
          console.log(`[Bot ${agentId}] Invalid format:`, message);
          return ctx.reply(
            'Invalid format. Use: /giveaway "Prize Name" in <number> <hours/mins>\n' +
            'Examples:\n' +
            '• /giveaway "Cool Prize" in 1 hour\n' +
            '• /giveaway "Quick Prize" in 30 mins'
          );
        }

        const [, prize, amount, unit] = match;
        console.log(`[Bot ${agentId}] Parsed giveaway:`, { prize, amount, unit });

        // Convert duration to hours
        const durationHours = unit.startsWith('min') ? parseInt(amount) / 60 : parseInt(amount);
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + durationHours);

        console.log(`[Bot ${agentId}] Creating giveaway with duration:`, durationHours, 'hours');

        // Create the giveaway
        const [giveaway] = await db.insert(giveaways).values({
          agentId,
          prize,
          startTime: new Date(),
          endTime,
        }).returning();

        console.log(`[Bot ${agentId}] Created giveaway:`, giveaway);

        // Send confirmation message
        await ctx.reply(
          `🎉 New Giveaway!\n\n` +
          `Prize: ${prize}\n` +
          `Duration: ${durationHours < 1 ? `${Math.round(durationHours * 60)} minutes` : `${durationHours} hours`}\n\n` +
          `Type /enter ${giveaway.id} to participate!`
        );

        // Schedule end of giveaway
        this.jobs.set(giveaway.id, schedule.scheduleJob(endTime, async () => {
          try {
            const entries = await db
              .select()
              .from(giveawayEntries)
              .where(eq(giveawayEntries.giveawayId, giveaway.id));

            if (entries.length === 0) {
              await ctx.reply(`Giveaway for "${prize}" ended with no participants!`);
              return;
            }

            // Pick random winner
            const winner = entries[Math.floor(Math.random() * entries.length)];

            await db
              .update(giveaways)
              .set({ winnerId: winner.userId })
              .where(eq(giveaways.id, giveaway.id));

            await ctx.reply(
              `🎉 Giveaway Ended!\n\n` +
              `Prize: ${prize}\n` +
              `Winner: @${winner.userId}\n\n` +
              `Congratulations!`
            );
          } catch (error) {
            console.error(`[Bot ${agentId}] Error ending giveaway:`, error);
            await ctx.reply('An error occurred while ending the giveaway.');
          }
        }));

      } catch (error) {
        console.error(`[Bot ${agentId}] Error handling giveaway command:`, error);
        await ctx.reply("Failed to create giveaway. Please try again.");
      }
    });

    // Add command for entering giveaways
    bot.command("enter", async (ctx) => {
      try {
        console.log(`[Bot ${agentId}] Received enter command:`, ctx.message.text);
        const giveawayId = parseInt(ctx.message.text.split(" ")[1]);

        if (isNaN(giveawayId)) {
          return ctx.reply("Please provide a valid giveaway ID. Example: /enter 123");
        }

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

        // Check if user already entered
        const [existingEntry] = await db
          .select()
          .from(giveawayEntries)
          .where(and(
            eq(giveawayEntries.giveawayId, giveaway.id),
            eq(giveawayEntries.userId, ctx.from.id.toString())
          ))
          .limit(1);

        if (existingEntry) {
          return ctx.reply("You've already entered this giveaway!");
        }

        await db.insert(giveawayEntries).values({
          giveawayId: giveaway.id,
          userId: ctx.from.id.toString(),
        });

        ctx.reply("🎫 You've been entered into the giveaway! Good luck!");
      } catch (error) {
        console.error(`[Bot ${agentId}] Error handling enter command:`, error);
        ctx.reply("Failed to enter giveaway. Please try again.");
      }
    });

    // Debug logging for all messages
    bot.on("message", (ctx) => {
      console.log(`[Bot ${agentId}] Received message:`, {
        from: ctx.from?.id,
        text: ctx.message,
        type: ctx.updateType
      });
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

  async stopAll() {
    for (const [agentId] of Array.from(this.bots.entries())) {
      await this.stopAgent(agentId);
    }

    for (const job of Array.from(this.jobs.values())) {
      job.cancel();
    }
    this.jobs.clear();
  }
}

export const botManager = new BotManager();