/**
 * Dispatcher gate — the filter that decides which queued tasks the
 * PC-style PrintEXE companion (the legacy `/agents/jobs/pending` endpoint)
 * is allowed to see.
 *
 * Rules:
 *   1. executorMode MUST be 'AUTO' (manual-only tasks are never auto-dispatched).
 *   2. isHeld MUST be false (the shopkeeper explicitly parked the task).
 *   3. claimedByAgentId MUST be null (already claimed by a mobile agent or PC).
 *   4. The task's target printer MUST have at least one WINDOWS_QUEUE path
 *      from an ONLINE, ENABLED PC agent. A mobile-only printer (LAN_IPP /
 *      RAW9100 paths only) is invisible to the PC dispatcher.
 *
 * Rules 1–3 keep tasks the shopkeeper parked, claimed, or marked
 * manual-only OUT of the PC's auto-poll. Rule 4 keeps mobile-only
 * printers out of the PC's view — those are the mobile app's
 * responsibility, and the PC has no Windows spooler for them.
 *
 * Crucially, this filter is purely additive — old PrintEXE builds that
 * don't know about executorMode/isHeld/claimedByAgentId see NO change in
 * the response shape. The server just returns fewer jobs (the ones the
 * shopkeeper explicitly parked or claimed by a phone are silently
 * excluded — same as if they had been completed). The legacy agent never
 * observes that filtering happened.
 */

import { getContainer } from '@/lib/container';
import { getQueue } from '@/lib/queue/queue-service';

/** The task shape the pending endpoint already queries. */
export type PendingTaskRow = any;

/** A printer with at least one WINDOWS_QUEUE path from an online PC agent. */
interface PcPrinter {
  id: string;
  shopId: string;
  enabled: boolean;
}

/** A PrinterPath row (only the fields the gate reads). */
interface PrinterPathRow {
  id: string;
  printerId: string;
  agentId: string;
  kind: string;
  status: string;
}

/** An agent row (only the fields the gate reads). */
interface AgentRow {
  id: string;
  shopId: string;
  kind: string;
  isEnabled: boolean;
  isOnline: boolean;
  lastSeenAt: Date | null;
}

/**
 * Resolve the set of printer ids in a shop that have a WINDOWS_QUEUE path
 * from an ONLINE, ENABLED PC agent.
 *
 * **Backward-compat fallback**: when the shop has NO PrinterPath rows at all
 * (it has never been synced via the v2 `POST /shop/printers/sync` endpoint),
 * the gate cannot apply rule 4 — there is no path data. In that case this
 * function returns `null` (a sentinel distinct from an empty Set) so the
 * caller can fall back to legacy behaviour: every queued task is dispatchable
 * (the pre-v2 behaviour, which is what old PrintEXE builds expect). Once the
 * shop's first PrinterPath row is created (by a v2 agent sync), the gate
 * applies strictly.
 *
 * Cached in-memory per request (the pending endpoint already does this
 * once per call). For longer-lived caching the route could call this and
 * stash the result for ~5s in the cache adapter — left as a follow-up to
 * avoid premature caching of presence data.
 *
 * @returns `null` when the shop has no PrinterPath rows (legacy fallback);
 *          a Set<string> (possibly empty) when v2 path data exists.
 */
export async function resolvePcDispatchablePrinters(shopId: string): Promise<Set<string> | null> {
  const db = getContainer().db;

  // Pull every PrinterPath attached to the shop's printers. We don't filter
  // by shopId directly (PrinterPath has no shopId column) — instead we look
  // up the shop's printers first and then match paths to them.
  const printers = await db.findMany<PcPrinter>('printer', { shopId }, { limit: 200 });
  const shopPrinterIds = new Set(printers.map((p) => p.id));

  // Pull every PrinterPath in the store. The PrinterPath table is small
  // (one row per printer × agent × kind); for multi-shop deployments this
  // would normally be tenant-scoped via a join, but the in-memory adapter
  // doesn't support joins and the Prisma adapter's `findMany` on
  // `printerPath` returns everything. We filter in-process below.
  const paths = await db.findMany<PrinterPathRow>('printerPath', {}, { limit: 1000 });

  // Legacy fallback: if NO PrinterPath rows exist for this shop's printers,
  // the shop has never been synced via v2. Return null so the caller falls
  // back to the pre-v2 behaviour (every queued task is dispatchable).
  const shopPathCount = paths.filter((p) => shopPrinterIds.has(p.printerId)).length;
  if (shopPathCount === 0) {
    return null;
  }

  const enabledPrinterIds = new Set(printers.filter((p) => p.enabled).map((p) => p.id));
  if (enabledPrinterIds.size === 0) return new Set();

  const pcQueuePaths = paths.filter(
    (p) => enabledPrinterIds.has(p.printerId) && p.kind === 'WINDOWS_QUEUE',
  );
  if (pcQueuePaths.length === 0) return new Set();

  // Resolve the agents that own those paths; only ONLINE + ENABLED PC
  // agents count. (An offline PC's printers are momentarily unreachable —
  // the gate drops the path so the dispatcher doesn't queue work that
  // cannot be printed.)
  const agentIds = Array.from(new Set(pcQueuePaths.map((p) => p.agentId)));
  const agents = await db.findMany<AgentRow>('printAgent', {}, { limit: 500 });
  const livePcAgentIds = new Set(
    agents.filter((a) => agentIds.includes(a.id) && a.kind === 'PC' && a.isEnabled && a.isOnline).map((a) => a.id),
  );

  // A printer is dispatchable if at least one of its WINDOWS_QUEUE paths
  // belongs to a live PC agent.
  const result = new Set<string>();
  for (const path of pcQueuePaths) {
    if (livePcAgentIds.has(path.agentId)) {
      result.add(path.printerId);
    }
  }
  return result;
}

/**
 * Apply the dispatcher gate to a list of candidate tasks.
 *
 * Returns ONLY the tasks that pass ALL filter rules:
 *   - executorMode === 'AUTO'
 *   - isHeld === false
 *   - claimedByAgentId === null
 *   - printerId is in `pcDispatchablePrinters`
 *
 * Tasks whose `printerId` is null are auto-dispatchable if the shop has
 * ANY live PC printer (the planner will pick the default when the agent
 * claims it). This matches the legacy behaviour where a null printerId
 * meant "any available printer".
 *
 * **Legacy fallback**: when `pcDispatchablePrinters` is `null` (the shop
 * has no PrinterPath rows — pre-v2), rules 1–3 still apply (held/manual/
 * claimed tasks are excluded) but rule 4 is skipped (no path data to
 * filter on). This keeps old PrintEXE builds working unchanged: they
 * never synced paths, so the gate cannot exclude tasks on path grounds.
 */
export function applyDispatcherGate(
  tasks: PendingTaskRow[],
  pcDispatchablePrinters: Set<string> | null,
): PendingTaskRow[] {
  // Coalesce legacy rows that predate the queue v2 columns to their
  // schema defaults (executorMode='AUTO', isHeld=false, claimedByAgentId=null).
  // Without this, an `undefined` field would fail the `!== 'AUTO'` check
  // and exclude every legacy task — breaking every pre-v2 shop.
  const normalize = (t: PendingTaskRow): PendingTaskRow => ({
    ...t,
    executorMode: t.executorMode ?? 'AUTO',
    isHeld: t.isHeld ?? false,
    claimedByAgentId: t.claimedByAgentId ?? null,
    priority: t.priority ?? 0,
    position: t.position ?? 'a0',
    version: t.version ?? 1,
  });
  // Legacy fallback: no path data — apply only rules 1–3.
  if (pcDispatchablePrinters === null) {
    return tasks.map(normalize).filter((t) => {
      if (t.executorMode !== 'AUTO') return false;
      if (t.isHeld) return false;
      if (t.claimedByAgentId) return false;
      return true;
    });
  }
  const allowAnyPrinter = pcDispatchablePrinters.size > 0;
  return tasks.map(normalize).filter((t) => {
    if (t.executorMode !== 'AUTO') return false;
    if (t.isHeld) return false;
    if (t.claimedByAgentId) return false;
    if (t.printerId) {
      return pcDispatchablePrinters.has(t.printerId);
    }
    // No explicit printerId — the task is dispatchable to any live PC.
    return allowAnyPrinter;
  });
}

/**
 * Combined helper: fetch the shop's queued tasks and return ONLY the ones
 * the PC dispatcher may see. Mirrors the legacy `findQueuedByShop` shape
 * but applies the v2 gate.
 *
 * Returns tasks ordered by the queue's composite key:
 *   isHeld ASC, priority DESC, position ASC, createdAt ASC
 * (Since all returned tasks have isHeld=false, the effective order is
 *  priority DESC, position ASC, createdAt ASC.)
 */
export async function getDispatchableTasks(shopId: string, limit = 10): Promise<PendingTaskRow[]> {
  const db = getContainer().db;
  const pcPrinters = await resolvePcDispatchablePrinters(shopId);
  // Legacy fallback: pcPrinters === null → return queued tasks filtered
  // only by rules 1–3 (the pre-v2 behaviour).
  if (pcPrinters === null) {
    const rows = await db.findMany<PendingTaskRow>('printJob', { shopId, status: 'queued' }, { limit: limit * 4 });
    const filtered = applyDispatcherGate(rows, null);
    filtered.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.position !== b.position) return a.position < b.position ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return filtered.slice(0, limit);
  }
  if (pcPrinters.size === 0) return [];

  const rows = await db.findMany<PendingTaskRow>('printJob', { shopId, status: 'queued' }, { limit: limit * 4 });
  const filtered = applyDispatcherGate(rows, pcPrinters);
  filtered.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.position !== b.position) return a.position < b.position ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return filtered.slice(0, limit);
}
