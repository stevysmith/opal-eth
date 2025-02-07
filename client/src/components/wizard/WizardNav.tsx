import { Link, useLocation } from "wouter";
import { useWizard } from "@/hooks/use-wizard";

export function WizardNav() {
  const [location] = useLocation();
  const { formData } = useWizard();
  // Convert the current location to a relative path
  const relativePath = location.replace("/wizard", "") || "/";

  // Define base steps
  let steps = [
    { path: "/", label: "Template" },
    { path: "/persona", label: "Persona" },
  ];

  // Add graph config step if template is graph_notify
  if (formData.template === "graph_notify") {
    steps.push({ path: "/graph-config", label: "Analytics" });
  }

  // Add platform and review steps
  steps = [
    ...steps,
    { path: "/platform", label: "Platform" },
    { path: "/review", label: "Review" },
  ];

  return (
    <nav className="flex gap-2">
      {steps.map((step, i) => {
        const isActive = relativePath === step.path;
        const isPast = steps.findIndex(s => s.path === relativePath) > i;

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