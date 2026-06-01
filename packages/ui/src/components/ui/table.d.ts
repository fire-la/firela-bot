import type { ComponentType, ReactNode, HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableFooterProps extends HTMLAttributes<HTMLTableSectionElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TableCaptionProps extends HTMLAttributes<HTMLTableCaptionElement> {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Table: ComponentType<TableProps>;
export const TableHeader: ComponentType<TableHeaderProps>;
export const TableBody: ComponentType<TableBodyProps>;
export const TableFooter: ComponentType<TableFooterProps>;
export const TableHead: ComponentType<TableHeadProps>;
export const TableRow: ComponentType<TableRowProps>;
export const TableCell: ComponentType<TableCellProps>;
export const TableCaption: ComponentType<TableCaptionProps>;
