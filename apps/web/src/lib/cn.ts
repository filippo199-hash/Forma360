import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names. Accepts the same argument shape as clsx and
 * resolves Tailwind conflicts via tailwind-merge so callers can override
 * classes without worrying about specificity.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
