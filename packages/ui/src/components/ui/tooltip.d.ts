import type { ComponentType, ReactNode } from 'react';

export interface TooltipProps { children?: ReactNode; }
export interface TooltipTriggerProps { children?: ReactNode; asChild?: boolean; className?: string; }
export interface TooltipContentProps { className?: string; children?: ReactNode; sideOffset?: number; align?: 'start' | 'center' | 'end'; }
export interface TooltipProviderProps { children?: ReactNode; delayDuration?: number; }
export interface SimpleTooltipProps { content: ReactNode; children: ReactNode; position?: 'top' | 'bottom' | 'left' | 'right'; className?: string; }

export const Tooltip: ComponentType<TooltipProps>;
export const TooltipTrigger: ComponentType<TooltipTriggerProps>;
export const TooltipContent: ComponentType<TooltipContentProps>;
export const TooltipProvider: ComponentType<TooltipProviderProps>;
export const SimpleTooltip: ComponentType<SimpleTooltipProps>;
