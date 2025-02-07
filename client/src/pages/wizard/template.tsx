import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { TemplateCard } from "@/components/wizard/TemplateCard";
import { MessageSquare, Award, BarChart3, LineChart } from "lucide-react";
import { useWizard } from "@/hooks/use-wizard";

const templates = [
  {
    id: "qa",
    title: "Q&A Bot",
    description: "Create an interactive Q&A session with your audience",
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    id: "giveaway",
    title: "Giveaway",
    description: "Run engaging giveaways and select winners automatically",
    icon: <Award className="h-5 w-5" />,
  },
  {
    id: "poll",
    title: "Poll Bot",
    description: "Create polls and gather feedback from your community",
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    id: "graph_notify",
    title: "DeFi Analytics",
    description: "Get real-time DeFi analytics and insights from The Graph",
    icon: <LineChart className="h-5 w-5" />,
  },
] as const;

type TemplateId = (typeof templates)[number]["id"];

export default function TemplateStep() {
  const { formData, setFormData } = useWizard();
  const [selected, setSelected] = useState<TemplateId | "">(
    formData.template as TemplateId || ""
  );
  const [, navigate] = useLocation();

  const handleContinue = () => {
    if (selected) {
      setFormData({ ...formData, template: selected });
      // Always go to persona first
      navigate("/wizard/persona");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose a Template</h2>
        <p className="text-muted-foreground">
          Select a template to get started with your social media bot
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            title={template.title}
            description={template.description}
            icon={template.icon}
            selected={selected === template.id}
            onClick={() => setSelected(template.id)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleContinue} disabled={!selected}>
          Continue
        </Button>
      </div>
    </div>
  );
}