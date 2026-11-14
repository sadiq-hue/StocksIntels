// Frontend service for Azure AI Position Intelligence endpoints.
// All requests are authenticated via authFetch (JWT bearer token).

import { authFetch } from "../auth/tokenStore";
import type {
  AiAnalysisRecord,
  AiPositionIntelligence,
} from "../types/signals";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface AnalyzeResponse {
  ok: boolean;
  ticker: string;
  model: string;
  prompt_schema_version: string;
  analysis: AiPositionIntelligence;
  generated_at: string;
}

export interface AiHealthResponse {
  ok: boolean;
  model: string;
  service: string;
  error?: string;
}

/** Request AI analysis for a position. */
export async function requestAiAnalysis(
  ticker: string
): Promise<AnalyzeResponse> {
  const res = await authFetch(
    `${API_BASE}/ai/positions/${encodeURIComponent(ticker)}/analyze`,
    { method: "POST" }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new Error(body.error || `AI analysis failed (${res.status})`);
  }
  return (await res.json()) as AnalyzeResponse;
}

/** Retrieve the latest AI analysis for a position. */
export async function getLatestAiAnalysis(
  ticker: string
): Promise<AiAnalysisRecord | null> {
  const res = await authFetch(
    `${API_BASE}/ai/positions/${encodeURIComponent(ticker)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to fetch AI analysis (${res.status})`);
  }
  return (await res.json()) as AiAnalysisRecord;
}

/** Retrieve historical AI analyses for a position. */
export async function getAiAnalysisHistory(
  ticker: string,
  limit = 10
): Promise<AiAnalysisRecord[]> {
  const res = await authFetch(
    `${API_BASE}/ai/positions/${encodeURIComponent(ticker)}/history?limit=${limit}`
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to fetch AI history (${res.status})`);
  }
  const data = (await res.json()) as { analyses: AiAnalysisRecord[] };
  return data.analyses;
}

/** Check Azure AI service health. */
export async function checkAiHealth(): Promise<AiHealthResponse> {
  const res = await fetch(`${API_BASE}/ai/health`);
  if (!res.ok) {
    return { ok: false, model: "unknown", service: "azure-ai-foundry", error: `HTTP ${res.status}` };
  }
  return (await res.json()) as AiHealthResponse;
}
