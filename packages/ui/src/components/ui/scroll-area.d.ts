import type { ComponentType, ReactNode } from 'react';

export interface ScrollAreaProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ScrollBarProps {
  className?: string;
  orientation?: 'vertical' | 'horizontal';
  [key: string]: unknown;
}

export const ScrollArea: ComponentType<ScrollAreaProps>;
export const ScrollBar: ComponentType<ScrollBarProps>;
