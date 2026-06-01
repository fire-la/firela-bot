import type { ComponentType, ReactNode } from 'react';

export interface DropdownMenuProps { children?: ReactNode; [key: string]: unknown }
export interface DropdownMenuTriggerProps { children?: ReactNode; asChild?: boolean; className?: string; [key: string]: unknown }
export interface DropdownMenuContentProps { className?: string; children?: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; sideOffset?: number; [key: string]: unknown }
export interface DropdownMenuItemProps { className?: string; children?: ReactNode; onClick?: () => void; [key: string]: unknown }
export interface DropdownMenuSeparatorProps { className?: string; [key: string]: unknown }
export interface DropdownMenuLabelProps { className?: string; children?: ReactNode; [key: string]: unknown }
export interface DropdownMenuGroupProps { children?: ReactNode; [key: string]: unknown }

export const DropdownMenu: ComponentType<DropdownMenuProps>;
export const DropdownMenuTrigger: ComponentType<DropdownMenuTriggerProps>;
export const DropdownMenuContent: ComponentType<DropdownMenuContentProps>;
export const DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
export const DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
export const DropdownMenuLabel: ComponentType<DropdownMenuLabelProps>;
export const DropdownMenuGroup: ComponentType<DropdownMenuGroupProps>;
export const DropdownMenuGroup: ComponentType<DropdownMenuGroupProps>;
