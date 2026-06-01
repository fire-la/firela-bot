import type { ReactNode } from 'react';

export interface SetupCheckProps {
  children: ReactNode;
  [key: string]: unknown;
}

export default function SetupCheck(props: SetupCheckProps): ReactNode;
