import { createContext, useContext, ReactNode, useState } from "react";
import type { InsertAgent } from "@db/schema";

type WizardContextType = {
  formData: Partial<InsertAgent>;
  setFormData: (data: Partial<InsertAgent>) => void;
  clearForm: () => void;
};

const WizardContext = createContext<WizardContextType | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [formData, setFormDataState] = useState<Partial<InsertAgent>>({});

  const setFormData = (newData: Partial<InsertAgent>) => {
    setFormDataState(prev => ({ ...prev, ...newData }));
  };

  const clearForm = () => {
    setFormDataState({});
  };

  return (
    <WizardContext.Provider value={{ formData, setFormData, clearForm }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return context;
}
