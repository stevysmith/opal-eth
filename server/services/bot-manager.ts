import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries, users } from "@db/schema";
import { eq, and } from "drizzle-orm";
import schedule from "node-schedule";
import coinbaseService from './coinbase/agentKit';
import { giveawayPayoutService } from "../src/services/giveawayPayoutService";

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();
  private tokenMap: Map<string, number> = new Map();

  async stopAgent(agentId: number) {
    try {
      console.log(`[Bot ${agentId}] Stopping bot...`);
      const bot = this.bots.get(agentId);
      if (bot) {
        await bot.stop();
        console.log(`[Bot ${agentId}] Bot stopped successfully`);

        for (const [jobId, job] of this.jobs.entries()) {
          if (jobId === agentId) {
            job.cancel();
            this.jobs.delete(jobId);
          }
        }

        for (const [token, id] of this.tokenMap.entries()) {
          if (id === agentId) {
            this.tokenMap.delete(token);
          }
        }

        this.bots.delete(agentId);
        console.log(`[Bot ${agentId}] Cleanup completed`);
        return true;
      }
      console.log(`[Bot ${agentId}] No active bot found to stop`);
      return false;
    } catch (error) {
      console.error(`[Bot ${agentId}] Error stopping bot:`, error);
      this.bots.delete(agentId);
      throw error;
    }
  }

  private async stopBotWithToken(token: string) {
    const existingAgentId = this.tokenMap.get(token);
    if (existingAgentId) {
      console.log(`Found existing bot using token, stopping agent ${existingAgentId}...`);
      await this.stopAgent(existingAgentId);
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

    // Add middleware for logging all updates first
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
      console.log(`[Bot ${agentId}] Finished processing update for ${ctx.updateType}`);
    });

    // Debug logging for command routing
    bot.use((ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        console.log(`[Bot ${agentId}] Processing command:`, {
          command: ctx.message.text.split(' ')[0],
          fullText: ctx.message.text,
          from: ctx.from?.id,
          chat: ctx.chat?.id
        });
      }
      return next();
    });

    try {
      console.log(`[Bot ${agentId}] Testing bot connection...`);
      const me = await bot.telegram.getMe();
      console.log(`[Bot ${agentId}] Bot info:`, me);

      const formattedChannelId = channelId.startsWith('@') ? channelId : `@${channelId}`;
      console.log(`[Bot ${agentId}] Testing channel access for ${formattedChannelId}...`);

      let finalChannelId: string;
      try {
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

      try {
        console.log(`[Bot ${agentId}] Testing message sending to channel ${finalChannelId}...`);
        const testMessage = await bot.telegram.sendMessage(
          finalChannelId,
          '🤖 Bot test message - initializing...'
        );
        console.log(`[Bot ${agentId}] Test message sent successfully:`, testMessage);

        bot.launch().catch(error => {
          console.log(`[Bot ${agentId}] Background launch error (can be ignored if bot is working):`, error.message);
        });

        return { bot, channelId: finalChannelId };
      } catch (error) {
        throw new Error(
          `Failed to send message to channel. Error: ${error.message}\n` +
          'Please ensure the bot has posting permissions in the channel.'
        );
      }
    } catch (error) {
      console.error(`[Bot ${agentId}] Failed to initialize bot:`, error);
      throw error;
    }
  }

  async initializeAgent(agentId: number) {
    try {
      console.log(`[Bot ${agentId}] Stopping existing bot instance if any...`);
      await this.stopAgent(agentId);
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

      await this.stopBotWithToken(config.token);

      const { bot, channelId: finalChannelId } = await this.initializeBotInstance(
        agentId,
        config.token,
        config.channelId
      );

      console.log(`[Bot ${agentId}] Setting up command handlers...`);

      bot.on('message', (ctx) => {
        console.log(`[Bot ${agentId}] Basic message handler received:`, {
          text: ctx.message?.text,
          from: ctx.from,
          chat: ctx.chat
        });

        if (ctx.message?.text?.startsWith('/enter')) {
          console.log(`[Bot ${agentId}] Message identified as enter command`);
          // Log the command matching attempt
          console.log(`[Bot ${agentId}] Attempting to match enter command pattern:`, {
            commandText: ctx.message.text,
            matchPattern: '/enter'
          });
        } else if (ctx.message?.text?.startsWith('/')) {
          console.log(`[Bot ${agentId}] Message identified as other command:`, {
            commandText: ctx.message.text
          });
        }
      });

      bot.command("start", (ctx) => {
        console.log(`[Bot ${agentId}] Start command received from:`, ctx.from);
        ctx.reply(`👋 Welcome! I'm a ${agent.template} bot.\n\nAvailable commands:\n${this.getCommandList(agent.template)}`);
      });

      bot.command("help", (ctx) => {
        ctx.reply(`Available commands:\n${this.getCommandList(agent.template)}`);
      });

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

      bot.catch((error, ctx) => {
        console.error(`[Bot ${agentId}] Unhandled error:`, error);
        ctx.reply("Sorry, something went wrong. Please try again later.");
      });

      this.tokenMap.set(config.token, agentId);
      this.bots.set(agentId, bot);

      console.log(`[Bot ${agentId}] Sending welcome message to channel...`);
      await bot.telegram.sendMessage(
        finalChannelId,
        `🤖 Bot restarted and ready!\n\nTemplate: ${agent.template}\nName: ${agent.name}\n\nUse the following commands:\n${this.getCommandList(agent.template)}`
      );
      console.log(`[Bot ${agentId}] Welcome message sent successfully`);

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
        return "🎉 /giveaway <prize> in <duration_in_mins|hours|h>\n🎫 /enter <giveaway_id> <your-wallet-address>";
      case "qa":
        return "❓ Just send your questions in the chat!";
      default:
        return "";
    }
  }

  private setupPollCommands(bot: Telegraf<Context<Update>>, agentId: number) {
    const handlePollCommand = async (ctx: Context) => {
      try {
        console.log(`[Bot ${agentId}] Processing poll command. Full message:`, ctx.message || ctx.channelPost);
        const text = ctx.message?.text || ctx.channelPost?.text || '';
        const message = text.substring(6).trim();
        console.log(`[Bot ${agentId}] Extracted message:`, message);

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

        const optionsStr = optionsMatch[1]
          .replace(/,\s*]/g, '')
          .replace(/\s+/g, ' ')
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
        endTime.setHours(endTime.getHours() + 24);

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

        const optionsMessage = options
          .map((opt: string, i: number) => `${i + 1}. ${opt}`)
          .join("\n");

        const response = await ctx.reply(
          `📊 New Poll:\n\n${poll.question}\n\n${optionsMessage}\n\nVote using: /vote ${poll.id} <option number>`
        );

        console.log(`[Bot ${agentId}] Poll message sent:`, response);

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

  private setupGiveawayCommands = (bot: Telegraf<Context<Update>>, agentId: number) => {
    console.log(`[Bot ${agentId}] Setting up giveaway commands...`);


    // Register command handlers first
    console.log(`[Bot ${agentId}] Registering command handlers...`);

    const handleEnterCommand = async (ctx: Context) => {
      console.log(`[Bot ${agentId}] Enter command handler executing:`, {
        text: ctx.message?.text,
        from: ctx.from?.id,
        chat: ctx.chat?.id,
        type: ctx.updateType
      });

      try {
        const text = ctx.message?.text || '';
        console.log(`[Bot ${agentId}] Processing enter command text:`, text);

        const parts = text.split(' ');
        console.log(`[Bot ${agentId}] Command parts:`, parts);

        if (parts.length !== 3) {
          console.log(`[Bot ${agentId}] Invalid command format:`, { parts });
          return ctx.reply(
            "Please provide both the giveaway ID and your wallet address.\n" +
            "Format: /enter <giveaway-id> <wallet-address>\n" +
            "Example: /enter 8 0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
          );
        }

        const [, giveawayIdStr, walletAddress] = parts;
        const giveawayId = parseInt(giveawayIdStr);

        console.log(`[Bot ${agentId}] Processing entry:`, {
          giveawayId,
          walletAddress,
          userId: ctx.from?.id
        });

        if (isNaN(giveawayId)) {
          return ctx.reply("Please provide a valid giveaway ID number");
        }

        if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
          return ctx.reply("Please provide a valid Ethereum wallet address starting with 0x");
        }

        const [giveaway] = await db
          .select()
          .from(giveaways)
          .where(eq(giveaways.id, giveawayId))
          .limit(1);

        if (!giveaway) {
          return ctx.reply(`Giveaway #${giveawayId} not found`);
        }

        if (new Date() > giveaway.endTime) {
          return ctx.reply(`Giveaway #${giveawayId} has already ended`);
        }

        if (!ctx.from?.id) {
          return ctx.reply("Could not identify you. Please try again.");
        }

        const userId = ctx.from.id.toString();

        const [existingEntry] = await db
          .select()
          .from(giveawayEntries)
          .where(and(
            eq(giveawayEntries.giveawayId, giveaway.id),
            eq(giveawayEntries.userId, userId)
          ))
          .limit(1);

        if (existingEntry) {
          return ctx.reply("You have already entered this giveaway!");
        }

        await db.insert(giveawayEntries).values({
          giveawayId: giveaway.id,
          userId,
          walletAddress,
        });

        return ctx.reply(
          "🎉 Success! You've been entered into the giveaway!\n\n" +
          `Prize: ${giveaway.prize}\n` +
          `Your wallet: ${walletAddress}\n\n` +
          "Good luck! Winners will be announced in the channel."
        );

      } catch (error) {
        console.error(`[Bot ${agentId}] Error processing entry:`, error);
        return ctx.reply("Sorry, something went wrong. Please try again.");
      }
    };

    // Register both command and pattern matching for /enter
    bot.command('enter', (ctx) => {
      console.log(`[Bot ${agentId}] Command 'enter' matched via command()`);
      return handleEnterCommand(ctx);
    });

    bot.hears(/^\/enter/, (ctx) => {
      console.log(`[Bot ${agentId}] Command 'enter' matched via hears()`);
      return handleEnterCommand(ctx);
    });


    const handleGiveawayCommand = async (ctx: Context) => {
      try {
        const text = ctx.message?.text || ctx.channelPost?.text || '';
        console.log(`[Bot ${agentId}] Processing giveaway command. Full message:`, text);

        const message = text.substring(9).trim();
        console.log(`[Bot ${agentId}] Parsed command text:`, message);

        const match = message.match(/^(.*?)\s+in\s+(\d+)\s*(mins?|minutes?|hours?|h)$/i);
        console.log(`[Bot ${agentId}] Regex match result:`, match);

        if (!match) {
          console.log(`[Bot ${agentId}] Invalid format:`, message);
          return ctx.reply(
            'Invalid format. Use: /giveaway <prize> in <number> <minutes/hours>\n' +
            'Examples:\n' +
            '• /giveaway 1 USDC in 1 hour\n' +
            '• /giveaway 10 USDC in 30 minutes\n' +
            '• /giveaway "Special NFT" in 5 mins'
          );
        }

        const [, prize, amount, unit] = match;
        const isMinutes = unit.toLowerCase().startsWith('min') || unit.toLowerCase() === 'm';
        const durationHours = isMinutes ? parseInt(amount) / 60 : parseInt(amount);
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + durationHours);

        const [giveaway] = await db.insert(giveaways).values({
          agentId,
          prize: prize.trim(),
          startTime: new Date(),
          endTime,
        }).returning();

        const me = await bot.telegram.getMe();
        const response = await ctx.reply(
          `🎉 New Giveaway!\n\n` +
          `Prize: ${prize.trim()}\n` +
          `Duration: ${durationHours < 1 ? `${Math.round(durationHours * 60)} minutes` : `${durationHours} hours`}\n\n` +
          `To participate:\n` +
          `1. Open a direct message with @${me.username}\n` +
          `2. Send the command: /enter ${giveaway.id} <your-wallet-address>\n\n` +
          `Example: /enter ${giveaway.id} 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n\n` +
          `Make sure to provide a valid wallet address to receive your prize if you win!`
        );

        console.log(`[Bot ${agentId}] Sent confirmation message:`, response);

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

            const winner = entries[Math.floor(Math.random() * entries.length)];
            try {
              const payoutResult = await giveawayPayoutService.processGiveawayWinner(giveaway.id, winner.userId);
              await ctx.reply(
                `🎉 Giveaway Ended!\n\n` +
                `Prize: ${prize}\n` +
                `Winner: @${winner.userId}\n` +
                `💰 USDC Payment Sent!\n` +
                `Amount: ${payoutResult.amount} USDC\n` +
                `Transaction: ${payoutResult.txHash}\n\n` +
                `Congratulations!`
              );
            } catch (error) {
              console.error(`[Bot ${agentId}] Error processing payout:`, error);
              await db
                .update(giveaways)
                .set({ winnerId: winner.userId })
                .where(eq(giveaways.id, giveaway.id));

              await ctx.reply(
                `🎉 Giveaway Ended!\n\n` +
                `Prize: ${prize}\n` +
                `Winner: @${winner.userId}\n` +
                `⚠️ Note: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                `Congratulations to the winner! Our team will handle the payout manually.`
              );
            }
          } catch (error) {
            console.error(`[Bot ${agentId}] Error ending giveaway:`, error);
            await ctx.reply('An error occurred while ending the giveaway.');
          }
        }));
      } catch (error) {
        console.error(`[Bot ${agentId}] Error creating giveaway:`, error);
        return ctx.reply("Failed to create giveaway. Please try again.");
      }
    };

    bot.command('giveaway', (ctx) => {
      console.log(`[Bot ${agentId}] Command 'giveaway' matched`);
      return handleGiveawayCommand(ctx);
    });

    bot.on('channel_post', (ctx, next) => {
      if (ctx.channelPost?.text?.startsWith('/giveaway')) {
        console.log(`[Bot ${agentId}] Channel post giveaway command matched`);
        return handleGiveawayCommand(ctx);
      }
      return next();
    });

    console.log(`[Bot ${agentId}] Command handlers registration completed`);
  };


  private setupQACommands(bot: Telegraf<Context<Update>>, agentId: number) {
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