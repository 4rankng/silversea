import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export class LocalStorageService {
  private uploadDir: string;

  constructor() {
    this.uploadDir = config.uploadDir || path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(fileBuffer: Buffer, key: string): Promise<string> {
    const filePath = path.join(this.uploadDir, key);
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
    const filePath = path.join(this.uploadDir, key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(this.uploadDir, key));
  }

  /**
   * Read a stored file's bytes. Resolves the key under uploadDir with a
   * path-traversal guard (mirrors the /api/photos serving route). Returns null
   * for a missing or unreadable file so callers (e.g. logo embed into an XLSX)
   * can degrade gracefully rather than fail the whole export.
   */
  async read(key: string): Promise<Buffer | null> {
    if (key.includes('..')) return null;
    const filePath = path.resolve(this.uploadDir, key);
    if (!filePath.startsWith(path.resolve(this.uploadDir) + path.sep)) return null;
    if (!fs.existsSync(filePath)) return null;
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }
}

export const storageService = new LocalStorageService();
