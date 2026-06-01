import type { ComponentType, ReactNode } from 'react';

export interface StatusState {
  status?: {
    setup?: boolean;
    self_use_mode_enabled?: boolean;
    demo_site_enabled?: boolean;
    docs_link?: string;
    announcements?: Array<{
      content: string;
      publishDate: string;
      type?: string;
      extra?: string;
      [key: string]: unknown;
    }>;
    HeaderNavModules?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type StatusAction =
  | { type: 'set'; payload: StatusState['status'] }
  | { type: 'unset' };

export const StatusContext: React.Context<[StatusState, React.Dispatch<StatusAction>]>;

export interface StatusProviderProps {
  children: ReactNode;
  [key: string]: unknown;
}

export const StatusProvider: ComponentType<StatusProviderProps>;
