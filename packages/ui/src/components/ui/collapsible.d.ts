import type { ComponentType, ReactNode } from 'react';

export interface CollapsibleProps { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string; }
export interface CollapsibleTriggerProps { children?: ReactNode; asChild?: boolean; className?: string; }
export interface CollapsibleContentProps { className?: string; children?: ReactNode; }

export const Collapsible: ComponentType<CollapsibleProps>;
export const CollapsibleTrigger: ComponentType<CollapsibleTriggerProps>;
export const CollapsibleContent: ComponentType<CollapsibleContentProps>;
