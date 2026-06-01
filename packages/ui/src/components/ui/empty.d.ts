import type { ComponentType, ReactNode } from 'react';

export interface EmptyProps {
  image?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Empty: ComponentType<EmptyProps>;
export const EmptyState: ComponentType<EmptyProps>;
