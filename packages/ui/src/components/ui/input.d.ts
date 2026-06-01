import type { ComponentType, RefAttributes, InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  [key: string]: unknown;
}

export const Input: ComponentType<InputProps>;
