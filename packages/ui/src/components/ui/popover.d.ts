import type { ComponentType, ReactNode } from 'react';

export interface PopoverProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  [key: string]: unknown;
}

export interface PopoverTriggerProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
  [key: string]: unknown;
}

export interface PopoverAnchorProps {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface PopoverContentProps {
  className?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Popover: ComponentType<PopoverProps>;
export const PopoverTrigger: ComponentType<PopoverTriggerProps>;
export const PopoverContent: ComponentType<PopoverContentProps>;
export const PopoverAnchor: ComponentType<PopoverAnchorProps>;
