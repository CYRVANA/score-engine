import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines clsx (conditional class lists) with tailwind-merge (last-wins for
 * conflicting Tailwind utility classes). Idiomatic in shadcn/ui codebases.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
