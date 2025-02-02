import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries } from "@db/schema";
import { eq, and } from "drizzle-orm";
import schedule from "node-schedule";

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();
  private tokenMap: Map<string, number> = new Map(); // Track which agent is using which token

  async stopAgent(agentId: number) {
    try {
      console.log(`[Bot ${agentId}] Stopping bot...`);
      const bot = this.bots.get(agentId);
      if (bot) {
        // First stop the bot
        await bot.stop();
        console.log(`[Bot ${agentId}] Bot stopped successfully`);

        // Remove all jobs associated with this agent
        for (const [jobId, job] of this.jobs.entries()) {
          if (jobId === agentId) {
            job.cancel();
            this.jobs.delete(jobId);
          }
        }

        // Remove token mapping
        for (const [token, id] of this.tokenMap.entries()) {
          if (id === agentId) {
            this.tokenMap.delete(token);
          }
        }

        // Remove bot from the map
        this.bots.delete(agentId);
        console.log(`[Bot ${agentId}] Cleanup completed`);
        return true;
      }
      console.log(`[Bot ${agentId}] No active bot found to stop`);
      return false;
    } catch (error) {
      console.error(`[Bot ${agentId}] Error stopping bot:`, error);
      // Still try to clean up
      this.bots.delete(agentId);
      throw error;
    }
  }

  private async stopBotWithToken(token: string) {
    const existingAgentId = this.tokenMap.get(token);
    if (existingAgentId) {
      console.log(`Found existing bot using token, stopping agent ${existingAgentId}...`);
      await this.stopAgent(existingAgentId);
      // Increase wait time for Telegram API to fully clear the session
      await new Promise(resolve => setTimeout(resolve, 10000));
      console.log(`Waited for cleanup after stopping agent ${existingAgentId}`);
    }
  }

  isAgentRunning(agentId: number): boolean {
    return this.bots.has(agentId);
  }

  private async initializeBotInstance(agentId: number, token: string, channelId: string) {
    console.log(`[Bot ${agentId}] Creating bot instance with token length:`, token.length);

    const bot = new Telegraf(token);

    // Add middleware for detailed logging of all updates
    bot.use(async (ctx, next) => {
      console.log(`[Bot ${agentId}] Received update:`, {
        type: ctx.updateType,
        message: ctx.message ? {
          text: ctx.message.text,
          from: ctx.message.from,
          chat: ctx.message.chat
        } : undefined,
        from: ctx.from,
        chat: ctx.chat
      });
      await next();
    });

    // Test connection before proceeding
    try {
      console.log(`[Bot ${agentId}] Testing bot connection...`);
      const me = await bot.telegram.getMe();
      console.log(`[Bot ${agentId}] Bot info:`, me);

      // Format channelId appropriately
      const formattedChannelId = channelId.startsWith('@') ? channelId : `@${channelId}`;
      console.log(`[Bot ${agentId}] Testing channel access for ${formattedChannelId}...`);

      let finalChannelId: string;
      try {
        // First try with the @ format
        const chat = await bot.telegram.getChat(formattedChannelId);
        console.log(`[Bot ${agentId}] Successfully accessed channel:`, {
          id: chat.id,
          type: chat.type,
          title: 'title' in chat ? chat.title : undefined
        });
        finalChannelId = chat.id.toString();
      } catch (firstError) {
        console.log(`[Bot ${agentId}] Failed with @ format, trying numeric ID...`);
        try {
          const numericId = channelId.replace('@', '');
          const chat = await bot.telegram.getChat(numericId);
          console.log(`[Bot ${agentId}] Successfully accessed channel with numeric ID:`, {
            id: chat.id,
            type: chat.type,
            title: 'title' in chat ? chat.title : undefined
          });
          finalChannelId = numericId;
        } catch (secondError) {
          throw new Error(
            `Cannot access channel ${channelId}. Error: ${firstError.message}\n` +
            'Please ensure:\n' +
            '1. The channel ID is correct\n' +
            '2. The bot is added to the channel\n' +
            '3. The bot is an administrator in the channel'
          );
        }
      }

      // Test message sending explicitly
      try {
        console.log(`[Bot ${agentId}] Testing message sending to channel ${finalChannelId}...`);
        const testMessage = await bot.telegram.sendMessage(
          finalChannelId,
          '🤖 Bot test message - initializing...'
        );
        console.log(`[Bot ${agentId}] Test message sent successfully:`, testMessage);
      } catch (error) {
        throw new Error(
          `Failed to send message to channel. Error: ${error.message}\n` +
          'Please ensure the bot has posting permissions in the channel.'
        );
      }

      return { bot, channelId: finalChannelId };
    } catch (error) {
      console.error(`[Bot ${agentId}] Failed to initialize bot:`, error);
      throw error;
    }
  }

  async initializeAgent(agentId: number) {
    try {
      // Stop any existing bot first
      console.log(`[Bot ${agentId}] Stopping existing bot instance if any...`);
      await this.stopAgent(agentId);
      // Increase wait time for cleanup
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`[Bot ${agentId}] Initializing new agent...`);

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

      // Stop any other bot using this token and wait for cleanup
      await this.stopBotWithToken(config.token);

      // Initialize bot with more detailed error handling
      const { bot, channelId: finalChannelId } = await this.initializeBotInstance(
        agentId,
        config.token,
        config.channelId
      );

      // Set up commands
      console.log(`[Bot ${agentId}] Setting up command handlers...`);

      bot.command("start", (ctx) => {
        console.log(`[Bot ${agentId}] Start command received from:`, ctx.from);
        ctx.reply(`👋 Welcome! I'm a ${agent.template} bot.\n\nAvailable commands:\n${this.getCommandList(agent.template)}`);
      });

      bot.command("help", (ctx) => {
        ctx.reply(`Available commands:\n${this.getCommandList(agent.template)}`);
      });

      // Set up template-specific commands
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

      // Start bot in polling mode with better error handling and retry mechanism
      console.log(`[Bot ${agentId}] Starting bot in polling mode...`);
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          console.log(`[Bot ${agentId}] Launch attempt ${retryCount + 1}/${maxRetries}`);
          const startTime = Date.now();

          // Add pre-launch logging
          console.log(`[Bot ${agentId}] Preparing to launch bot...`);
          console.log(`[Bot ${agentId}] Current bot state:`, {
            token: `${config.token.substring(0, 5)}...${config.token.substring(config.token.length - 5)}`,
            finalChannelId
          });

          try {
            // Launch with timeout and specific error handling
            await Promise.race([
              bot.launch().catch(e => {
                if (e.message?.includes('409: Conflict')) {
                  console.log(`[Bot ${agentId}] Detected conflict, waiting longer...`);
                  return new Promise(resolve => setTimeout(resolve, 15000))
                    .then(() => bot.launch());
                }
                throw e;
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Internal launch timeout (30s)")), 30000)
              )
            ]);

            const launchTime = Date.now() - startTime;
            console.log(`[Bot ${agentId}] Bot launched successfully in ${launchTime}ms`);

            // Register token usage
            this.tokenMap.set(config.token, agentId);

            // Send welcome message after successful launch
            console.log(`[Bot ${agentId}] Sending welcome message to channel...`);
            await bot.telegram.sendMessage(
              finalChannelId,
              `🤖 Bot restarted and ready!\n\nTemplate: ${agent.template}\nName: ${agent.name}\n\nUse the following commands:\n${this.getCommandList(agent.template)}`
            );
            console.log(`[Bot ${agentId}] Welcome message sent successfully`);

            // Store bot instance
            this.bots.set(agentId, bot);
            return true;

          } catch (error) {
            console.error(`[Bot ${agentId}] Launch attempt ${retryCount + 1} failed:`, {
              error: error.message,
              stack: error.stack,
              type: error.constructor.name
            });

            if (error.message?.includes('409: Conflict')) {
              console.log(`[Bot ${agentId}] Conflict detected, waiting longer before retry...`);
              await new Promise(resolve => setTimeout(resolve, 15000));
            }

            retryCount++;
            if (retryCount < maxRetries) {
              const delay = 2000 * retryCount; // Exponential backoff
              console.log(`[Bot ${agentId}] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        } catch (error) {
          console.error(`[Bot ${agentId}] Outer error during launch attempt:`, error);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }

      throw new Error(`Failed to start bot after ${maxRetries} attempts`);
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
    // Handle both message and channel_post commands
    const handlePollCommand = async (ctx: Context) => {
      try {
        console.log(`[Bot ${agentId}] Processing poll command. Full message:`, ctx.message || ctx.channelPost);
        const text = ctx.message?.text || ctx.channelPost?.text || '';
        const message = text.substring(6).trim(); // Remove '/poll ' and trim
        console.log(`[Bot ${agentId}] Extracted message:`, message);

        // Find the question part (everything up to the first [)
        const questionMatch = message.match(/"([^"]+)"/);
        if (!questionMatch) {
          console.log(`[Bot ${agentId}] No valid question found in format`);
          return ctx.reply("Invalid format. Use: /poll \"Question\" [\"Option1\",\"Option2\"]");
        }

        const question = questionMatch[1];
        const optionsMatch = message.match(/\[(.*)\]/);

        if (!optionsMatch) {
          console.log(`[Bot ${agentId}] No valid options array found`);
          return ctx.reply("Invalid format. Use: /poll \"Question\" [\"Option1\",\"Option2\"]");
        }

        // Clean up the options string
        const optionsStr = optionsMatch[1]
          .replace(/,\s*]/g, '') // Remove trailing commas
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();

        console.log(`[Bot ${agentId}] Cleaned options string:`, optionsStr);

        let options;
        try {
          options = JSON.parse(`[${optionsStr}]`);
          console.log(`[Bot ${agentId}] Parsed options:`, options);
        } catch (error) {
          console.error(`[Bot ${agentId}] Error parsing options:`, error);
          return ctx.reply(
            "Invalid options format. Make sure to use proper JSON array syntax.\n" +
            'Example: /poll "What is your favorite color?" ["Red","Blue","Green"]'
          );
        }

        if (!Array.isArray(options) || options.length < 2) {
          console.log(`[Bot ${agentId}] Invalid options array:`, options);
          return ctx.reply("You must provide at least 2 options");
        }

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + 24); // 24 hour polls

        console.log(`[Bot ${agentId}] Creating poll in database:`, {
          question,
          options,
          endTime
        });

        const [poll] = await db.insert(polls).values({
          agentId,
          question,
          options,
          startTime: new Date(),
          endTime,
        }).returning();

        console.log(`[Bot ${agentId}] Poll created:`, poll);

        // Send poll message
        const optionsMessage = options
          .map((opt: string, i: number) => `${i + 1}. ${opt}`)
          .join("\n");

        const response = await ctx.reply(
          `📊 New Poll:\n\n${poll.question}\n\n${optionsMessage}\n\nVote using: /vote ${poll.id} <option number>`
        );

        console.log(`[Bot ${agentId}] Poll message sent:`, response);

        // Schedule poll end
        this.jobs.set(poll.id, schedule.scheduleJob(endTime, async () => {
          try {
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
          } catch (error) {
            console.error(`[Bot ${agentId}] Error sending poll results:`, error);
          }
        }));
      } catch (error) {
        console.error(`[Bot ${agentId}] Error creating poll:`, error);
        ctx.reply("Failed to create poll. Please try again.");
      }
    };

    // Register command handlers for both regular messages and channel posts
    bot.command("poll", handlePollCommand);
    bot.on('channel_post', (ctx, next) => {
      if (ctx.channelPost?.text?.startsWith('/poll')) {
        return handlePollCommand(ctx);
      }
      return next();
    });

    const handleVoteCommand = async (ctx: Context) => {
      try {
        const text = ctx.message?.text || ctx.channelPost?.text || '';
        const [, pollId, optionNum] = text.split(" ");
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

        const userId = (ctx.from?.id || ctx.channelPost?.sender_chat?.id)?.toString();
        if (!userId) {
          return ctx.reply("Could not identify voter");
        }

        await db.insert(votes).values({
          pollId: poll.id,
          userId,
          selectedOption: option,
        });

        ctx.reply("Vote recorded!");
      } catch (error) {
        console.error("Error recording vote:", error);
        ctx.reply("Failed to record vote. Please try again.");
      }
    };

    bot.command("vote", handleVoteCommand);
    bot.on('channel_post', (ctx, next) => {
      if (ctx.channelPost?.text?.startsWith('/vote')) {
        return handleVoteCommand(ctx);
      }
      return next();
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
    console.log('Stopping all bots...');
    for (const [agentId] of this.bots.entries()) {
      await this.stopAgent(agentId);
    }

    for (const job of this.jobs.values()) {
      job.cancel();
    }
    this.jobs.clear();
    console.log('All bots stopped successfully');
  }
}

export const botManager = new BotManager();