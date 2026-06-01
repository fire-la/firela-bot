import type { ComponentType } from 'react';

export interface SliderProps {
  className?: string;
  defaultValue?: number[];
  value?: number[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  [key: string]: unknown;
}

export const Slider: ComponentType<SliderProps>;
