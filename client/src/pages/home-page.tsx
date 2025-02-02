import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, MessageSquare, Award, BarChart3, Loader2 } from "lucide-react";
import type { SelectAgent } from "@db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();
  const { data: agents, isLoading } = useQuery<SelectAgent[]>({ 
    queryKey: ["/api/agents"],
    retry: false
  });
  const [pendingAgents, setPendingAgents] = useState<Set<number>>(new Set());

  const toggleMutation = useMutation({
    mutationFn: async (agentId: number) => {
      setPendingAgents(prev => new Set(prev).add(agentId));
      try {
        const response = await apiRequest("POST", `/api/agents/${agentId}/toggle`);
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.message || "Failed to toggle agent");
        }
        return response.json();
      } finally {
        setPendingAgents(prev => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Welcome, {user?.username}</h1>
            <p className="text-muted-foreground">Manage your social media bots</p>
          </div>
          <div className="flex gap-4">
            <Link href="/wizard">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Agent
              </Button>
            </Link>
            <Button variant="outline" onClick={() => logoutMutation.mutate()}>
              Logout
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((agent) => (
            <Card key={agent.id} className="relative">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{agent.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      {agent.template === "poll" && <BarChart3 className="w-4 h-4" />}
                      {agent.template === "giveaway" && <Award className="w-4 h-4" />}
                      {agent.template === "qa" && <MessageSquare className="w-4 h-4" />}
                      {agent.template}
                    </CardDescription>
                  </div>
                  <Badge variant={agent.active ? "default" : "secondary"}>
                    {agent.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">Platform:</span> {agent.platform}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Channel:</span>{" "}
                    {(agent.platformConfig as { channelId: string }).channelId}
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <div className="w-full flex justify-between items-center">
                  <Link href={`/agents/${agent.id}`}>
                    <Button variant="ghost" size="sm">
                      View Details
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleMutation.mutate(agent.id)}
                    disabled={pendingAgents.has(agent.id)}
                  >
                    {pendingAgents.has(agent.id) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {agent.active ? "Stop" : "Start"}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>

        {agents?.length === 0 && (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2">No agents yet</h2>
            <p className="text-muted-foreground mb-4">
              Create your first social media bot to get started
            </p>
            <Link href="/wizard">
              <Button>Create Agent</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}