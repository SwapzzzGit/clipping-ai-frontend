import { Job, Mode, Stage } from "../api";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_claude: "Waiting for Claude",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  done: "Ready to review",
  failed: "Failed",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill s-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function ModeChip({ mode, by }: { mode: Mode; by?: string }) {
  if (by === "action") return <span className="chip mode-api">Action picks</span>;
  return <span className={`chip mode-${mode}`}>{mode === "claude" ? "Claude picks" : "API key"}</span>;
}

const STEPS: { id: Stage; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "selection", label: "Choose moments" },
  { id: "download", label: "Download ranges" },
  { id: "render", label: "Render 9:16" },
];

export function Stepper({ job }: { job: Job }) {
  const idx = job.stage === "done" ? STEPS.length : STEPS.findIndex((s) => s.id === job.stage);
  const failed = job.status === "failed" || job.status === "cancelled";
  return (
    <ol className="stepper" aria-label="Pipeline progress">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? (failed ? "fail" : job.status === "awaiting_claude" ? "wait" : "now") : "todo";
        const label = s.id !== "selection" ? s.label
          : job.selection?.by === "action" ? "Action chooses"
          : job.mode === "claude" ? "Claude chooses" : "LLM chooses";
        return (
          <li key={s.id} className={state}>
            <span className="num">{state === "done" ? "✓" : i + 1}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ job }: { job: Job }) {
  const { done, total } = job.progress;
  const order = ["transcript", "selection", "download", "render", "done"];
  const base = order.indexOf(job.stage) / 4;
  const within = total ? done / total / 4 : 0;
  const pct = job.status === "done" ? 100 : Math.round(Math.min(1, base + within) * 100);
  return (
    <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} className={job.status === "failed" ? "bad" : job.status === "awaiting_claude" ? "warn" : ""} />
    </div>
  );
}

export function ModeToggle({ value, onChange, name }: { value: Mode; onChange: (m: Mode) => void; name: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Who chooses the clip moments">
      {(["claude", "api"] as Mode[]).map((m) => (
        <label key={m} className={value === m ? "on" : ""}>
          <input type="radio" name={name} value={m} checked={value === m} onChange={() => onChange(m)} />
          <b>{m === "claude" ? "Claude" : "API key"}</b>
          <small>{m === "claude" ? "Claude reads the transcript and picks" : "Automatic LLM scoring (Gemini/Anthropic/OpenAI)"}</small>
        </label>
      ))}
    </div>
  );
}
