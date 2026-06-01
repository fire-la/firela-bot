import type { ComponentType } from 'react';

export interface UserAreaProps {
  userState: {
    user?: {
      username: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  isLoading: boolean;
  isMobile: boolean;
  isSelfUseMode: boolean;
  logout: () => void;
  navigate: (path: string) => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function UserArea(props: UserAreaProps): JSX.Element;
