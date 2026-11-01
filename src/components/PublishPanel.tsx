import { useState } from "react";
import { usePolling } from "../hooks";
import { Account, Category, JobWithPublish, pub, PLATFORM_LABEL, POST_STATUS_LABEL } from "../publishApi";

/** Where a finished job's clips go: its category's accounts, status per clip × account, and a Publish button. */
export default function PublishPanel({ job }: { job: JobWithPublish }) {
  const { data: cats } = usePolling<Category[]>(pub.categories, 0);
  const { data: accounts } = usePolling<Account[]>(pub.accounts, 0);
  const { data: posts, refresh } = usePolling(pub.posts, 4000);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cat = (cats || []).find((c) => c.id === job.category_id);
  const approved = job.clips.filter((c) => c.status === "ok" && c.review?.approved);
  const rows = (posts?.rows || []).filter((r) => r.job_id === job.id);
  const targetIds = picked ?? cat?.account_ids ?? [];

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      await pub.publishJob(job.id, {
        ...(picked || !cat ? { account_ids: targetIds } : {}),
        ...(when ? { scheduled_at: new Date(when).toISOString() } : {}),
      });
      setMsg({ ok: true, text: when ? "Scheduled" : "Publishing started" });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel publish">
      <div className="section-head">
        <h2>Publish</h2>
        {cat ? (
          <span className="chip catchip" style={{ ["--cat" as string]: cat.color }}>{cat.name}</span>
        ) : (
          <span className="muted small">No category: pick accounts below</span>
        )}
        {cat && (
          <span className="muted small">
            {cat.approval === "auto" ? `Auto-approves clips scoring ≥ ${cat.min_score}` : "Approving a clip publishes it"}
            {!cat.autopublish && " (publishing paused for this category)"}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="grid-table compact">
            <thead><tr><th>Clip</th>{[...new Set(rows.map((r) => r.account_id))].map((a) => {
              const r = rows.find((x) => x.account_id === a)!;
              return <th key={a}><span className={`chip plat-${r.platform}`}>{PLATFORM_LABEL[r.platform || ""] || r.platform}</span> {r.account}</th>;
            })}</tr></thead>
            <tbody>
              {[...new Set(rows.map((r) => r.clip_id))].map((cid) => (
                <tr key={cid}>
                  <td>#{cid} {rows.find((r) => r.clip_id === cid)!.clip_title}</td>
                  {[...new Set(rows.map((r) => r.account_id))].map((a) => {
                    const r = rows.find((x) => x.clip_id === cid && x.account_id === a);
                    return (
                      <td key={a}>
                        {r ? (r.url ? <a href={r.url} target="_blank" rel="noreferrer" className={`pill p-${r.status}`}>{POST_STATUS_LABEL[r.status]} ↗</a>
                          : <span className={`pill p-${r.status}`} title={r.error || ""}>{POST_STATUS_LABEL[r.status] || r.status}</span>) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="small">
        <summary>Publish {approved.length} approved clip{approved.length === 1 ? "" : "s"} now or on a schedule</summary>
        <div className="pubform">
          <div className="chips">
            {(accounts || []).map((a) => {
              const on = targetIds.includes(a.id);
              return (
                <label key={a.id} className={`togglechip ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => setPicked(on ? targetIds.filter((x) => x !== a.id) : [...targetIds, a.id])} />
                  {PLATFORM_LABEL[a.platform] || a.platform} · {a.display_name || a.username}
                </label>
              );
            })}
            {(accounts || []).length === 0 && <span className="muted">Connect accounts under Accounts & categories.</span>}
          </div>
          <label className="field inline">
            <span>Schedule (optional)</span>
            <input id={`pub-when-${job.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <button className="primary" disabled={busy || approved.length === 0 || targetIds.length === 0} onClick={publish}>
            {busy ? "Starting…" : when ? "Schedule posts" : "Publish now"}
          </button>
          {approved.length === 0 && <span className="muted">Approve clips below first.</span>}
          <p className="muted">Clips already sent to an account are skipped, so nothing is posted twice.</p>
        </div>
      </details>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}
    </section>
  );
}
