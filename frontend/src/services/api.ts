import axios, { AxiosError } from 'axios';
import type { ExtractedReport, ReportListItem } from '../types';

// Auto-detect backend port if not explicitly supplied via REACT_APP_API_BASE.
// The backend may retry up to two times (5200 -> 5201 -> 5202). We probe /health on each.
const envBase = (process.env.REACT_APP_API_BASE || '').trim();
let resolvedBasePromise: Promise<string> | null = null;

async function detectBase(): Promise<string> {
  if (envBase) return envBase.replace(/\/$/, '');
  if (resolvedBasePromise) return resolvedBasePromise; // memoize concurrent callers
  if (typeof window === 'undefined') return 'http://localhost:5200';
  const originHost = window.location.hostname; // typically localhost
  const protocol = window.location.protocol;
  const candidatePorts = [5200, 5201, 5202];
  resolvedBasePromise = (async () => {
    for (const p of candidatePorts) {
      const base = `${protocol}//${originHost}:${p}`;
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 1800);
        const r = await fetch(`${base}/health`, { signal: ctrl.signal });
        clearTimeout(timeout);
        if (r.ok) {
          // eslint-disable-next-line no-console
            console.log('[api] detected backend port', p);
          return base;
        }
      } catch { /* ignore and continue */ }
    }
    // Fallback to 5200 (may fail but surfaces consistent error path)
    // eslint-disable-next-line no-console
    console.warn('[api] autodetect failed; falling back to :5200');
    return `${protocol}//${originHost}:5200`;
  })();
  return resolvedBasePromise;
}

// Lazy axios instance created after detection; callers await ensureHttp()
let http: ReturnType<typeof axios.create> | null = null;
let API_BASE = 'http://localhost:5200';
export async function ensureHttp() {
  if (!http) {
    API_BASE = (await detectBase()).replace(/\/$/, '');
    // eslint-disable-next-line no-console
    console.log('[api] base URL resolved to', API_BASE);
    http = axios.create({ baseURL: API_BASE, timeout: 20000 });
  }
  return http;
}
export async function forceRedetect() {
  // Reset and re-run detection; useful if backend restarted on another port mid-session.
  http = null;
  resolvedBasePromise = null;
  return ensureHttp();
}
export { API_BASE };

// Shape definitions for responses
interface UploadResponse { id: string; rawText: string; metadata: Record<string, unknown>; }
interface ReportsResponse { reports: ReportListItem[] }

function normalizeError(err: unknown): Error {
  if (axios.isAxiosError(err)) {
    const a = err as AxiosError<any>;
    const msg = a.response?.data?.error || a.message || 'Network request failed';
    return new Error(msg);
  }
  if (err instanceof Error) return err;
  return new Error('Unknown error');
}

export const api = {
  async upload(file: File): Promise<UploadResponse> {
    try {
      const form = new FormData();
      form.append('file', file);
      // Allow axios to set correct multipart boundary automatically (do NOT override Content-Type)
  const client = await ensureHttp();
  const { data } = await client.post<UploadResponse>('/upload', form);
      return data;
    } catch (e) {
      // eslint-disable-next-line no-console
      if (axios.isAxiosError(e)) {
        console.error('[api] upload failed axios', {
          message: e.message,
          code: e.code,
          status: e.response?.status,
          data: e.response?.data,
          headers: e.response?.headers,
          url: e.config?.url,
          method: e.config?.method,
          baseURL: e.config?.baseURL,
          timeout: e.config?.timeout
        });
      } else {
        console.error('[api] upload failed generic', e);
      }
      throw normalizeError(e);
    }
  },
  async process(id: string): Promise<ExtractedReport> {
    try {
  const client = await ensureHttp();
  const { data } = await client.post<ExtractedReport>('/process', { id });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async export(id: string, format: 'json'|'csv' = 'json'): Promise<ExtractedReport | Blob> {
    try {
      const url = `/export/${id}?format=${format}`;
  const client = await ensureHttp();
  const res = await client.get(url, { responseType: format === 'csv' ? 'blob' : 'json' });
      return res.data as any;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async listReports(): Promise<ReportListItem[]> {
    try {
  const client = await ensureHttp();
  const { data } = await client.get<ReportsResponse>('/reports');
      return data.reports;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[api] listReports failed', e);
      throw normalizeError(e);
    }
  },
  async deleteReport(id: string): Promise<{ id: string; deleted: number }> {
    try {
  const client = await ensureHttp();
  const { data } = await client.delete<{ id: string; deleted: number }>(`/reports/${id}`);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async deleteAllReports(): Promise<{ purged: { bronze: number; silver: number; gold: number }; total: number }> {
    try {
  const client = await ensureHttp();
  const { data } = await client.delete<{ purged: { bronze: number; silver: number; gold: number }; total: number }>('/reports');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async downloadCSV(id: string): Promise<void> {
    const blob = await this.export(id, 'csv');
    if (blob instanceof Blob) {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } else {
      throw new Error('Unexpected CSV download response type');
    }
  }
};
