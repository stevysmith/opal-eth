import { scheduleJob } from 'node-schedule';
import { db } from "@db";
import { agents, graphNotifications } from "@db/schema";
import { eq } from 'drizzle-orm';
import { GraphService } from './graph-service';
import { z } from 'zod';

// Define the platform config type
const platformConfigSchema = z.object({
  token: z.string(),
  channelId: z.string(),
});

type PlatformConfig = z.infer<typeof platformConfigSchema>;

export class SchedulerService {
  private graphService: GraphService;
  private jobs: Map<number, any> = new Map();

  constructor(telegramToken: string) {
    this.graphService = new GraphService(telegramToken);
  }

  async initializeJobs() {
    try {
      // Get all active notifications
      const notifications = await db.query.graphNotifications.findMany({
        where: eq(graphNotifications.active, true),
      });

      // Schedule each notification
      for (const notification of notifications) {
        this.scheduleNotification(notification);
      }
    } catch (error) {
      console.error('Error initializing notification jobs:', error);
    }
  }

  scheduleNotification(notification: any) {
    try {
      // Cancel existing job if any
      const existingJob = this.jobs.get(notification.id);
      if (existingJob) {
        existingJob.cancel();
      }

      // Schedule new job
      const job = scheduleJob(notification.schedule, async () => {
        try {
          const agent = await db.query.agents.findFirst({
            where: eq(agents.id, notification.agentId),
          });

          if (agent && agent.platformConfig) {
            const config = platformConfigSchema.parse(agent.platformConfig);
            await this.graphService.sendNotification(
              notification.agentId,
              config.channelId
            );
          }
        } catch (error) {
          console.error(`Error executing notification job ${notification.id}:`, error);
        }
      });

      // Store job reference
      this.jobs.set(notification.id, job);
    } catch (error) {
      console.error(`Error scheduling notification ${notification.id}:`, error);
    }
  }

  async refreshSchedule(notificationId: number) {
    try {
      const notification = await db.query.graphNotifications.findFirst({
        where: eq(graphNotifications.id, notificationId),
      });

      if (notification) {
        this.scheduleNotification(notification);
      }
    } catch (error) {
      console.error(`Error refreshing schedule for notification ${notificationId}:`, error);
    }
  }

  stopAll() {
    // Convert Map values to array before iteration
    Array.from(this.jobs.values()).forEach(job => {
      job.cancel();
    });
    this.jobs.clear();
  }
}