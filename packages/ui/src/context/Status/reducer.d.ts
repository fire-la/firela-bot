export interface StatusReducerState {
  status?: {
    [key: string]: unknown;
  };
}

export type StatusReducerAction =
  | { type: 'set'; payload: StatusReducerState['status'] }
  | { type: 'unset' };

export const initialState: StatusReducerState;
export function reducer(state: StatusReducerState, action: StatusReducerAction): StatusReducerState;
