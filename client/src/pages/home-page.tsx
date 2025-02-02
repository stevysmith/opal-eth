import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import type { SelectAgent } from "@db/schema";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const { data: agents } = useQuery<SelectAgent[]>({ queryKey: ["/api/agents"] });

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
            <div key={agent.id} className="p-6 rounded-lg border bg-card">
              <h3 className="font-semibold">{agent.name}</h3>
              <p className="text-sm text-muted-foreground">
                {agent.template} • {agent.platform}
              </p>
            </div>
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
