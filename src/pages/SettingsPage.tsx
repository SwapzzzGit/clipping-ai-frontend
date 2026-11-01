import { useEffect, useState } from "react";
import { api, Settings, SystemInfo } from "../api";
import { ModeToggle } from "../components/bits";

const DEFAULT_MODEL: Record<string, string> = {
  gemini: "gemini-flash-lite-latest",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-5-mini",
  mock: "mock (offline test data)",
};
const ENV_KEY: Record<string, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export default function SettingsPage({ system }: { system: SystemInfo | null }) {
  const [s, setS] = useState<Settings | null>(null);
  const [newKey, setNewKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.settings().then(setS).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);
  if (!s) return <p className="muted">{msg?.text || "Loading settings…"}</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  async function save(extra: Record<string, unknown> = {}) {
    setMsg(null);
    try {
      const { has_api_key: _h, api_key_hint: _a, ...rest } = s!;
      const saved = await api.saveSettings({ ...rest, ...(newKey ? { llm_api_key: newKey } : {}), ...extra });
      setS(saved);
      setNewKey("");
      setMsg({ ok: true, text: "Settings saved" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    await save();
    const r = await api.testLlm().catch((e) => ({ ok: false, error: (e as Error).message }));
    setMsg(r.ok ? { ok: true, text: `Connected to ${"model" in r ? r.model : ""}` } : { ok: false, text: ("error" in r && r.error) || "Test failed" });
    setTesting(false);
  }

  const envKey = ENV_KEY[s.llm_provider];
  const envHas = envKey && system?.env_keys?.[envKey];

  return (
    <div className="settings">
      <h1>Settings</h1>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}

      <section className="panel">
        <h2>Default for new jobs</h2>
        <p className="muted small">Who chooses the clip moments. You can still change it per job.</p>
        <ModeToggle value={s.default_mode} onChange={(m) => set("default_mode", m)} name="set-mode" />
        <div className="row-end"><button className="primary" onClick={() => save()}>Save</button></div>
      </section>

      <section className="panel">
        <h2>API key mode</h2>
        <p className="muted small">Used when a job runs in “API key” mode. A cheap, fast model is plenty: it scores ~45 transcript chunks for a 2-hour video.</p>
        <div className="grid2">
          <label className="field">
            <span>Provider</span>
            <select id="set-provider" value={s.llm_provider} onChange={(e) => set("llm_provider", e.target.value as Settings["llm_provider"])}>
              <option value="gemini">Google Gemini</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI-compatible (OpenAI, Ollama, LM Studio)</option>
              <option value="mock">Mock (free offline test)</option>
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input id="set-model" value={s.llm_model} placeholder={DEFAULT_MODEL[s.llm_provider]} onChange={(e) => set("llm_model", e.target.value)} />
          </label>
          <label className="field">
            <span>API key</span>
            <input id="set-key" type="password" autoComplete="off" value={newKey} onChange={(e) => setNewKey(e.target.value)}
              placeholder={s.has_api_key ? `Saved (${s.api_key_hint}). Type to replace` : envHas ? `Using ${envKey} from the environment` : "Paste key"} />
          </label>
          {s.llm_provider === "openai" && (
            <label className="field">
              <span>Base URL (optional)</span>
              <input id="set-base" value={s.llm_base_url} placeholder="https://api.openai.com/v1 or http://localhost:11434/v1" onChange={(e) => set("llm_base_url", e.target.value)} />
            </label>
          )}
        </div>
        <p className="muted small">Keys are stored only on this machine in <code>backend/data/settings.json</code> and are never sent back to the browser.</p>
        <div className="row-end">
          {s.has_api_key && <button className="link" onClick={() => save({ clear_api_key: true })}>Remove saved key</button>}
          <button onClick={test} disabled={testing}>{testing ? "Testing…" : "Save and test"}</button>
          <button className="primary" onClick={() => save()}>Save</button>
        </div>
      </section>

      <section className="panel">
        <h2>Claude mode</h2>
        <p className="muted small">
          When a job needs its moments chosen, the backend writes a task folder (transcript + instructions). Claude picks it up in one of three ways:
        </p>
        <ol className="ways">
          <li><b>Automatic:</b> the backend launches Claude Code headless (<code>claude -p</code>) on this machine. It uses your Claude subscription, not an API key.</li>
          <li><b>On demand:</b> in any Claude Code session opened in this repo, run <code>/clip-jobs</code>.</li>
          <li><b>Scheduled:</b> create a scheduled task or routine in the Claude app that runs <code>/clip-jobs</code> every 15 minutes.</li>
        </ol>
        <label className="check">
          <input id="set-auto" type="checkbox" checked={s.claude_auto_dispatch} onChange={(e) => set("claude_auto_dispatch", e.target.checked)} />
          Launch Claude Code automatically when a job is waiting
        </label>
        <div className="grid2">
          <label className="field">
            <span>Claude Code CLI</span>
            <input id="set-claude" value={s.claude_command} placeholder={system?.claude_cli || "Not found: install Claude Code or paste the path"}
              onChange={(e) => set("claude_command", e.target.value)} />
          </label>
          <label className="field">
            <span>Model (optional)</span>
            <input id="set-claude-model" value={s.claude_model} placeholder="Claude Code default" onChange={(e) => set("claude_model", e.target.value)} />
          </label>
          <label className="field">
            <span>Time limit per job (minutes)</span>
            <input id="set-timeout" type="number" min={1} max={120} value={s.claude_timeout_min} onChange={(e) => set("claude_timeout_min", +e.target.value)} />
          </label>
        </div>
        <div className="row-end"><button className="primary" onClick={() => save()}>Save</button></div>
      </section>

      <section className="panel">
        <h2>This machine</h2>
        {!system ? <p className="muted">Checking…</p> : (
          <dl className="sysinfo">
            <dt>ffmpeg</dt><dd className={system.ffmpeg ? "" : "badtext"}>{system.ffmpeg || "Not found"}</dd>
            <dt>JS runtime for YouTube</dt><dd className={system.js_runtime ? "" : "badtext"}>{system.js_runtime || "None (install Node or Deno)"}</dd>
            <dt>Claude Code</dt><dd className={system.claude_cli ? "" : "badtext"}>{system.claude_version ? `${system.claude_version}` : "Not found"}{system.claude_cli ? <><br /><code className="small">{system.claude_cli}</code></> : null}</dd>
            <dt>API keys in environment</dt><dd>{Object.entries(system.env_keys).filter(([, v]) => v).map(([k]) => k).join(", ") || "None"}</dd>
            <dt>Data folder</dt><dd><code className="small">{system.data_dir}</code></dd>
          </dl>
        )}
      </section>
    </div>
  );
}
