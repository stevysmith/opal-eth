import { Link, useLocation } from "wouter";
import { useWizard } from "@/hooks/use-wizard";
import type { Template } from "@/hooks/use-wizard";

export function WizardNav() {
  const [location] = useLocation();
  const { formData } = useWizard();
  const relativePath = location.replace("/wizard", "") || "/";
  const currentTemplate = formData.template as Template | undefined;

  const steps = [
    { path: "/", label: "Template" },
    { path: "/persona", label: "Persona" },
    { 
      path: "/graph-config", 
      label: "Analytics", 
      showIf: () => currentTemplate === "graph_notify"
    },
    { path: "/platform", label: "Platform" },
    { path: "/review", label: "Review" },
  ];

  const visibleSteps = steps.filter(step => !step.showIf || step.showIf());
  const currentStepIndex = visibleSteps.findIndex(step => step.path === relativePath);

  return (
    <nav className="flex gap-2">
      {visibleSteps.map((step, i) => {
        const isActive = relativePath === step.path;
        const isPast = currentStepIndex > i;

        return (
          <Link key={step.path} href={`/wizard${step.path}`}>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${isActive ? "bg-primary text-primary-foreground" : 
                  isPast ? "bg-muted" : "hover:bg-muted"}`}
              disabled={!isActive && !isPast}
            >
              {step.label}
            </button>
          </Link>
        );
      })}
    </nav>
  );
}