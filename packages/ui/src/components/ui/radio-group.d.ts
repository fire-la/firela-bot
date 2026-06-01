import type { ComponentType, ReactNode } from 'react';

export interface RadioGroupProps {
  className?: string;
  children?: ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  [key: string]: unknown;
}

export interface RadioGroupItemProps {
  className?: string;
  value: string;
  disabled?: boolean;
  id?: string;
  [key: string]: unknown;
}

export const RadioGroup: ComponentType<RadioGroupProps>;
export const RadioGroupItem: ComponentType<RadioGroupItemProps>;
