import type { ComponentType, ReactNode } from 'react';

export interface LabelProps {
  className?: string;
  children?: ReactNode;
  htmlFor?: string;
  [key: string]: unknown;
}

export const Label: ComponentType<LabelProps>;
