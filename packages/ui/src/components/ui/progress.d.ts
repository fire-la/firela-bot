import type { ComponentType } from 'react';

export interface ProgressProps {
  className?: string;
  value?: number;
}

export const Progress: ComponentType<ProgressProps>;
