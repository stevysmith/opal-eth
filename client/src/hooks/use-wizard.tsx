import { createContext, useContext, ReactNode, useState } from "react";
import type { InsertAgent } from "@db/schema";

type WizardData = Omit<InsertAgent, 'userId' | 'id' | 'createdAt'> & {
  persona: {
    description: string;
    tone: string;
  };
  platformConfig: {
    token: string;
    channelId: string;
  };
};

type WizardContextType = {
  formData: Partial<WizardData>;
  setFormData: (data: Partial<WizardData>) => void;
  clearForm: () => void;
};

const WizardContext = createContext<WizardContextType | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [formData, setFormDataState] = useState<Partial<WizardData>>({});

  const setFormData = (newData: Partial<WizardData>) => {
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