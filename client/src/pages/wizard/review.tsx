import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useWizard } from "@/hooks/use-wizard";

interface WizardFormData {
  template?: string;
  name?: string;
  persona?: {
    description: string;
    tone: string;
  };
  platform?: string;
  platformConfig?: {
    token: string;
    channelId: string;
  };
}

export default function ReviewStep() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { formData, clearForm } = useWizard<WizardFormData>();

  const createAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agents", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({
        title: "Success!",
        description: "Your bot has been created",
      });
      clearForm();
      navigate("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Review & Deploy</h2>
        <p className="text-muted-foreground">
          Review your bot configuration before deploying
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Bot Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Template</h3>
              <p className="text-sm text-muted-foreground">{formData.template}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Name</h3>
              <p className="text-sm text-muted-foreground">{formData.name}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Persona</h3>
              <p className="text-sm text-muted-foreground">
                Description: {formData.persona?.description}
                <br />
                Tone: {formData.persona?.tone}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Platform</h3>
              <p className="text-sm text-muted-foreground">
                Platform: {formData.platform}
                <br />
                Channel ID: {formData.platformConfig?.channelId}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="outline"
          onClick={() => navigate("/wizard/platform")}
        >
          Back
        </Button>
        <Button
          onClick={() => createAgentMutation.mutate()}
          disabled={createAgentMutation.isPending}
        >
          {createAgentMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Deploy Bot
        </Button>
      </div>
    </div>
  );
}