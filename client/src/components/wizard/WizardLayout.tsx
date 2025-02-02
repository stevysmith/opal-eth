import { Link } from "wouter";
import { WizardNav } from "./WizardNav";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function WizardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="font-semibold">Create New Agent</h1>
          <Link href="/">
            <Button variant="ghost" size="icon">
              <X className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <WizardNav />
        <main className="mt-8">
          {children}
        </main>
      </div>
    </div>
  );
}