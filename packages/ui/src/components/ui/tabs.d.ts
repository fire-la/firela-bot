import type { ComponentType, ReactNode } from 'react';

type TabsVariant = 'default' | 'line';
type TabsOrientation = 'horizontal' | 'vertical';

export interface TabsProps {
  className?: string;
  orientation?: TabsOrientation;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TabsListProps {
  className?: string;
  variant?: TabsVariant;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TabsTriggerProps {
  className?: string;
  value: string;
  children?: ReactNode;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface TabsContentProps {
  className?: string;
  value: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Tabs: ComponentType<TabsProps>;
export const TabsList: ComponentType<TabsListProps>;
export const TabsTrigger: ComponentType<TabsTriggerProps>;
export const TabsContent: ComponentType<TabsContentProps>;
