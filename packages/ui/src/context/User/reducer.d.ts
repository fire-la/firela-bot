export interface UserReducerState {
  user?: {
    username: string;
    [key: string]: unknown;
  };
}

export type UserReducerAction =
  | { type: 'login'; payload: UserReducerState['user'] }
  | { type: 'logout' };

export const initialState: UserReducerState;
export function reducer(state: UserReducerState, action: UserReducerAction): UserReducerState;
