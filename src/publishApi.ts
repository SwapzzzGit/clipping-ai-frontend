// Categories, accounts, batches, publishing and the posts tracker.
import { ApiError, Job, Mode } from "./api";

export type Approval = "auto" | "manual";

export interface Account {
  id: string;
  platform: string;
  display_name: string;
  username: string;
  status?: string;        // "connected" | "reconnect_needed"
  error?: string | null;
  avatar?: string | null;
  options?: Record<string, unknown>;
}

export interface Platform {
  id: string;
  label: string;
  configured: boolean;
  redirect_uri: string;
  env: string[];
  accounts: number;
  warning?: string;
  connect_ready?: boolean;
  blocker?: string | null;
  limits: { notes: string[]; daily_post_limit: number | null; max_duration_sec: number };
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  account_ids: string[];
  accounts?: Account[];
  job_count?: number;
  approval: Approval;
  autopublish: boolean;
  min_score: number;
  max_clips_per_video: number;
  spacing_minutes: number;
  hashtags: string[];
  use_llm_captions: boolean;
  rules: string;
}

export interface PostRow {
  job_id: string;
  video_title: string | null;
  category_id: string | null;
  category: string | null;
  clip_id: number;
  clip_title: string;
  score: number | null;
  file: string | null;
  account_id: string;
  account: string;
  platform: string | null;
  status: string;         // scheduled|queued|uploading|processing|published|failed|cancelled|not_posted|awaiting_review|rejected
  url: string | null;
  error: string | null;
  when: string | null;
  publish_job: string | null;
}

export interface Batch { id: string; created_at: string; jobs: number; statuses: Record<string, number> }

export type JobWithPublish = Job & {
  category_id?: string | null;
  batch_id?: string | null;
  publish?: { jobs: string[]; pairs: { clip_id: number; account_id: string; publish_job: string }[] };
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  if (res.status === 401) window.dispatchEvent(new Event("clipper:signin"));
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const d = (await res.json()).detail;
      msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg?.replace(/^Value error, /, "")).join("; ") : msg;
    } catch { /* keep status text */ }
    throw new ApiError(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
const send = <T>(method: string, path: string, body?: unknown) =>
  req<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const pub = {
  platforms: () => req<Platform[]>("/api/publish/platforms"),
  accounts: () => req<Account[]>("/api/publish/accounts"),
  disconnect: (id: string) => send<void>("DELETE", `/api/publish/accounts/${id}`),
  // return_to: if the browser opens the sign-in in this tab instead of a popup, the callback comes back here.
  oauthStart: (platform: string, loginHint?: string) =>
    req<{ auth_url: string }>(`/api/publish/oauth/${platform}/start?` + new URLSearchParams({
      return_to: window.location.href, ...(loginHint ? { login_hint: loginHint } : {}) })),
  categories: () => req<Category[]>("/api/categories"),
  createCategory: (c: Partial<Category>) => send<Category>("POST", "/api/categories", c),
  updateCategory: (id: string, c: Partial<Category>) => send<Category>("PATCH", `/api/categories/${id}`, c),
  deleteCategory: (id: string) => send<void>("DELETE", `/api/categories/${id}`),
  createBatch: (b: { text: string; default_category?: string | null; mode?: Mode; num_clips: number; min_sec: number; max_sec: number; captions: boolean }) =>
    send<{ batch_id: string; jobs: string[]; errors: string[] }>("POST", "/api/batches", b),
  batches: () => req<Batch[]>("/api/batches"),
  posts: () => req<{ rows: PostRow[]; counts: Record<string, number> }>("/api/posts"),
  publishJob: (jobId: string, body: { clip_ids?: number[]; account_ids?: string[]; scheduled_at?: string }) =>
    send<{ id: string }>("POST", `/api/jobs/${jobId}/publish`, body),
  retryPublish: (pjobId: string) => send("POST", `/api/publish/jobs/${pjobId}/retry`),
};

/** Open the platform sign-in in a popup; resolves when the callback page reports back. */
export function connectAccount(platform: string, loginHint?: string): Promise<Account | null> {
  return new Promise(async (resolve, reject) => {
    let url: string;
    try {
      url = (await pub.oauthStart(platform, loginHint)).auth_url;
    } catch (e) {
      reject(e);
      return;
    }
    const popup = window.open(url, "clipper-connect", "width=520,height=720");
    if (!popup) {
      reject(new ApiError("The sign-in window was blocked. Allow pop-ups for this site and try again."));
      return;
    }
    const done = (value: Account | null) => {
      window.removeEventListener("message", onMsg);
      clearInterval(timer);
      resolve(value);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "clipper-publish-oauth") return;
      if (e.data.ok) done(e.data.account);
      else {
        window.removeEventListener("message", onMsg);
        clearInterval(timer);
        reject(new ApiError("The platform did not grant access."));
      }
    };
    window.addEventListener("message", onMsg);
    const timer = setInterval(() => { if (popup.closed) done(null); }, 700);
  });
}

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels", mock: "Mock (test)",
};

export const POST_STATUS_LABEL: Record<string, string> = {
  published: "Posted", scheduled: "Scheduled", queued: "Queued", uploading: "Uploading", processing: "Processing",
  failed: "Failed", cancelled: "Cancelled", not_posted: "Approved, not posted", awaiting_review: "Awaiting review",
  rejected: "Rejected",
};
