import type { AxiosInstance } from 'axios';

export const API: AxiosInstance;
export function showSuccess(message: string): void;
export function showError(error: unknown): void;
export function getSystemName(): string;
export function getLogo(): string;
export function getRelativeTime(dateString: string): string;
export function stringToColor(str: string): string;
