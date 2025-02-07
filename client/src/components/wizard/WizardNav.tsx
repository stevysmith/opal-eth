import { Link, useLocation } from "wouter";
import { useWizard } from "@/hooks/use-wizard";

export function WizardNav() {
  const [location] = useLocation();
  const { formData } = useWizard();
  const relativePath = location.replace("/wizard", "") || "/";

  // Define all possible steps
  const steps = [
    { path: "/", label: "Template" },
    { path: "/persona", label: "Persona" },
    { 
      path: "/graph-config", 
      label: "Analytics", 
      showIf: () => formData && typeof formData.template === "string" && formData.template === "graph_notify"
    },
    { path: "/platform", label: "Platform" },
    { path: "/review", label: "Review" },
  ];

  // Filter steps based on conditions
  const visibleSteps = steps.filter(step => !step.showIf || step.showIf());

  return (
    <nav className="flex gap-2">
      {visibleSteps.map((step, i) => {
        const isActive = relativePath === step.path;
        const isPast = visibleSteps.findIndex(s => s.path === relativePath) > i;

        return (
          <Link key={step.path} href={`/wizard${step.path}`}>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${isActive ? "bg-primary text-primary-foreground" : 
                  isPast ? "bg-muted" : "hover:bg-muted"}`}
            >
              {step.label}
            </button>
          </Link>
        );
      })}
    </nav>
  );
}