import type { ComponentType, ReactNode, RefObject } from 'react';

export interface ComboboxProps {
  children?: ReactNode;
  value?: unknown;
  onValueChange?: (value: unknown) => void;
  [key: string]: unknown;
}

export interface ComboboxValueProps {
  className?: string;
  [key: string]: unknown;
}

export interface ComboboxTriggerProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxClearProps {
  className?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface ComboboxInputProps {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  showTrigger?: boolean;
  showClear?: boolean;
  [key: string]: unknown;
}

export interface ComboboxContentProps {
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
  alignOffset?: number;
  anchor?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxListProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxItemProps {
  className?: string;
  children?: ReactNode;
  value?: unknown;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface ComboboxGroupProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxLabelProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxCollectionProps {
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxEmptyProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxSeparatorProps {
  className?: string;
  [key: string]: unknown;
}

export interface ComboboxChipsProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface ComboboxChipProps {
  className?: string;
  children?: ReactNode;
  showRemove?: boolean;
  [key: string]: unknown;
}

export interface ComboboxChipsInputProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Combobox: ComponentType<ComboboxProps>;
export const ComboboxValue: ComponentType<ComboboxValueProps>;
export const ComboboxTrigger: ComponentType<ComboboxTriggerProps>;
export const ComboboxClear: ComponentType<ComboboxClearProps>;
export const ComboboxInput: ComponentType<ComboboxInputProps>;
export const ComboboxContent: ComponentType<ComboboxContentProps>;
export const ComboboxList: ComponentType<ComboboxListProps>;
export const ComboboxItem: ComponentType<ComboboxItemProps>;
export const ComboboxGroup: ComponentType<ComboboxGroupProps>;
export const ComboboxLabel: ComponentType<ComboboxLabelProps>;
export const ComboboxCollection: ComponentType<ComboboxCollectionProps>;
export const ComboboxEmpty: ComponentType<ComboboxEmptyProps>;
export const ComboboxSeparator: ComponentType<ComboboxSeparatorProps>;
export const ComboboxChips: ComponentType<ComboboxChipsProps>;
export const ComboboxChip: ComponentType<ComboboxChipProps>;
export const ComboboxChipsInput: ComponentType<ComboboxChipsInputProps>;

export function useComboboxAnchor(): RefObject<HTMLElement | null>;
