import { promises as fs } from 'fs';
import path from 'path';
import {
  InMemorySemanticSyncStateStore,
  type SemanticSyncState,
  type SemanticSyncStateStore,
  normalizeSemanticSyncState,
} from './sync-state.js';

export interface FileSemanticSyncStateStoreOptions {
  filepath: string;
  /**
   * Create parent directories automatically (default true).
   */
  autoCreateDir?: boolean;
}

/**
 * JSON file-backed semantic sync store.
 * Suitable for local development or simple deployments.
 */
export class FileSemanticSyncStateStore implements SemanticSyncStateStore {
  private readonly filepath: string;
  private readonly autoCreateDir: boolean;
  private readonly fallback = new InMemorySemanticSyncStateStore();

  constructor(options: FileSemanticSyncStateStoreOptions) {
    this.filepath = path.resolve(options.filepath);
    this.autoCreateDir = options.autoCreateDir ?? true;
  }

  async load(): Promise<SemanticSyncState | null> {
    try {
      const data = await fs.readFile(this.filepath, 'utf-8');
      const parsed = JSON.parse(data) as SemanticSyncState;
      return normalizeSemanticSyncState(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async save(state: SemanticSyncState): Promise<void> {
    const dir = path.dirname(this.filepath);
    if (this.autoCreateDir) {
      await fs.mkdir(dir, { recursive: true });
    }
    const tmp = `${this.filepath}.tmp`;
    const payload = JSON.stringify(normalizeSemanticSyncState(state), null, 2);
    await fs.writeFile(tmp, payload, 'utf-8');
    await fs.rename(tmp, this.filepath);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await this.fallback.clear();
  }
}

