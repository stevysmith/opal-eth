import { useQuery } from "@tanstack/react-query";
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
import { apiRequest } from "@/lib/queryClient";

interface Poll {
  id: number;
  question: string;
  options: string[];
  startTime: string;
  endTime: string;
  isActive: boolean;
  totalVotes: number;
  voteCounts: number[];
}

interface Giveaway {
  id: number;
  prize: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  totalEntries: number;
  winnerId?: string;
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
  createdAt: string;
  polls?: Poll[];
  giveaways?: Giveaway[];
}

function PollDetails({ polls }: { polls: Poll[] }) {
  if (!polls || polls.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Poll Results</CardTitle>
          <CardDescription>No polls have been created yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Poll Results</CardTitle>
        <CardDescription>
          View all polls and their statistics
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {polls.map((poll) => (
          <Card key={poll.id} className="border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{poll.question}</CardTitle>
                <Badge variant={poll.isActive ? "default" : "secondary"}>
                  {poll.isActive ? "Active" : "Ended"}
                </Badge>
              </div>
              <CardDescription>
                {poll.isActive
                  ? `Ends ${formatDistanceToNow(new Date(poll.endTime), { addSuffix: true })}`
                  : `Ended ${formatDistanceToNow(new Date(poll.endTime), { addSuffix: true })}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {poll.options.map((option, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{option}</span>
                      <span className="text-muted-foreground">
                        {poll.voteCounts[index]} votes
                        ({poll.totalVotes > 0
                          ? Math.round((poll.voteCounts[index] / poll.totalVotes) * 100)
                          : 0}%)
                      </span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all"
                        style={{
                          width: `${poll.totalVotes > 0
                            ? (poll.voteCounts[index] / poll.totalVotes) * 100
                            : 0}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-sm text-muted-foreground mt-4">
                  Total votes: {poll.totalVotes}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}

function GiveawayDetails({ giveaways }: { giveaways: Giveaway[] }) {
  console.log("Rendering GiveawayDetails with giveaways:", giveaways);

  if (!giveaways || giveaways.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Giveaway Status</CardTitle>
          <CardDescription>No giveaways have been created yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Giveaway Status</CardTitle>
        <CardDescription>
          Track all giveaways and their participants
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {giveaways.map((giveaway) => (
          <Card key={giveaway.id} className="border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{giveaway.prize}</CardTitle>
                <Badge variant={giveaway.isActive ? "default" : "secondary"}>
                  {giveaway.isActive ? "Active" : "Ended"}
                </Badge>
              </div>
              <CardDescription>
                {giveaway.isActive
                  ? `Ends ${formatDistanceToNow(new Date(giveaway.endTime), { addSuffix: true })}`
                  : `Ended ${formatDistanceToNow(new Date(giveaway.endTime), { addSuffix: true })}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Total Entries
                  </span>
                  <span className="font-medium">{giveaway.totalEntries}</span>
                </div>
                {!giveaway.isActive && giveaway.winnerId && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Winner</span>
                    <span className="font-medium">@{giveaway.winnerId}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}

interface AgentDetailsPageProps {
  id: string;
}

export default function AgentDetailsPage({ id }: AgentDetailsPageProps) {
  const agentId = parseInt(id);

  console.log("AgentDetailsPage: Initialized with agentId:", agentId);

  const { data: agent, isLoading, error } = useQuery<EnrichedAgent>({
    queryKey: [`/api/agents/${agentId}`],
    enabled: !isNaN(agentId),
    retry: 1,
    staleTime: 0, // Always fetch fresh data
    refetchInterval: 10000, // Refetch every 10 seconds to keep giveaway status updated
    queryFn: async () => {
      if (isNaN(agentId)) throw new Error("Invalid agent ID");

      console.log("AgentDetailsPage: Fetching data for agent:", agentId);
      const response = await apiRequest("GET", `/api/agents/${agentId}`);
      console.log("AgentDetailsPage: Received response:", response.status);

      const data = await response.json();
      console.log("AgentDetailsPage: Parsed data:", data);

      return data;
    },
  });

  console.log("AgentDetailsPage: Current state:", { isLoading, error, agent });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-destructive">
        {error instanceof Error ? error.message : "Failed to load agent"}
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center">Agent not found</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-6">
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

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Agent settings and details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Platform</h3>
              <p className="text-sm text-muted-foreground">
                {agent.platform} - Channel: {agent.platformConfig.channelId}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Persona</h3>
              <p className="text-sm text-muted-foreground">
                {agent.persona.description}
                <br />
                Tone: {agent.persona.tone}
              </p>
            </div>
          </CardContent>
        </Card>

        {agent.template === "poll" && (
          <PollDetails polls={agent.polls || []} />
        )}

        {agent.template === "giveaway" && (
          <GiveawayDetails giveaways={agent.giveaways || []} />
        )}

        {agent.template === "qa" && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Q&A History</CardTitle>
              <CardDescription>
                View all questions and responses
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Q&A history feature coming soon
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}