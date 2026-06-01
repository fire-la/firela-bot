import type { ComponentType } from 'react';

export interface ToasterProps {
  [key: string]: unknown;
}

export const Toaster: ComponentType<ToasterProps>;
export const toast: {
  (message: string, options?: Record<string, unknown>): void;
  success: (message: string, options?: Record<string, unknown>) => void;
  error: (message: string, options?: Record<string, unknown>) => void;
  info: (message: string, options?: Record<string, unknown>) => void;
  warning: (message: string, options?: Record<string, unknown>) => void;
  promise: <T>(promise: Promise<T>, options: Record<string, unknown>) => void;
  dismiss: (id?: string | number) => void;
};
