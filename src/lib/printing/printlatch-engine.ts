/**
 * PrintLatch engine adapter — wraps the existing PrintLatch client
 * to implement the unified PrintEngine interface.
 *
 * Does NOT modify the existing PrintLatch client. Just adapts its
 * outputs to the shared interface types.
 */

import type {
  PrintEngine, PrintEngineId, PrintJobSettings, PrintJobResult,
  PrintJobState, DiscoveredPrinter,
} from './types';
import {
  checkPrintLatchStatus, submitPrintLatchJob, getPrintLatchJobStatus,
  retryPrintLatchJob, cancelPrintLatchJob, getPrintLatchPrinters,
  type PrintLatchPrinter,
} from '@/lib/printlatch/client';

function mapPrinter(p: PrintLatchPrinter): DiscoveredPrinter {
  return {
    id: p.id,
    name: p.name,
    isDefault: false,
    supportsColor: p.kind !== 'capture',
    supportsDuplex: false, // PrintLatch v0.1.1 does not expose duplex support
    status: p.kind,
  };
}

export class PrintLatchEngine implements PrintEngine {
  readonly id: PrintEngineId = 'printlatch';
  readonly displayName = 'PrintLatch';

  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    const { state, error } = await checkPrintLatchStatus();
    return { available: state === 'connected', error: error ?? undefined };
  }

  async getPrinters(): Promise<DiscoveredPrinter[]> {
    try {
      const printers = await getPrintLatchPrinters();
      return printers.map(mapPrinter);
    } catch {
      return [];
    }
  }

  async submitJob(pdf: Uint8Array, filename: string, settings: PrintJobSettings): Promise<PrintJobResult> {
    // PrintLatch v0.1.1 API: POST /v1/jobs with file, mode, printer_id, copies.
    // Does NOT support duplex, paperSize, color, orientation per-job —
    // those are handled by the Windows printer driver.
    const job = await submitPrintLatchJob({
      pdf,
      filename,
      mode: 'print',
      copies: Math.min(Math.max(1, settings.copies), 10),
      printerId: settings.printerName, // PrintLatch uses printer_id
    });
    return {
      jobId: job.id,
      status: job.status === 'queued' ? 'queued' : job.status === 'printing' ? 'printing'
        : job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed'
        : job.status === 'canceled' ? 'cancelled' : 'unknown',
      engine: 'printlatch',
      error: job.error?.message,
    };
  }

  async getJobStatus(jobId: string): Promise<PrintJobState> {
    const job = await getPrintLatchJobStatus(jobId);
    return {
      id: job.id,
      status: job.status === 'queued' ? 'queued' : job.status === 'printing' ? 'printing'
        : job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed'
        : job.status === 'canceled' ? 'cancelled' : 'unknown',
      engine: 'printlatch',
      error: job.error?.message,
    };
  }

  async retryJob(jobId: string): Promise<PrintJobState> {
    const job = await retryPrintLatchJob(jobId);
    return { id: job.id, status: 'queued', engine: 'printlatch' };
  }

  async cancelJob(jobId: string): Promise<PrintJobState> {
    const job = await cancelPrintLatchJob(jobId);
    return { id: job.id, status: 'cancelled', engine: 'printlatch' };
  }
}
