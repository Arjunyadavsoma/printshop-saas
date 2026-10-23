/**
 * Print engine router — selects which engine to use based on the
 * shopkeeper's saved preference + current availability.
 *
 * Rules:
 * - 'native' (default): use native engine. If unavailable, show error.
 * - 'printlatch': use PrintLatch. If unavailable, show error.
 * - 'auto': try the preferred engine first. If unavailable before
 *   submission, offer the other. Never auto-resubmit after submission.
 */

import type { PrintEngine, PrintEngineId, PrintJobSettings, PrintJobResult } from './types';
import { NativePrintEngine, getNativePrefs, saveNativePrefs } from './native-engine';
import { PrintLatchEngine } from './printlatch-engine';

const nativeEngine = new NativePrintEngine();
const printlatchEngine = new PrintLatchEngine();

export function getEnginePreference(): PrintEngineId {
  return getNativePrefs().engine ?? 'native';
}

export function setEnginePreference(engine: PrintEngineId) {
  const prefs = getNativePrefs();
  saveNativePrefs({ ...prefs, engine });
}

export function getEngine(id: PrintEngineId): PrintEngine {
  if (id === 'native') return nativeEngine;
  if (id === 'printlatch') return printlatchEngine;
  // 'auto' → resolve to the preferred engine
  return getEngine(getEnginePreference() === 'auto' ? 'native' : getEnginePreference());
}

/**
 * Check the availability of the preferred engine + report fallback options.
 */
export async function checkEngineAvailability(): Promise<{
  preferred: PrintEngineId;
  preferredAvailable: boolean;
  preferredError?: string;
  nativeAvailable: boolean;
  printlatchAvailable: boolean;
}> {
  const pref = getEnginePreference();
  const [nativeResult, printlatchResult] = await Promise.allSettled([
    nativeEngine.checkAvailability(),
    printlatchEngine.checkAvailability(),
  ]);
  const nativeAvailable = nativeResult.status === 'fulfilled' && nativeResult.value.available;
  const printlatchAvailable = printlatchResult.status === 'fulfilled' && printlatchResult.value.available;

  const preferredEngine = pref === 'auto' ? 'native' : pref;
  const preferredEngine_ = preferredEngine === 'native' ? nativeEngine : printlatchEngine;
  const preferredResult = preferredEngine === 'native' ? nativeResult : printlatchResult;

  return {
    preferred: preferredEngine,
    preferredAvailable: preferredResult.status === 'fulfilled' && preferredResult.value.available,
    preferredError: preferredResult.status === 'fulfilled' ? preferredResult.value.error : undefined,
    nativeAvailable,
    printlatchAvailable,
  };
}

/**
 * Get the available engine to use, respecting the shopkeeper's preference.
 * Does NOT auto-switch after a job has been submitted.
 */
export async function getActiveEngine(): Promise<{ engine: PrintEngine; error?: string }> {
  const pref = getEnginePreference();
  const resolvedId = pref === 'auto' ? 'native' : pref;
  const engine = getEngine(resolvedId);
  const { available, error } = await engine.checkAvailability();
  if (!available) {
    // Try fallback for 'auto' mode
    if (pref === 'auto') {
      const fallbackId = resolvedId === 'native' ? 'printlatch' : 'native';
      const fallback = getEngine(fallbackId);
      const fb = await fallback.checkAvailability();
      if (fb.available) return { engine: fallback };
    }
    return { engine, error: error ?? 'Engine not available' };
  }
  return { engine };
}
