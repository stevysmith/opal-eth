import { Link, useLocation } from "wouter";

const steps = [
  { path: "/wizard", label: "Template" },
  { path: "/wizard/persona", label: "Persona" },
  { path: "/wizard/platform", label: "Platform" },
  { path: "/wizard/review", label: "Review" },
];

export function WizardNav() {
  const [location] = useLocation();

  return (
    <nav className="flex gap-2">
      {steps.map((step, i) => {
        const isActive = location === step.path;
        const isPast = steps.findIndex(s => s.path === location) > i;

        return (
          <Link key={step.path} href={step.path}>
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
