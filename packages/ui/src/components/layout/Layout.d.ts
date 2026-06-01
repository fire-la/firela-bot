import type { ComponentType, ReactNode } from 'react';

export interface StackProps {
  children?: ReactNode;
  gap?: number;
  className?: string;
  [key: string]: unknown;
}

export interface GridProps {
  children?: ReactNode;
  cols?: number;
  gap?: number;
  className?: string;
  [key: string]: unknown;
}

export interface FlexProps {
  children?: ReactNode;
  justify?: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly';
  align?: 'start' | 'end' | 'center' | 'baseline' | 'stretch';
  gap?: number;
  wrap?: boolean;
  className?: string;
  [key: string]: unknown;
}

export const Stack: ComponentType<StackProps>;
export const Grid: ComponentType<GridProps>;
export const Flex: ComponentType<FlexProps>;
