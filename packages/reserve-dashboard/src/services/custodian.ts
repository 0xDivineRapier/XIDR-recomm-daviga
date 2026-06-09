import { readFileSync, watchFile } from "fs";
import path from "path";

export interface ReserveSource {
  name: string;
  getBalance(): Promise<{ idr_balance: number; updated_at: string }>;
}

export interface CustodianFile {
  idr_balance: number;
  updated_at: string;
}

// File-based fallback — swap out for a live API by implementing ReserveSource
export class FileReserveSource implements ReserveSource {
  name = "file";
  private filePath: string;
  private cached: CustodianFile | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), "data/custodian-balance.json");
    this.loadFile();
    watchFile(this.filePath, { interval: 5000 }, () => this.loadFile());
  }

  private loadFile() {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      this.cached = JSON.parse(raw) as CustodianFile;
    } catch {
      this.cached = null;
    }
  }

  async getBalance() {
    if (!this.cached) throw new Error("Custodian balance file unavailable or invalid");
    return this.cached;
  }
}

// Singleton instance — replace with a live implementation in production
let _source: ReserveSource = new FileReserveSource();

export function setReserveSource(source: ReserveSource) {
  _source = source;
}

export function getReserveSource(): ReserveSource {
  return _source;
}
