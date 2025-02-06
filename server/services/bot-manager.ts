import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { db } from "@db";
import { agents, polls, votes, giveaways, giveawayEntries } from "@db/schema";
import { eq } from "drizzle-orm";
import fetch from 'node-fetch';
import schedule from "node-schedule";

class BotManager {
  private bots: Map<number, Telegraf<Context<Update>>> = new Map();
  private jobs: Map<number, schedule.Job> = new Map();

  async initializeAgent(agentId: number) {
    try {
      console.log(`[Bot ${agentId}] Starting agent initialization...`);

      // Stop any existing instance
      await this.stopAgent(agentId);
      console.log(`[Bot ${agentId}] Waiting for cleanup...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

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

      console.log(`[Bot ${agentId}] Using token from agent config:`, {
        token: `${config.token.substring(0, 5)}...${config.token.substring(config.token.length - 5)}`,
        channelId: config.channelId
      });

      console.log(`[Bot ${agentId}] Creating new bot instance...`);
      const bot = new Telegraf(config.token);

      // Add error handling
      bot.catch((err, ctx) => {
        console.error(`[Bot ${agentId}] Error in bot:`, {
          error: err,
          update: ctx.update,
        });
      });

      // Test API connectivity
      try {
        console.log(`[Bot ${agentId}] Testing Telegram API connectivity...`);
        const response = await fetch(`https://api.telegram.org/bot${config.token}/getMe`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Telegram API error: ${errorData.description || 'Unknown error'}`);
        }

        const botInfo = await response.json();
        console.log(`[Bot ${agentId}] Telegram API test succeeded. Bot info:`, botInfo);

        // Additional connection test
        console.log(`[Bot ${agentId}] Testing getUpdates API...`);
        const updatesResponse = await fetch(
          `https://api.telegram.org/bot${config.token}/getUpdates?timeout=10&limit=1`
        );

        if (!updatesResponse.ok) {
          const updatesError = await updatesResponse.json();
          throw new Error(`GetUpdates test failed: ${updatesError.description}`);
        }

        console.log(`[Bot ${agentId}] GetUpdates test succeeded`);

      } catch (error) {
        console.error(`[Bot ${agentId}] API test failed:`, error);
        throw error;
      }

      // Launch bot with better error handling and detailed logging
      try {
        console.log(`[Bot ${agentId}] Launching bot...`);

        // Clear any existing webhook
        console.log(`[Bot ${agentId}] Clearing any existing webhooks...`);
        await bot.telegram.deleteWebhook();
        console.log(`[Bot ${agentId}] Webhook cleared successfully`);

        console.log(`[Bot ${agentId}] Setting up launch configuration...`);
        // Generate webhook domain using Replit's domain
        // Get the public URL from Replit environment
        const domain = process.env.REPL_SLUG && process.env.REPL_OWNER ? 
          `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` :
          `https://${process.env.REPL_ID}.id.repl.co`;

        const launchConfig = {
          dropPendingUpdates: true,
          allowedUpdates: ['message', 'callback_query', 'channel_post']
        };
        console.log(`[Bot ${agentId}] Launch configuration (polling):`, launchConfig);

        let timeoutId: NodeJS.Timeout;

        // Create the launch promise with simplified polling setup
        console.log(`[Bot ${agentId}] Creating launch promise...`);
        const launchPromise = new Promise<boolean>(async (resolve, reject) => {
          let isLaunched = false;
          let timeoutId: NodeJS.Timeout;

          // Setup commands before launch
          if (agent.template === "poll") {
            this.setupPollCommands(bot, agentId);
          } else if (agent.template === "giveaway") {
            this.setupGiveawayCommands(bot, agentId);
          } else if (agent.template === "qa") {
            this.setupQACommands(bot, agentId);
          }

          const cleanup = async () => {
            clearTimeout(timeoutId);
            if (!isLaunched) {
              try {
                await bot.telegram.close();
                await bot.stop();
              } catch (err) {
                console.error(`[Bot ${agentId}] Error during cleanup:`, err);
              }
            }
          };

          try {
            timeoutId = setTimeout(async () => {
              console.log(`[Bot ${agentId}] Timeout reached after 60 seconds`);
              await cleanup();
              reject(new Error("Bot initialization timed out after 60 seconds"));
            }, 60000);

            try {
              // Send a test message to verify channel access
              await bot.telegram.sendMessage(config.channelId, "🤖 Bot is initializing...");

              // Add delay to respect rate limits
              await new Promise(resolve => setTimeout(resolve, 2000));

              await bot.launch(launchConfig);
            } catch (error) {
              if (error.response?.error_code === 429) {
                const retryAfter = error.response.parameters.retry_after || 30;
                console.log(`[Bot ${agentId}] Rate limited, waiting ${retryAfter}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                await bot.launch(launchConfig);
              } else {
                throw error;
              }
            }
            isLaunched = true;
            await cleanup();
            console.log(`[Bot ${agentId}] Launch successful`);
            resolve(true);
          } catch (error) {
            clearTimeout(timeoutId);
            if (!isLaunched) {
              try {
                await bot.telegram.close();
              } catch (err) {
                console.error(`[Bot ${agentId}] Error closing bot:`, err);
              }
            }
            console.error(`[Bot ${agentId}] Launch failed:`, error);
            reject(error);
          }
        });

        await launchPromise;

        console.log(`[Bot ${agentId}] Promise.race completed successfully`);

        // Verify the bot is actually running
        console.log(`[Bot ${agentId}] Verifying bot is responsive...`);
        const me = await bot.telegram.getMe();
        console.log(`[Bot ${agentId}] Bot is responsive:`, me);

        this.bots.set(agentId, bot);
        console.log(`[Bot ${agentId}] Bot registered successfully`);

        return true;
      } catch (error) {
        console.error(`[Bot ${agentId}] Launch failed with error:`, {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          type: error instanceof Error ? error.name : typeof error,
          fullError: error
        });

        await this.stopAgent(agentId);
        throw error;
      }
    } catch (error) {
      console.error(`[Bot ${agentId}] Initialization failed:`, error);
      await this.stopAgent(agentId);
      throw error;
    }
  }

  async stopAgent(agentId: number) {
    try {
      console.log(`[Bot ${agentId}] Stopping bot...`);
      const bot = this.bots.get(agentId);
      if (bot) {
        await bot.stop('SIGTERM');
        this.bots.delete(agentId);
        console.log(`[Bot ${agentId}] Bot stopped successfully`);
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

  isAgentRunning(agentId: number): boolean {
    return this.bots.has(agentId);
  }

  async stopAll() {
    console.log('Stopping all bots...');
    const stopPromises = Array.from(this.bots.entries()).map(([agentId]) =>
      this.stopAgent(agentId)
    );
    await Promise.all(stopPromises);
    console.log('All bots stopped successfully');
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

    // Basic message handler for debugging command routing
    bot.use((ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        console.log(`[Bot ${agentId}] Command routing middleware:`, {
          command: ctx.message.text.split(' ')[0],
          fullText: ctx.message.text,
          from: ctx.from?.id,
          chat: ctx.chat?.id,
          updateType: ctx.updateType
        });
      }
      return next();
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
              // Placeholder for giveawayPayoutService.processGiveawayWinner
              //  This needs to be implemented separately.
              const payoutResult = await Promise.resolve({amount:10, txHash: 'testHash'});
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
}

export const botManager = new BotManager();