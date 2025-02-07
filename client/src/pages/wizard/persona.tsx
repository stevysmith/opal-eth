import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const personaSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().min(10).max(500),
  tone: z.string().min(3).max(50),
});

type PersonaFormData = z.infer<typeof personaSchema>;

export default function PersonaStep() {
  const [, navigate] = useLocation();
  const { formData, setFormData } = useWizard();

  const form = useForm<PersonaFormData>({
    resolver: zodResolver(personaSchema),
    defaultValues: {
      name: formData.name || "",
      description: formData.persona?.description || "",
      tone: formData.persona?.tone || "",
    },
  });

  const onSubmit = form.handleSubmit((data: PersonaFormData) => {
    setFormData({
      ...formData,
      name: data.name,
      persona: {
        description: data.description,
        tone: data.tone
      }
    });
    // Navigate to platform or graph-config based on template
    if (formData.template === "graph_notify") {
      navigate("/wizard/graph-config");
    } else {
      navigate("/wizard/platform");
    }
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Create Your Bot's Persona</h2>
        <p className="text-muted-foreground">
          Define how your bot will interact with users
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bot Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. QuizMaster" {...field} />
                </FormControl>
                <FormDescription>
                  This is how users will identify your bot
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe what your bot does..."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tone of Voice</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Friendly and Professional"
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
              onClick={() => navigate("/wizard")}
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