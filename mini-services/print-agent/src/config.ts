import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { join, dirname } from 'node:path';

export interface AgentConfig {
  shopSlug: string;
  /** Base URL of the PrintShop API (the gateway in production). */
  apiUrl: string;
  /** Base URL of the realtime mini-service (for socket.io push). */
  realtimeUrl: string;
  deviceToken: string;
  agentId: string;
  name: string;
  version: string;
}

const DEFAULT_VERSION = '0.1.0';
const CONFIG_PATH = process.env.PRINT_AGENT_CONFIG ?? join(homedir(), '.print-agent', 'config.json');
const QUEUE_PATH = process.env.PRINT_AGENT_QUEUE ?? join(homedir(), '.print-agent', 'queue.json');

export function defaultName(): string {
  return `${platform()}-${hostname().split('.')[0]}`;
}

export function loadConfig(): AgentConfig | null {
  // File first.
  if (existsSync(CONFIG_PATH)) {
    try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as AgentConfig; } catch { /* fall through */ }
  }
  // Fall back to env vars (lets the demo run `start` without `setup`).
  const token = process.env.PRINT_AGENT_DEVICE_TOKEN;
  const apiUrl = process.env.PRINT_AGENT_API_URL;
  if (token && apiUrl) {
    return {
      shopSlug: process.env.PRINT_AGENT_SHOP_SLUG ?? 'quickprint',
      apiUrl,
      realtimeUrl: process.env.PRINT_AGENT_REALTIME_URL ?? 'http://127.0.0.1:3003',
      deviceToken: token,
      agentId: process.env.PRINT_AGENT_AGENT_ID ?? 'env',
      name: process.env.PRINT_AGENT_NAME ?? defaultName(),
      version: DEFAULT_VERSION,
    };
  }
  return null;
}

export function saveConfig(c: AgentConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  console.log(`✓ config saved → ${CONFIG_PATH}`);
}

export function loadDiskQueue(): { jobId: string; fileId: string; downloadUrl: string; settings: Record<string, unknown> }[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

export function saveDiskQueue(jobs: { jobId: string; fileId: string; downloadUrl: string; settings: Record<string, unknown> }[]): void {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, JSON.stringify(jobs, null, 2));
}

export const VERSION = DEFAULT_VERSION;
export const CONFIG_PATH_RESOLVED = CONFIG_PATH;
