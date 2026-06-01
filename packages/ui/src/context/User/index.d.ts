import type { ComponentType, ReactNode } from 'react';

export interface UserState {
  user?: {
    username: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type UserAction =
  | { type: 'login'; payload: UserState['user'] }
  | { type: 'logout' };

export const UserContext: React.Context<[UserState, React.Dispatch<UserAction>]>;

export interface UserProviderProps {
  children: ReactNode;
  [key: string]: unknown;
}

export const UserProvider: ComponentType<UserProviderProps>;
