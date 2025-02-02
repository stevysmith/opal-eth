import { Route, Switch } from "wouter";
import { WizardLayout } from "@/components/wizard/WizardLayout";
import TemplateStep from "./template";
import PersonaStep from "./persona";
import PlatformStep from "./platform";
import ReviewStep from "./review";

export default function WizardPage() {
  return (
    <WizardLayout>
      <Switch>
        <Route path="/wizard" component={TemplateStep} />
        <Route path="/wizard/persona" component={PersonaStep} />
        <Route path="/wizard/platform" component={PlatformStep} />
        <Route path="/wizard/review" component={ReviewStep} />
      </Switch>
    </WizardLayout>
  );
}
