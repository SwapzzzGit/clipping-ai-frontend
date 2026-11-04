import { FormEvent, useEffect, useState } from "react";
import { api, ago, clock, Job, Mode, uploadVideo } from "../api";
import { ModeChip, ModeToggle, ProgressBar, StatusPill } from "../components/bits";
import { usePolling } from "../hooks";
import { Category, JobWithPublish, pub } from "../publishApi";

export default function JobsPage({ jobs }: { jobs: Job[] | null }) {
  const { data: cats } = usePolling<Category[]>(pub.categories, 15000);
  const byId = Object.fromEntries((cats || []).map((c) => [c.id, c]));
  return (
    <div className="jobs-layout">
      <NewJob cats={cats || []} />
      <section className="joblist" aria-label="Jobs">
        <div className="section-head">
          <h2>Jobs</h2>
          {jobs && <span className="muted">{jobs.length} total</span>}
        </div>
        {!jobs ? (
          <p className="muted">Loading jobs…</p>
        ) : jobs.length === 0 ? (
          <div className="empty">
            <b>No jobs yet.</b>
            <p>Paste a YouTube link on the left. Captions are read first; only the chosen moments get downloaded.</p>
          </div>
        ) : (
          jobs.map((j) => <JobRow key={j.id} job={j} cat={byId[(j as JobWithPublish).category_id || ""]} />)
        )}
      </section>
    </div>
  );
}

function JobRow({ job, cat }: { job: Job; cat?: Category }) {
  const v = job.video;
  return (
    <a className="jobrow" href={`#/jobs/${job.id}`}>
      <div className="thumb">{v?.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" /> : <span>{job.id.slice(0, 4)}</span>}</div>
      <div className="jr-main">
        <div className="jr-title">{v?.title || (job.url.startsWith("upload:") ? "Uploaded video" : job.url)}</div>
        <div className="jr-meta">
          <StatusPill status={job.status} />
          <ModeChip mode={job.mode} by={job.selection?.by} />
          {cat && <span className="chip catchip" style={{ ["--cat" as string]: cat.color }}>{cat.name}</span>}
          {v?.duration ? <span>{clock(v.duration)}</span> : null}
          <span>{job.options.num_clips} clips</span>
          <span>{ago(job.created_at)}</span>
        </div>
        <ProgressBar job={job} />
        <div className="jr-msg">{job.error || job.progress.message}</div>
      </div>
    </a>
  );
}

function NewJob({ cats }: { cats: Category[] }) {
  const [tab, setTab] = useState<"single" | "file" | "batch">("single");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [batchText, setBatchText] = useState("");
  const [category, setCategory] = useState("");
  const [batchResult, setBatchResult] = useState<{ jobs: string[]; errors: string[] } | null>(null);
  const [mode, setMode] = useState<Mode>("claude");
  const [numClips, setNumClips] = useState(5);
  const [minSec, setMinSec] = useState(20);
  const [maxSec, setMaxSec] = useState(60);
  const [captions, setCaptions] = useState(true);
  const [language, setLanguage] = useState("en");
  const [useDefaultRules, setUseDefaultRules] = useState(true);
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then((s) => setMode(s.default_mode)).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBatchResult(null);
    setBusy(true);
    try {
      if (tab === "batch") {
        const r = await pub.createBatch({ text: batchText, default_category: category || null, mode,
          num_clips: numClips, min_sec: minSec, max_sec: maxSec, captions });
        setBatchResult(r);
        if (!r.errors.length) setBatchText("");
        return;
      }
      let source = url;
      if (tab === "file") {
        if (!file) throw new Error("Choose a video file first.");
        setUploadPct(0);
        source = (await uploadVideo(file, setUploadPct)).url;
      }
      const job = await api.createJob({
        url: source, mode, num_clips: numClips, min_sec: minSec, max_sec: maxSec, captions, language,
        rules: useDefaultRules ? null : rules, category_id: category || null,
      });
      window.location.hash = `#/jobs/${job.id}`;
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  }

  return (
    <form className="panel newjob" onSubmit={submit}>
      <div className="newjob-head">
        <h2>New clip job</h2>
        <div className="tabs small" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "single"} className={tab === "single" ? "on" : ""} onClick={() => setTab("single")}>One link</button>
          <button type="button" role="tab" aria-selected={tab === "file"} className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>Upload from this PC</button>
          <button type="button" role="tab" aria-selected={tab === "batch"} className={tab === "batch" ? "on" : ""} onClick={() => setTab("batch")}>Batch</button>
        </div>
      </div>
      {tab === "single" ? (
        <label className="field">
          <span>YouTube link</span>
          <input id="nj-url" type="url" required placeholder="https://www.youtube.com/watch?v=…" value={url}
            onChange={(e) => setUrl(e.target.value)} autoFocus />
        </label>
      ) : tab === "file" ? (
        <label className="field">
          <span>Video file on this computer (MP4, MOV, MKV, WebM, M4V or AVI)</span>
          <input id="nj-file" type="file" accept="video/*,.mkv,.mov,.m4v,.webm,.avi"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <span className="small">{file.name} · {(file.size / 1024 ** 3).toFixed(2)} GB</span>}
          {uploadPct !== null && (
            <div className="upload-bar" role="progressbar" aria-valuenow={Math.round(uploadPct * 100)}>
              <div style={{ width: `${Math.round(uploadPct * 100)}%` }} />
            </div>
          )}
        </label>
      ) : (
        <label className="field">
          <span>One link per line, optionally followed by a category</span>
          <textarea id="nj-batch" rows={6} required value={batchText} onChange={(e) => setBatchText(e.target.value)}
            placeholder={["https://youtu.be/abc123xyz00, finance", "https://youtu.be/def456uvw11, motivation",
              "https://youtu.be/ghi789rst22"].join("\n")} />
        </label>
      )}

      <label className="field">
        <span>{tab === "batch" ? "Category for lines without one" : "Category (where the clips get posted)"}</span>
        <select id="nj-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">No category (review and publish by hand)</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}: {(c.accounts || []).length} account{(c.accounts || []).length === 1 ? "" : "s"}, {c.approval === "auto" ? "automatic" : "manual approval"}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Who chooses the moments</span>
        <ModeToggle value={mode} onChange={setMode} name="nj-mode" />
      </div>

      <div className="grid3">
        <label className="field">
          <span>Clips</span>
          <input id="nj-n" type="number" min={1} max={20} value={numClips} onChange={(e) => setNumClips(+e.target.value)} />
        </label>
        <label className="field">
          <span>Min sec</span>
          <input id="nj-min" type="number" min={5} max={170} value={minSec} onChange={(e) => setMinSec(+e.target.value)} />
        </label>
        <label className="field">
          <span>Max sec</span>
          <input id="nj-max" type="number" min={10} max={180} value={maxSec} onChange={(e) => setMaxSec(+e.target.value)} />
        </label>
      </div>

      <details className="more">
        <summary>Captions, language and campaign rules</summary>
        <div className="grid2">
          <label className="field">
            <span>Subtitle language</span>
            <input id="nj-lang" value={language} maxLength={10} onChange={(e) => setLanguage(e.target.value)} />
          </label>
          <label className="check">
            <input id="nj-captions" type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
            Burn in word-by-word captions
          </label>
        </div>
        <label className="check">
          <input id="nj-defrules" type="checkbox" checked={useDefaultRules} onChange={(e) => setUseDefaultRules(e.target.checked)} />
          Use the category's rules (or <code>campaign_rules.txt</code>)
        </label>
        {!useDefaultRules && (
          <label className="field">
            <span>Rules for this job (hard constraints; leave empty for none)</span>
            <textarea id="nj-rules" rows={4} value={rules} onChange={(e) => setRules(e.target.value)}
              placeholder={"DON'T pick moments about politics.\nDO prefer concrete, actionable advice."} />
          </label>
        )}
      </details>

      {err && <div className="banner bad">{err}</div>}
      {batchResult && (
        <div className={`banner ${batchResult.errors.length ? "bad" : "good"}`}>
          Queued {batchResult.jobs.length} video{batchResult.jobs.length === 1 ? "" : "s"}.
          {batchResult.errors.length > 0 && <ul className="small">{batchResult.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
      <button className="primary big" type="submit"
        disabled={busy || !(tab === "single" ? url.trim() : tab === "file" ? file : batchText.trim())}>
        {busy
          ? uploadPct !== null ? `Uploading ${Math.round(uploadPct * 100)}%…` : "Starting…"
          : tab === "batch" ? "Queue all videos" : "Make clips"}
      </button>
      {tab === "file" && (
        <p className="hint">
          The file uploads to Clipper first, then it is transcribed here. If the video has no speech (gaming, music),
          the clips are picked from the action on screen and in the sound instead.
        </p>
      )}
      <p className="hint">
        {mode === "claude"
          ? "After the transcript is read, Claude picks the moments. Everything else runs automatically."
          : "Fully automatic: the LLM scores the transcript using the key in Settings."}
      </p>
    </form>
  );
}
