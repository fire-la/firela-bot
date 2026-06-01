import type { ComponentType } from 'react';

export interface ActionButtonsProps {
  theme: string;
  onThemeToggle: (theme: string) => void;
  navigate: (path: string) => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function ActionButtons(props: ActionButtonsProps): JSX.Element;
