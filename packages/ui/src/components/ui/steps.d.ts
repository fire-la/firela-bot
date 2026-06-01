import type { ComponentType, ReactNode } from 'react';

export interface StepsProps {
  current?: number;
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface StepProps {
  stepIndex?: number;
  isLast?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Steps: ComponentType<StepsProps> & {
  Step: ComponentType<StepProps>;
};

export const Step: ComponentType<StepProps>;
