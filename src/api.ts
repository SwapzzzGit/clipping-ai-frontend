export type Mode = "claude" | "api";
export type JobStatus = "queued" | "running" | "awaiting_claude" | "cancelling" | "cancelled" | "done" | "failed";
export type Stage = "transcript" | "selection" | "download" | "render" | "done";

export interface Mark { kind: "start" | "end"; t: number; source_sec: number; at: string }
export interface Trim { from: [number, number]; to: [number, number]; at: string }
export interface Review { approved: boolean | null; notes: string; marks?: Mark[]; trims?: Trim[] }

export interface Clip {
  id: number;
  status: string;
  error?: string;
  file: string | null;
  thumbnail: string | null;
  title: string;
  hook_line: string;
  reason: string;
  score: number;
  score_breakdown: Record<string, number>;
  heatmap: number;
  selected_by: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  source_url: string;
  transcript: string;
  reframe: { detector: string; face_coverage: number; shots: number; source_resolution: string } | null;
  source_t0?: number | null;
  rerendering?: boolean;
  review: Review;
}

export interface Pick { id: number; start_sec: number; end_sec: number; title: string; hook_line: string; score: number; reason: string }

export interface Job {
  id: string;
  url: string;
  mode: Mode;
  options: { num_clips: number; min_sec: number; max_sec: number; language: string; rules: string; captions: boolean };
  status: JobStatus;
  stage: Stage;
  progress: { done: number; total: number; message: string };
  video: { id: string; title: string; channel: string; duration: number; thumbnail: string; captions: string; heatmap: boolean } | null;
  selection: { by: string; model?: string; usage?: { calls: number; input_tokens: number; output_tokens: number } | null; at: string } | null;
  claude: { task_dir?: string; dispatch_status?: string; dispatch_log?: string; dispatched_at?: string } | null;
  picks?: Pick[] | null;
  clips: Clip[];
  clip_count?: number;
  error: string | null;
  log?: { t: string; level: string; msg: string }[];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Settings {
  default_mode: Mode;
  llm_provider: "gemini" | "anthropic" | "openai" | "mock";
  llm_model: string;
  llm_base_url: string;
  has_api_key: boolean;
  api_key_hint: string;
  claude_auto_dispatch: boolean;
  claude_command: string;
  claude_model: string;
  claude_timeout_min: number;
}

export interface SystemInfo {
  ffmpeg: string | null;
  js_runtime: string | null;
  claude_cli: string | null;
  claude_version: string | null;
  env_keys: Record<string, boolean>;
  data_dir: string;
  worker_busy: string | null;
}

export class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("clipper:signin"));
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      const d = body.detail;
      msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg?.replace(/^Value error, /, "")).join("; ") : msg;
    } catch { /* keep status text */ }
    throw new ApiError(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const post = (path: string, body?: unknown) => req<any>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export const auth = {
  status: () => req<{ required: boolean; authenticated: boolean }>("/api/auth/status"),
  login: (password: string) => post("/api/auth/login", { password }),
  logout: () => post("/api/auth/logout"),
};

export const api = {
  jobs: () => req<Job[]>("/api/jobs"),
  job: (id: string) => req<Job>(`/api/jobs/${id}`),
  createJob: (body: Record<string, unknown>) => post("/api/jobs", body) as Promise<Job>,
  cancel: (id: string) => post(`/api/jobs/${id}/cancel`),
  retry: (id: string, from_stage: Stage) => post(`/api/jobs/${id}/retry`, { from_stage }),
  switchMode: (id: string, mode: Mode) => post(`/api/jobs/${id}/mode?mode=${mode}`),
  dispatch: (id: string) => post(`/api/jobs/${id}/dispatch-claude`),
  remove: (id: string) => req<void>(`/api/jobs/${id}`, { method: "DELETE" }),
  review: (id: string, clipId: number, review: Review) =>
    req<Job>(`/api/jobs/${id}/clips/${clipId}`, { method: "PATCH", body: JSON.stringify(review) }),
  addMark: (id: string, clipId: number, kind: Mark["kind"], t: number) =>
    post(`/api/jobs/${id}/clips/${clipId}/marks`, { kind, t }) as Promise<Job>,
  clearMarks: (id: string, clipId: number) => req<Job>(`/api/jobs/${id}/clips/${clipId}/marks`, { method: "DELETE" }),
  rerender: (id: string, clipId: number) => post(`/api/jobs/${id}/clips/${clipId}/rerender`) as Promise<Job>,
  settings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Record<string, unknown>) => req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  testLlm: () => post("/api/settings/test-llm") as Promise<{ ok: boolean; model?: string; reply?: string; error?: string }>,
  system: () => req<SystemInfo>("/api/system"),
};

// finished_at changes only when a run ends, so a re-rendered clip (same filename) reloads exactly once.
export const media = (job: Job, file: string) =>
  `/media/${job.id}/${encodeURIComponent(file)}?v=${encodeURIComponent(job.finished_at ?? "")}`;

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const isActive = (j: Job) => ["queued", "running", "awaiting_claude", "cancelling"].includes(j.status);
