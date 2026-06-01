import type { ComponentType } from 'react';

export interface CheckboxProps {
  className?: string;
  indeterminate?: boolean;
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (value: boolean | 'indeterminate') => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  [key: string]: unknown;
}

export const Checkbox: ComponentType<CheckboxProps>;
