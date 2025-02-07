import { create } from 'zustand';

interface WizardState {
  formData: {
    template?: string;
    name?: string;
    persona?: {
      description: string;
      tone: string;
    };
    platform?: string;
    platformConfig?: {
      token: string;
      channelId: string;
    };
    graphConfig?: {
      queryType: string;
      schedule: string;
    };
  };
  setFormData: (data: any) => void;
  clearForm: () => void;
}

export const useWizard = create<WizardState>((set) => ({
  formData: {},
  setFormData: (data) => set((state) => ({ 
    formData: { ...state.formData, ...data } 
  })),
  clearForm: () => set({ formData: {} }),
}));