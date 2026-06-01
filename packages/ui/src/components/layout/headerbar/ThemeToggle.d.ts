import type { ComponentType } from 'react';

export interface ThemeToggleProps {
  theme: string;
  onThemeToggle: (theme: string) => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function ThemeToggle(props: ThemeToggleProps): JSX.Element;
