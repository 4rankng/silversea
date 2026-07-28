import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export class LocalStorageService {
  private uploadDir: string;
  private uploadDirResolved: string;

  constructor() {
    this.uploadDir = config.uploadDir || path.join(process.cwd(), 'uploads');
    this.uploadDirResolved = path.resolve(this.uploadDir);
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private resolveKeyPath(key: string): string {
    const resolved = path.resolve(this.uploadDirResolved, key);
    if (key.includes('..') || !resolved.startsWith(this.uploadDirResolved + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolved;
  }

  async upload(fileBuffer: Buffer, key: string): Promise<string> {
    const filePath = this.resolveKeyPath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, fileBuffer);
    return key;
  }

  async getSignedUrl(key: string): Promise<string> {
    // Return relative URL serving via authenticated route or express static
    return `/api/photos/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKeyPath(key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolveKeyPath(key));
  }

  /**
   * Read a stored file's bytes. Resolves the key under uploadDir with a
   * path-traversal guard (mirrors the /api/photos serving route). Returns null
   * for a missing or unreadable file so callers (e.g. logo embed into an XLSX)
   * can degrade gracefully rather than fail the whole export.
   */
  async read(key: string): Promise<Buffer | null> {
    let filePath: string;
    try {
      filePath = this.resolveKeyPath(key);
    } catch {
      return null;
    }
    if (!fs.existsSync(filePath)) return null;
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }
}

export const storageService = new LocalStorageService();
