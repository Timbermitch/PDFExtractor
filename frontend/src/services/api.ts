import axios, { AxiosError } from 'axios';
import type { ExtractedReport, ReportListItem } from '../types';

// Determine base API URL with a resilient fallback strategy
const envBase = (process.env.REACT_APP_API_BASE || '').trim();
// Prefer same-origin during dev when CRA proxy is configured; fallback to explicit port 4000.
const inferredBase = envBase || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : 'http://localhost:4000');
export const API_BASE = inferredBase.replace(/\/$/, '');
// eslint-disable-next-line no-console
console.log('[api] base URL resolved to', API_BASE);

// Central axios instance for future interceptors (auth, tracing, etc.)
const http = axios.create({ baseURL: API_BASE, timeout: 20000 });

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
      const { data } = await http.post<UploadResponse>('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async process(id: string): Promise<ExtractedReport> {
    try {
      const { data } = await http.post<ExtractedReport>('/process', { id });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async export(id: string, format: 'json'|'csv' = 'json'): Promise<ExtractedReport | Blob> {
    try {
      const url = `/export/${id}?format=${format}`;
      const res = await http.get(url, { responseType: format === 'csv' ? 'blob' : 'json' });
      return res.data as any;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async listReports(): Promise<ReportListItem[]> {
    try {
      const { data } = await http.get<ReportsResponse>('/reports');
      return data.reports;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[api] listReports failed', e);
      throw normalizeError(e);
    }
  },
  async deleteReport(id: string): Promise<{ id: string; deleted: number }> {
    try {
      const { data } = await http.delete<{ id: string; deleted: number }>(`/reports/${id}`);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  },
  async deleteAllReports(): Promise<{ purged: { bronze: number; silver: number; gold: number }; total: number }> {
    try {
      const { data } = await http.delete<{ purged: { bronze: number; silver: number; gold: number }; total: number }>('/reports');
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
