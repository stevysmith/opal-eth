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

const platformSchema = z.object({
  platform: z.enum(["telegram", "discord"]),
  token: z.string().min(1),
  channelId: z.string().min(1),
});

export default function PlatformStep() {
  const [, navigate] = useLocation();
  const form = useForm({
    resolver: zodResolver(platformSchema),
    defaultValues: {
      platform: "telegram",
      token: "",
      channelId: "",
    },
  });

  const onSubmit = form.handleSubmit(() => {
    navigate("/wizard/review");
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Configure Platform</h2>
        <p className="text-muted-foreground">
          Choose where your bot will operate and set up the connection
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-6">
          <FormField
            control={form.control}
            name="platform"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Platform</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a platform" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="telegram">Telegram</SelectItem>
                    <SelectItem value="discord">Discord</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bot Token</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Enter your bot token"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  You can get this from BotFather
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="channelId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Channel ID</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter the channel ID"
                    {...field}
                  />
                </FormControl>
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
            <Button type="submit">Review</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
