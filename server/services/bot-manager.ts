import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries } from "@db/schema";
import { eq } from "drizzle-orm";
import schedule from "node-schedule";

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();

  async initializeAgent(agentId: number) {
    try {
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
        console.log(`Initializing bot ${agentId} for channel ${config.channelId}...`);
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

        // Test channel connection with retries
        let retryCount = 0;
        const maxRetries = 3;
        let messageSuccess = false;

        while (retryCount < maxRetries && !messageSuccess) {
          try {
            await bot.telegram.sendMessage(
              config.channelId,
              `🤖 Bot initialized successfully!\n\nTemplate: ${agent.template}\nName: ${agent.name}\n\nUse the following commands:\n${this.getCommandList(agent.template)}`
            );
            console.log(`Bot ${agentId} successfully connected to channel ${config.channelId}`);
            messageSuccess = true;

            // Try to launch the bot, but don't fail if it times out as long as messages work
            try {
              await Promise.race([
                bot.launch(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Launch timeout")), 5000))
              ]);
            } catch (error) {
              // Only log the launch timeout, don't throw
              if (error.message === "Launch timeout") {
                console.log(`Bot ${agentId} launch timed out, but messages are working`);
              } else {
                throw error;
              }
            }

            this.bots.set(agentId, bot);
            return true;
          } catch (error) {
            retryCount++;
            if (retryCount === maxRetries) {
              console.error(`Failed to send test message to channel ${config.channelId}:`, error);
              throw new Error(
                `Bot couldn't send messages to the channel after ${maxRetries} attempts. Make sure the bot is an admin in the channel and has permission to post messages.`
              );
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      return this.bots.has(agentId);
    } catch (error) {
      console.error(`Error in initializeAgent for agent ${agentId}:`, error);
      await this.stopAgent(agentId);
      throw error;
    }
  }

  private getCommandList(template: string): string {
    switch (template) {
      case "poll":
        return "📊 /poll \"Question\" [\"Option1\",\"Option2\"]\n🗳️ /vote <poll_id> <option_number>";
      case "giveaway":
        return "🎉 /giveaway \"Prize\" <duration_in_hours>\n🎫 /enter <giveaway_id>";
      case "qa":
        return "❓ Just send your questions in the chat!";
      default:
        return "";
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
        console.log("Received giveaway command:", message);

        const prizeMatch = message.match(/"([^"]+)"/);
        const durationMatch = message.match(/in (\d+)\s*(mins?|hours?|h)/i);

        if (!prizeMatch || !durationMatch) {
          console.log("Invalid format received:", { prizeMatch, durationMatch });
          return ctx.reply('Invalid format. Use: /giveaway "Prize" <duration_in_hours>\nExample: /giveaway "Special Prize" in 2 hours');
        }

        const prize = prizeMatch[1];
        const amount = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();
        console.log("Parsed giveaway details:", { prize, amount, unit });

        // Convert duration to hours
        const durationHours = unit.startsWith('min') ? amount / 60 : amount;

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + durationHours);

        console.log("Creating giveaway in database:", {
          agentId,
          prize,
          startTime: new Date(),
          endTime,
        });

        // Wrap the database operations in a try-catch block
        try {
          const [giveaway] = await db.insert(giveaways).values({
            agentId,
            prize,
            startTime: new Date(),
            endTime,
          }).returning();

          console.log("Successfully created giveaway in database:", giveaway);

          await ctx.reply(
            `🎉 New Giveaway!\n\nPrize: ${giveaway.prize}\nEnds in: ${durationHours < 1 ? `${Math.round(durationHours * 60)} minutes` : `${durationHours} hours`}\n\nEnter using: /enter ${giveaway.id}`
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
        } catch (dbError) {
          console.error("Database error creating giveaway:", dbError);
          throw dbError;
        }
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
      try {
        await bot.stop();
      } catch (error) {
        console.error(`Error stopping bot ${agentId}:`, error);
      }
      this.bots.delete(agentId);
    }
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