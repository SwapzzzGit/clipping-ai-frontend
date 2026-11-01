import { RefObject, useEffect, useState } from "react";
import { api, clock, Clip, isActive, Job, Mark } from "../api";

// Start/End-here marks on a rendered clip, then Re-render that one clip trimmed to them.
export default function TrimControls({ job, clip, videoRef, onSaved }: {
  job: Job; clip: Clip; videoRef: RefObject<HTMLVideoElement>; onSaved: (j: Job) => void;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const marks = clip.review?.marks || [];
  const trims = clip.review?.trims || [];
  const latest: Partial<Record<Mark["kind"], Mark>> = {};
  for (const m of marks) latest[m.kind] = m;
  const dur = clip.duration_sec || 1;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setReady(v.readyState >= 1);
    on();
    v.addEventListener("loadedmetadata", on);
    return () => v.removeEventListener("loadedmetadata", on);
  }, [videoRef, clip.file]);

  async function run(fn: () => Promise<Job>) {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const markHere = (kind: Mark["kind"]) =>
    run(() => api.addMark(job.id, clip.id, kind, videoRef.current?.currentTime ?? 0));

  if (isActive(job) && clip.rerendering) {
    return <div className="trim"><p className="small muted">Re-rendering…</p></div>;
  }

  return (
    <div className="trim">
      <div className="trim-bar" aria-hidden="true">
        {latest.start && <i className="cut" style={{ left: 0, width: pct(latest.start.t) }} />}
        {latest.end && <i className="cut" style={{ left: pct(latest.end.t), right: 0 }} />}
        {marks.map((m, n) => (
          <button key={n} className={`tick ${m.kind}`} style={{ left: pct(m.t) }} title={`${clock(m.t)} ${m.kind} here`}
            onClick={() => videoRef.current && (videoRef.current.currentTime = m.t)} />
        ))}
      </div>
      <div className="review">
        <button disabled={!ready || busy} onClick={() => markHere("start")}>Start here</button>
        <button disabled={!ready || busy} onClick={() => markHere("end")}>End here</button>
        <button className="primary" disabled={!marks.length || busy || isActive(job)}
          onClick={() => run(() => api.rerender(job.id, clip.id))}>Re-render</button>
        {marks.length > 0 && (
          <button disabled={busy} onClick={() => run(() => api.clearMarks(job.id, clip.id))}>Reset</button>
        )}
      </div>
      {marks.length > 0 && (
        <ul className="trim-list small">
          {marks.map((m, n) => <li key={n} className="mono">{clock(m.t)} {m.kind} here</li>)}
        </ul>
      )}
      {trims.length > 0 && (
        <ul className="trim-list small muted">
          {trims.map((t, n) => (
            <li key={n} className="mono">{clock(t.from[0])}–{clock(t.from[1])} → {clock(t.to[0])}–{clock(t.to[1])}</li>
          ))}
        </ul>
      )}
      {err && <p className="small bad-text">{err}</p>}
    </div>
  );
}
