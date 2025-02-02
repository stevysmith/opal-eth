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
          <Route path="/" component={TemplateStep} />
          <Route path="/persona" component={PersonaStep} />
          <Route path="/platform" component={PlatformStep} />
          <Route path="/review" component={ReviewStep} />
        </Switch>
      </WizardLayout>
    </WizardProvider>
  );
}