import { useEffect, useRef, useState } from "react";
import { api, ago, clock, Clip, isActive, Job, media, Stage } from "../api";
import { usePolling } from "../hooks";
import { ModeChip, Stepper, StatusPill } from "../components/bits";
import TrimControls from "../components/TrimControls";
import PublishPanel from "../components/PublishPanel";

export default function JobPage({ id }: { id: string }) {
  const [fast, setFast] = useState(true);
  const { data: job, error, refresh, setData } = usePolling<Job>(() => api.job(id), fast ? 2000 : 0);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (job) setFast(isActive(job));
  }, [job?.status]);

  if (error && !job) return <div className="banner bad">{error}</div>;
  if (!job) return <p className="muted">Loading…</p>;

  async function act(fn: () => Promise<unknown>) {
    setActionErr(null);
    try {
      await fn();
      setFast(true);
      await refresh();
    } catch (e) {
      setActionErr((e as Error).message);
    }
  }

  async function del() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    await act(() => api.remove(job!.id));
    window.location.hash = "#/";
  }

  const v = job.video;
  const canRetry = ["failed", "cancelled", "done", "awaiting_claude"].includes(job.status);
  const approved = job.clips.filter((c) => c.review?.approved === true).length;

  return (
    <div className="jobpage">
      <a className="back" href="#/">← All jobs</a>
      <header className="jobhead">
        <div className="jh-text">
          <h1>{v?.title || "Reading video…"}</h1>
          <div className="jr-meta">
            <StatusPill status={job.status} />
            <ModeChip mode={job.mode} />
            {v?.channel && <span>{v.channel}</span>}
            {v?.duration ? <span>{clock(v.duration)}</span> : null}
            {v && <span>{v.captions} captions{v.heatmap ? " · replay heatmap" : ""}</span>}
            <a href={job.url} target="_blank" rel="noreferrer">Open on YouTube ↗</a>
          </div>
        </div>
        <div className="actions">
          {isActive(job) && job.status !== "cancelling" && (
            <button onClick={() => act(() => api.cancel(job.id))}>Cancel</button>
          )}
          {canRetry && (
            <RetryMenu onRetry={(stage) => act(() => api.retry(job.id, stage))} hasPicks={!!job.selection} />
          )}
          {!isActive(job) && (
            <button className="danger" onClick={del}>{confirmDelete ? "Click again to delete" : "Delete"}</button>
          )}
        </div>
      </header>

      <Stepper job={job} />
      <div className="statusline">
        <b>{job.progress.message}</b>
        {job.progress.total > 0 && job.status === "running" && <span> · {job.progress.done}/{job.progress.total}</span>}
        <span className="muted"> · updated {ago(job.updated_at)}</span>
      </div>
      {job.error && <div className="banner bad">{job.error}</div>}
      {actionErr && <div className="banner bad">{actionErr}</div>}

      {job.status === "awaiting_claude" && <ClaudePanel job={job} act={act} />}
      {job.status === "done" && <PublishPanel job={job} />}

      {job.selection && (
        <p className="muted small">
          Moments chosen by <b>{job.selection.by === "claude" ? "Claude" : job.selection.model}</b> {ago(job.selection.at)}
          {job.selection.usage ? ` · ${job.selection.usage.calls} LLM calls, ${(job.selection.usage.input_tokens / 1000).toFixed(0)}k tokens in` : ""}
          {job.clips.length > 0 && ` · ${approved}/${job.clips.length} approved`}
        </p>
      )}

      {job.clips.length > 0 ? (
        <div className="clips">
          {job.clips.map((c) => (
            <ClipCard key={c.id} job={job} clip={c} onSaved={(j) => setData(j)} />
          ))}
        </div>
      ) : job.picks && job.picks.length > 0 ? (
        <section className="panel">
          <h2>Chosen moments</h2>
          <p className="muted small">Downloading and rendering these now.</p>
          <ol className="picks">
            {job.picks.map((p) => (
              <li key={p.id}>
                <span className="mono">{clock(p.start_sec)}–{clock(p.end_sec)}</span> <b>{p.title}</b>
                <div className="muted small">“{p.hook_line}”</div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <LogPanel job={job} />
    </div>
  );
}

function RetryMenu({ onRetry, hasPicks }: { onRetry: (s: Stage) => void; hasPicks: boolean }) {
  const [stage, setStage] = useState<Stage>(hasPicks ? "download" : "selection");
  return (
    <span className="retry">
      <select id="retry-stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)} aria-label="Retry from">
        <option value="selection">Re-choose moments</option>
        <option value="download" disabled={!hasPicks}>Re-download and render</option>
      </select>
      <button onClick={() => onRetry(stage)}>Run again</button>
    </span>
  );
}

function ClaudePanel({ job, act }: { job: Job; act: (fn: () => Promise<unknown>) => void }) {
  const c = job.claude || {};
  const running = c.dispatch_status === "running";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.task_dir || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; the path stays selectable */ }
  };
  return (
    <section className="panel claude">
      <div className="claude-head">
        <h2>{running ? "Claude is choosing the moments…" : "Waiting for Claude"}</h2>
        {running && <span className="spinner" aria-hidden="true" />}
      </div>
      <p>
        The transcript is packaged as a task. Claude reads it, picks the {job.options.num_clips} best moments and writes
        <code> selection.json</code>; this page continues on its own once that file appears.
      </p>
      <div className="claude-ways">
        <div>
          <b>Automatic</b>
          <p className="small muted">Launches Claude Code in the background on this machine.</p>
          <button className="primary" disabled={running} onClick={() => act(() => api.dispatch(job.id))}>
            {running ? "Claude is working" : c.dispatch_status ? "Run Claude again" : "Run Claude now"}
          </button>
        </div>
        <div>
          <b>In a Claude Code session</b>
          <p className="small muted">Open this repo in Claude Code and type:</p>
          <code className="cmd">/clip-jobs</code>
        </div>
        <div>
          <b>Or use the API key instead</b>
          <p className="small muted">Skip Claude for this job and score it automatically.</p>
          <button onClick={() => act(() => api.switchMode(job.id, "api"))}>Switch to API key</button>
        </div>
      </div>
      {c.task_dir && (
        <p className="small muted taskdir">
          Task folder: <code>{c.task_dir}</code> <button className="link" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </p>
      )}
      {c.dispatch_status && c.dispatch_status !== "running" && (
        <details className="small">
          <summary>Last Claude run: {c.dispatch_status}</summary>
          <pre className="logbox">{c.dispatch_log || "(no output)"}</pre>
        </details>
      )}
    </section>
  );
}

function ClipCard({ job, clip, onSaved }: { job: Job; clip: Clip; onSaved: (j: Job) => void }) {
  const [notes, setNotes] = useState(clip.review?.notes || "");
  const [saving, setSaving] = useState(false);
  const approved = clip.review?.approved;
  const videoRef = useRef<HTMLVideoElement>(null);

  async function save(next: boolean | null) {
    setSaving(true);
    try {
      onSaved(await api.review(job.id, clip.id, { approved: next, notes }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`clip ${approved === true ? "approved" : approved === false ? "rejected" : ""}`}>
      {clip.file ? (
        <video ref={videoRef} controls preload="metadata" src={media(job, clip.file)}
          poster={clip.thumbnail ? media(job, clip.thumbnail) : undefined} />
      ) : (
        <div className="noclip">{clip.error || "Not rendered"}</div>
      )}
      <div className="clip-body">
        {clip.file && <TrimControls job={job} clip={clip} videoRef={videoRef} onSaved={onSaved} />}
        <div className="clip-top">
          <span className="score" title="Score out of 10">{clip.score.toFixed(1)}</span>
          <h3>{clip.title}</h3>
        </div>
        <div className="jr-meta">
          <a href={clip.source_url} target="_blank" rel="noreferrer" className="mono">
            {clock(clip.start_sec)}–{clock(clip.end_sec)}
          </a>
          <span>{Math.round(clip.duration_sec)}s</span>
          {clip.heatmap >= 0.5 && <span className="chip hot">Most replayed</span>}
          {clip.reframe && <span title="Share of sampled frames with a face">faces {Math.round(clip.reframe.face_coverage * 100)}%</span>}
        </div>
        <p className="hook">“{clip.hook_line}”</p>
        {clip.reason && <p className="small">{clip.reason}</p>}
        {Object.keys(clip.score_breakdown || {}).length > 0 && (
          <ul className="breakdown">
            {Object.entries(clip.score_breakdown).map(([k, v]) => (
              <li key={k}>
                <span>{k.replace(/_/g, " ").replace("or ", "/ ")}</span>
                <i style={{ width: `${v * 10}%` }} />
                <b>{Math.round(v * 10) / 10}</b>
              </li>
            ))}
          </ul>
        )}
        <details className="small">
          <summary>Transcript</summary>
          <p>{clip.transcript}</p>
        </details>
        <label className="field">
          <span className="sr">Review notes</span>
          <input id={`notes-${clip.id}`} placeholder="Notes (caption idea, post date…)" value={notes}
            onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (clip.review?.notes || "") && save(approved ?? null)} />
        </label>
        <div className="review">
          <button className={approved === true ? "approve on" : "approve"} disabled={saving}
            onClick={() => save(approved === true ? null : true)}>Approve</button>
          <button className={approved === false ? "reject on" : "reject"} disabled={saving}
            onClick={() => save(approved === false ? null : false)}>Reject</button>
          {clip.file && <a className="dl" href={media(job, clip.file)} download>Download MP4</a>}
        </div>
      </div>
    </article>
  );
}

function LogPanel({ job }: { job: Job }) {
  const ref = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(job.status !== "done");
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [job.log?.length, open]);
  const lines = job.log || [];
  return (
    <details className="panel logpanel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Activity log <span className="muted">({lines.length})</span></summary>
      <pre ref={ref} className="logbox">
        {lines.length === 0 ? "Nothing yet." : lines.map((l, i) => (
          <div key={i} className={`lv-${l.level}`}>
            <span className="muted">{l.t.slice(11, 19)}</span> {l.msg}
          </div>
        ))}
      </pre>
    </details>
  );
}
