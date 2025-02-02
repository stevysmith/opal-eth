import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare, Award, BarChart3 } from "lucide-react";
import type { SelectAgent } from "@db/schema";
import { formatDistanceToNow } from "date-fns";

export default function AgentDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading } = useQuery<SelectAgent>({
    queryKey: [`/api/agents/${id}`],
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return <div>Agent not found</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">{agent.name}</h1>
            <div className="flex items-center gap-2 text-muted-foreground">
              {agent.template === "poll" && <BarChart3 className="w-4 h-4" />}
              {agent.template === "giveaway" && <Award className="w-4 h-4" />}
              {agent.template === "qa" && <MessageSquare className="w-4 h-4" />}
              {agent.template}
            </div>
          </div>
          <Badge variant={agent.active ? "default" : "secondary"}>
            {agent.active ? "Active" : "Inactive"}
          </Badge>
        </div>

        {agent.template === "poll" && agent.activePolls && agent.activePolls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active Polls</CardTitle>
              <CardDescription>Currently running polls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agent.activePolls.map((poll) => (
                <div key={poll.id} className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">{poll.question}</h3>
                  <div className="space-y-2">
                    {(poll.options as string[]).map((option, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{option}</span>
                        <span className="text-muted-foreground">
                          {/* Add vote count here when available */}
                          0 votes
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mt-4">
                    Ends {formatDistanceToNow(new Date(poll.endTime), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {agent.template === "giveaway" && agent.activeGiveaways && agent.activeGiveaways.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active Giveaways</CardTitle>
              <CardDescription>Currently running giveaways</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agent.activeGiveaways.map((giveaway) => (
                <div key={giveaway.id} className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">{giveaway.prize}</h3>
                  <p className="text-sm text-muted-foreground">
                    Ends {formatDistanceToNow(new Date(giveaway.endTime), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
