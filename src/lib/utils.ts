import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Truncate a string to `n` chars, appending an ellipsis.
 * Default length is 8 chars — the existing admin pages used 8 (with one
 * outlier at 10). Consolidated here so every caller agrees.
 */
export function truncate(input: string, n = 8): string {
  const s = String(input ?? "");
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/**
 * Format a paise integer (1 INR = 100 paise) as a human-readable INR string.
 * Delegates to the canonical implementation in @platform/utils to avoid drift.
 */
export { formatINRFromPaise } from "@platform/utils";

/**
 * Format an ISO date string or Date as a short date-time (e.g. "07 Nov, 2:30 PM").
 * Uses the user's locale (Asia/Kolkata for PrintShop's Indian market).
 */
export function formatDateTime(input: string | Date | number | null | undefined): string {
  if (input === null || input === undefined) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Format an ISO date string or Date as a short date only (e.g. "07 Nov 2025").
 */
export function formatDate(input: string | Date | number | null | undefined): string {
  if (input === null || input === undefined) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Relative time-ago formatter (e.g. "just now", "5 min ago", "3 hours ago").
 * Returns "—" for null/undefined.
 */
export function timeAgo(input: string | Date | number | null | undefined): string {
  if (input === null || input === undefined) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(d);
}

/**
 * Format a byte count as a human-readable file size.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Returns true if the given date is today (in Asia/Kolkata).
 */
export function isToday(input: string | Date | number | null | undefined): boolean {
  if (input === null || input === undefined) return false;
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
    === now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

/**
 * Initials from a name (e.g. "Arjun Print Hub" → "AP").
 */
export function initials(name: string | null | undefined): string {
  const s = String(name ?? "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
