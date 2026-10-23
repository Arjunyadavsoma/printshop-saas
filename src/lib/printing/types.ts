/**
 * Unified printing interface — shared by both engines (native + PrintLatch).
 * The application talks to this interface; the router selects the engine.
 */

export type PrintEngineId = 'native' | 'printlatch' | 'auto';

export type DuplexSetting = 'simplex' | 'long-edge' | 'short-edge';

export interface PrintJobSettings {
  copies: number;
  paperSize?: string;
  color?: 'bw' | 'color';
  duplex?: DuplexSetting;
  orientation?: 'portrait' | 'landscape';
  printerName?: string;
}

export interface DiscoveredPrinter {
  id: string;
  name: string;
  isDefault?: boolean;
  supportsColor?: boolean;
  supportsDuplex?: boolean;
  status?: string;
}

export type PrintJobStatus =
  | 'queued' | 'submitting' | 'accepted' | 'printing'
  | 'completed' | 'failed' | 'cancelled' | 'unknown';

export interface PrintJobResult {
  jobId: string;
  status: PrintJobStatus;
  error?: string;
  engine: PrintEngineId;
}

export interface PrintJobState {
  id: string;
  status: PrintJobStatus;
  error?: string;
  engine: PrintEngineId;
  printerName?: string;
  submittedAt?: string;
  completedAt?: string;
}

export interface PrintEngine {
  readonly id: PrintEngineId;
  readonly displayName: string;
  checkAvailability(): Promise<{ available: boolean; error?: string }>;
  getPrinters(): Promise<DiscoveredPrinter[]>;
  submitJob(pdf: Uint8Array, filename: string, settings: PrintJobSettings): Promise<PrintJobResult>;
  getJobStatus(jobId: string): Promise<PrintJobState>;
  retryJob?(jobId: string): Promise<PrintJobState>;
  cancelJob?(jobId: string): Promise<PrintJobState>;
}
