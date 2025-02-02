import { Link, useLocation } from "wouter";

const steps = [
  { path: "/", label: "Template" },
  { path: "/persona", label: "Persona" },
  { path: "/platform", label: "Platform" },
  { path: "/review", label: "Review" },
];

export function WizardNav() {
  const [location] = useLocation();
  // Convert the current location to a relative path
  const relativePath = location.replace("/wizard", "") || "/";

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