/**
 * Telemetry client for SDK events (Telemetry-Events-Specs-v2).
 * Fire-and-forget; never blocks or throws.
 */

export const DEFAULT_TELEMETRY_ENDPOINT =
  'https://pepzouxscqxcejwjcbro.supabase.co/functions/v1/ingest-telemetry';

export type TelemetryErrorType =
  | 'NETWORK_ERROR'
  | 'CONTRACT_ERROR'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'IPFS_ERROR'
  | 'SUBGRAPH_ERROR'
  | 'UNKNOWN';

export interface TelemetryEvent {
  eventType: string;
  success: boolean;
  durationMs: number;
  timestamp: number;
  payload?: Record<string, unknown>;
  errorType?: TelemetryErrorType;
}

export function categorizeError(error: unknown): TelemetryErrorType {
  if (error == null) return 'UNKNOWN';
  const msg = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'NETWORK_ERROR' || /fetch|network|econnrefused|enotfound/i.test(msg)) return 'NETWORK_ERROR';
  if (/CALL_EXCEPTION|contract|revert|execution reverted/i.test(code) || /revert|contract/i.test(msg)) return 'CONTRACT_ERROR';
  if (/validation|invalid|bad request/i.test(msg) || /VALIDATION/i.test(code)) return 'VALIDATION_ERROR';
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return 'TIMEOUT';
  if (/not found|404|NOT_FOUND/i.test(msg)) return 'NOT_FOUND';
  if (/unauthorized|403|permission|UNAUTHORIZED/i.test(msg)) return 'UNAUTHORIZED';
  if (/rate limit|429|RATE_LIMITED/i.test(msg)) return 'RATE_LIMITED';
  if (/ipfs|IPFS_ERROR|pinata|pin\.fs/i.test(msg)) return 'IPFS_ERROR';
  if (/subgraph|graphql|SUBGRAPH_ERROR/i.test(msg)) return 'SUBGRAPH_ERROR';
  return 'UNKNOWN';
}

export interface TelemetryConfig {
  apiKey: string;
  endpoint?: string;
}

export class TelemetryClient {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: TelemetryConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  }

  /**
   * Emit events (fire-and-forget). Never throws; failures are ignored.
   */
  emit(events: TelemetryEvent[]): void {
    if (events.length === 0) return;
    const body = JSON.stringify({ events });
    fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    }).catch(() => {
      // Silently ignore telemetry failures
    });
  }
}
