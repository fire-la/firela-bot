import type { ComponentType, ReactNode } from 'react';

export interface ContentAreaProps {
  children?: ReactNode;
  className?: string;
  variant?: 'wide' | 'narrow';
  [key: string]: unknown;
}

export interface ContentHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface ContentGridProps {
  children?: ReactNode;
  className?: string;
  columns?: number;
  [key: string]: unknown;
}

export const ContentArea: ComponentType<ContentAreaProps>;
export const ContentHeader: ComponentType<ContentHeaderProps>;
export const ContentGrid: ComponentType<ContentGridProps>;
