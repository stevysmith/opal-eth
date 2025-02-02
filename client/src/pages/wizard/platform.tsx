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

const platformSchema = z.object({
  platform: z.enum(["telegram", "discord"]),
  token: z.string().min(1, "Bot token is required")
    .refine(
      (token) => token.includes(":"),
      "Invalid bot token format. It should contain a colon (:)"
    ),
  channelId: z.string().min(1, "Channel ID is required"),
});

export default function PlatformStep() {
  const [, navigate] = useLocation();
  const { formData, setFormData } = useWizard();

  const form = useForm({
    resolver: zodResolver(platformSchema),
    defaultValues: {
      platform: formData.platform as "telegram" | "discord" || "telegram",
      token: formData.platformConfig?.token || "",
      channelId: formData.platformConfig?.channelId || "",
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    setFormData({
      platform: data.platform,
      platformConfig: {
        token: data.token,
        channelId: data.channelId,
      },
    });
    navigate("/wizard/review");
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Configure Platform</h2>
        <p className="text-muted-foreground">
          Configure where your bot will operate and set up the connection details
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
                  Get this from @BotFather on Telegram. It should look like "123456789:ABCdefGHIjklmNOPQRstuvwxyz"
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
                    placeholder="Enter the channel ID or @username"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Either use your channel's username (e.g., "@mychannel") or get the numeric ID by forwarding a message to @userinfobot
                </FormDescription>
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