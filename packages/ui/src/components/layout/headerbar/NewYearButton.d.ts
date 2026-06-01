import type { ComponentType } from 'react';

export interface NewYearButtonProps {
  isNewYear: boolean;
  [key: string]: unknown;
}

export default function NewYearButton(props: NewYearButtonProps): JSX.Element;
