import { useMemo, useState } from "react";
import { ago } from "../api";
import { usePolling } from "../hooks";
import { pub, PLATFORM_LABEL, POST_STATUS_LABEL, PostRow } from "../publishApi";

const GROUPS: { id: string; label: string; match: (s: string) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "posted", label: "Posted", match: (s) => s === "published" },
  { id: "pending", label: "In progress", match: (s) => ["scheduled", "queued", "uploading", "processing"].includes(s) },
  { id: "notposted", label: "Not posted", match: (s) => ["not_posted", "awaiting_review"].includes(s) },
  { id: "failed", label: "Failed", match: (s) => ["failed", "cancelled"].includes(s) },
];

export default function PostsPage() {
  const { data, error, refresh } = usePolling(pub.posts, 4000);
  const [group, setGroup] = useState("all");
  const [cat, setCat] = useState("");
  const [platform, setPlatform] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const rows = data?.rows || [];

  const cats = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[], [rows]);
  const platforms = useMemo(() => [...new Set(rows.map((r) => r.platform).filter(Boolean))] as string[], [rows]);
  const g = GROUPS.find((x) => x.id === group)!;
  const shown = rows.filter((r) => g.match(r.status) && (!cat || r.category === cat) && (!platform || r.platform === platform)
    && r.status !== "rejected");
  const count = (id: string) => rows.filter((r) => GROUPS.find((x) => x.id === id)!.match(r.status) && r.status !== "rejected").length;

  async function retry(r: PostRow) {
    if (!r.publish_job) return;
    setRetrying(r.publish_job);
    try { await pub.retryPublish(r.publish_job); await refresh(); } finally { setRetrying(null); }
  }

  return (
    <div className="postspage">
      <header className="pagehead">
        <h1>Posts</h1>
        <p className="muted">Every clip × account across all videos: what went out, what is scheduled, and what is still waiting.</p>
      </header>
      {error && <div className="banner bad">{error}</div>}

      <div className="tabs" role="tablist">
        {GROUPS.map((x) => (
          <button key={x.id} role="tab" aria-selected={group === x.id} className={group === x.id ? "on" : ""} onClick={() => setGroup(x.id)}>
            {x.label} <span className="count">{count(x.id)}</span>
          </button>
        ))}
        <span className="filters">
          <select id="pf-cat" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select id="pf-plat" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] || p}</option>)}
          </select>
        </span>
      </div>

      {!data ? <p className="muted">Loading…</p> : shown.length === 0 ? (
        <div className="empty">
          <b>{rows.length === 0 ? "Nothing to track yet." : "No posts match these filters."}</b>
          {rows.length === 0 && <p>Submit videos to a category with connected accounts. Rendered clips show up here per account.</p>}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="grid-table posts">
            <thead>
              <tr><th>Clip</th><th>Category</th><th>Account</th><th>Status</th><th>When</th><th aria-label="Link" /></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.job_id}-${r.clip_id}-${r.account_id}`}>
                  <td>
                    <a href={`#/jobs/${r.job_id}`}><b>{r.clip_title}</b></a>
                    <div className="muted small ellipsis">{r.video_title}</div>
                  </td>
                  <td>{r.category || <span className="muted">none</span>}</td>
                  <td>
                    <span className={`chip plat-${r.platform}`}>{PLATFORM_LABEL[r.platform || ""] || r.platform}</span>
                    <div className="small">{r.account}</div>
                  </td>
                  <td>
                    <span className={`pill p-${r.status}`}>{POST_STATUS_LABEL[r.status] || r.status}</span>
                    {r.error && <div className="badtext small">{r.error}</div>}
                  </td>
                  <td className="small muted">{r.status === "scheduled" && r.when ? new Date(r.when).toLocaleString() : ago(r.when)}</td>
                  <td className="right">
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer">Open ↗</a>
                      : r.status === "failed" ? <button className="link" disabled={retrying === r.publish_job} onClick={() => retry(r)}>Retry</button>
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
