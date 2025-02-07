import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useWizard } from "@/hooks/use-wizard";

const formSchema = z.object({
  queryType: z.string(),
  schedule: z.string(),
});

type FormData = z.infer<typeof formSchema>;

export default function GraphConfigStep() {
  const [, navigate] = useLocation();
  const { formData, setFormData } = useWizard();

  // Redirect if not graph_notify template
  if (formData.template !== "graph_notify") {
    navigate("/wizard");
    return null;
  }

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      queryType: "pool_stats",
      schedule: "daily",
    },
  });

  function onSubmit(data: FormData) {
    const scheduleMap: Record<string, string> = {
      hourly: "0 * * * *",
      daily: "0 0 * * *",
      weekly: "0 0 * * 0",
    };

    setFormData({
      ...formData,
      graphConfig: {
        queryType: data.queryType,
        schedule: scheduleMap[data.schedule],
      },
    });

    navigate("/wizard/platform");
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Analytics Configuration</h2>
        <p className="text-muted-foreground">
          Configure your DeFi analytics notifications
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                <FormMessage />
              </FormItem>
            )}
          />

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