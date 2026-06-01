import type { ComponentType } from 'react';

export interface SeparatorProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
  [key: string]: unknown;
}

export const Separator: ComponentType<SeparatorProps>;
