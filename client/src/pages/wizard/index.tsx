import { Route, Switch } from "wouter";
import { WizardLayout } from "@/components/wizard/WizardLayout";
import { WizardProvider } from "@/hooks/use-wizard";
import TemplateStep from "./template.tsx";
import PersonaStep from "./persona.tsx";
import PlatformStep from "./platform.tsx";
import ReviewStep from "./review.tsx";

export default function WizardPage() {
  return (
    <WizardProvider>
      <WizardLayout>
        <Switch>
          <Route path="/wizard" component={TemplateStep} />
          <Route path="/wizard/persona" component={PersonaStep} />
          <Route path="/wizard/platform" component={PlatformStep} />
          <Route path="/wizard/review" component={ReviewStep} />
        </Switch>
      </WizardLayout>
    </WizardProvider>
  );
}