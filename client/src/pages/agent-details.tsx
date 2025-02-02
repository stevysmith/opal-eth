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
import { formatDistanceToNow } from "date-fns";

// Define types for the enriched agent data
interface Poll {
  id: number;
  question: string;
  options: string[];
  endTime: string;
  isActive: boolean;
  totalVotes: number;
  voteCounts: number[];
}

interface Giveaway {
  id: number;
  prize: string;
  endTime: string;
  isActive: boolean;
  totalEntries: number;
}

interface EnrichedAgent {
  id: number;
  userId: number;
  name: string;
  template: "poll" | "qa" | "giveaway";
  persona: {
    description: string;
    tone: string;
  };
  platform: "telegram" | "discord";
  platformConfig: {
    token: string;
    channelId: string;
  };
  active: boolean;
  polls?: Poll[];
  giveaways?: Giveaway[];
}

export default function AgentDetailsPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id ? parseInt(params.id) : undefined;

  const { data: agent, isLoading } = useQuery<EnrichedAgent>({
    queryKey: [`/api/agents/${agentId}`],
    enabled: !!agentId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center">Agent not found</div>;
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

        {agent.template === "poll" && agent.polls && agent.polls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Polls</CardTitle>
              <CardDescription>All polls created by this agent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agent.polls.map((poll) => (
                <div key={poll.id} className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">{poll.question}</h3>
                  <div className="space-y-2">
                    {poll.options.map((option, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{option}</span>
                        <span className="text-muted-foreground">
                          {poll.voteCounts[index]} votes
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-between items-center text-sm text-muted-foreground">
                    <span>Total votes: {poll.totalVotes}</span>
                    <span>
                      {poll.isActive ? (
                        `Ends ${formatDistanceToNow(new Date(poll.endTime), { addSuffix: true })}`
                      ) : (
                        `Ended ${formatDistanceToNow(new Date(poll.endTime), { addSuffix: true })}`
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {agent.template === "giveaway" && agent.giveaways && agent.giveaways.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Giveaways</CardTitle>
              <CardDescription>All giveaways created by this agent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agent.giveaways.map((giveaway) => (
                <div key={giveaway.id} className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">{giveaway.prize}</h3>
                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>{giveaway.totalEntries} entries</span>
                    <span>
                      {giveaway.isActive ? (
                        `Ends ${formatDistanceToNow(new Date(giveaway.endTime), { addSuffix: true })}`
                      ) : (
                        `Ended ${formatDistanceToNow(new Date(giveaway.endTime), { addSuffix: true })}`
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}