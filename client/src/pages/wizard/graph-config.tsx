import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useWizard } from "@/hooks/use-wizard";

const graphConfigSchema = z.object({
  queryType: z.enum(["pool_stats", "volume_stats", "global_stats"]),
  schedule: z.enum(["hourly", "daily", "weekly"]),
  poolAddress: z.string().min(42, "Pool address must be 42 characters").optional(),
  timeRange: z.enum(["24h", "7d", "30d"]),
  topN: z.coerce.number().min(1).max(100).optional(),
});

type FormData = z.infer<typeof graphConfigSchema>;

export default function GraphConfigStep() {
  const [, navigate] = useLocation();
  const { formData, setFormData } = useWizard();

  const form = useForm<FormData>({
    resolver: zodResolver(graphConfigSchema),
    defaultValues: {
      queryType: "pool_stats",
      schedule: "daily",
      timeRange: "24h",
      topN: 3,
    },
  });

  const watchQueryType = form.watch("queryType");

  const onSubmit = form.handleSubmit((data) => {
    const scheduleMap = {
      hourly: "0 * * * *",
      daily: "0 0 * * *",
      weekly: "0 0 * * 0",
    };

    const queryConfig = {
      ...(data.queryType === "pool_stats"
        ? { poolAddress: data.poolAddress, timeRange: data.timeRange }
        : data.queryType === "volume_stats"
        ? { topN: data.topN, timeRange: data.timeRange }
        : {}),
    };

    setFormData({
      ...formData,
      graphConfig: {
        queryType: data.queryType,
        schedule: scheduleMap[data.schedule],
        queryConfig,
      },
    });

    navigate("/wizard/platform");
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Configure Analytics</h2>
        <p className="text-muted-foreground">
          Set up your DeFi analytics notifications
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-6">
          <FormField
            control={form.control}
            name="queryType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Query Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select what to query" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pool_stats">Pool Statistics</SelectItem>
                    <SelectItem value="volume_stats">Top Volume Pools</SelectItem>
                    <SelectItem value="global_stats">Global Statistics</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Choose what kind of data you want to track
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="schedule"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Update Frequency</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="hourly">Every Hour</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  How often should notifications be sent
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {watchQueryType === "pool_stats" && (
            <>
              <FormField
                control={form.control}
                name="poolAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pool Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormDescription>
                      The Uniswap V3 pool address to monitor
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time Range</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select time range" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="24h">Last 24 Hours</SelectItem>
                        <SelectItem value="7d">Last 7 Days</SelectItem>
                        <SelectItem value="30d">Last 30 Days</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Period to analyze pool statistics
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {watchQueryType === "volume_stats" && (
            <>
              <FormField
                control={form.control}
                name="topN"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Number of Pools</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>
                      How many top pools to include (1-100)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time Range</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select time range" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="24h">Last 24 Hours</SelectItem>
                        <SelectItem value="7d">Last 7 Days</SelectItem>
                        <SelectItem value="30d">Last 30 Days</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Period to analyze volume statistics
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/wizard/persona")}
            >
              Back
            </Button>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}