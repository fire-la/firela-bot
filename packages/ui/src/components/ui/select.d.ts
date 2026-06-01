import type { ComponentType, ReactNode } from 'react';

export interface SelectProps { children?: ReactNode; value?: string; onValueChange?: (value: string) => void; defaultValue?: string; disabled?: boolean; }
export interface SelectTriggerProps { className?: string; children?: ReactNode; }
export interface SelectContentProps { className?: string; children?: ReactNode; position?: 'popper' | 'item-aligned'; }
export interface SelectItemProps { value: string; className?: string; children?: ReactNode; disabled?: boolean; }
export interface SelectLabelProps { className?: string; children?: ReactNode; }
export interface SelectValueProps { placeholder?: string | number; className?: string; }
export interface SelectGroupProps { children?: ReactNode; }
export interface SelectSeparatorProps { className?: string; }

export const Select: ComponentType<SelectProps>;
export const SelectTrigger: ComponentType<SelectTriggerProps>;
export const SelectContent: ComponentType<SelectContentProps>;
export const SelectItem: ComponentType<SelectItemProps>;
export const SelectLabel: ComponentType<SelectLabelProps>;
export const SelectValue: ComponentType<SelectValueProps>;
export const SelectGroup: ComponentType<SelectGroupProps>;
export const SelectSeparator: ComponentType<SelectSeparatorProps>;
export const SelectScrollDownButton: ComponentType<{ className?: string; }>;
export const SelectScrollUpButton: ComponentType<{ className?: string; }>;
