import { useEffect, useState } from "react";
import { api, auth, Job, SystemInfo } from "./api";
import { usePolling } from "./hooks";
import JobsPage from "./pages/JobsPage";
import JobPage from "./pages/JobPage";
import SettingsPage from "./pages/SettingsPage";
import CategoriesPage from "./pages/CategoriesPage";
import PostsPage from "./pages/PostsPage";

// Tiny hash router: #/ (jobs), #/jobs/<id>, #/accounts, #/posts, #/settings
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export default function App() {
  // undefined = checking; true = show the app; false = sign-in required (APP_PASSWORD set on the server)
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    auth.status().then((s) => setSignedIn(!s.required || s.authenticated)).catch(() => setSignedIn(true));
    const out = () => setSignedIn(false);
    window.addEventListener("clipper:signin", out);
    return () => window.removeEventListener("clipper:signin", out);
  }, []);
  if (signedIn === undefined) return null;
  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;
  return <Studio />;
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signin">
      <form className="panel" onSubmit={submit}>
        <a className="brand" href="#/"><span className="rec" aria-hidden="true" />Clipper Studio</a>
        <label className="field"><span>Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="banner bad">{error}</div>}
        <button className="primary" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

function Studio() {
  const route = useRoute();
  const { data: jobs, error } = usePolling<Job[]>(api.jobs, 3000);
  const { data: system } = usePolling<SystemInfo>(api.system, 15000);
  const waiting = (jobs || []).filter((j) => j.status === "awaiting_claude").length;
  const page = route[0] || "";

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="rec" aria-hidden="true" />
          Clipper Studio
        </a>
        <nav>
          <a href="#/" className={page === "" || page === "jobs" ? "on" : ""}>Jobs</a>
          <a href="#/accounts" className={page === "accounts" ? "on" : ""}>Accounts & categories</a>
          <a href="#/posts" className={page === "posts" ? "on" : ""}>Posts</a>
          <a href="#/settings" className={page === "settings" ? "on" : ""}>Settings</a>
        </nav>
        <div className="sys">
          {waiting > 0 && <span className="badge warn">{waiting} waiting for Claude</span>}
          <Dot ok={!!system?.ffmpeg} label="ffmpeg" />
          <Dot ok={!!system?.claude_cli} label="Claude CLI" />
          <Dot ok={!error} label={error ? "API offline" : "API"} />
        </div>
      </header>
      <main className="page">
        {error && !jobs && (
          <div className="banner bad">
            Can't reach the backend. Start it with <code>python backend/run.py</code> from the repo root.
          </div>
        )}
        {page === "jobs" && route[1] ? (
          <JobPage id={route[1]} />
        ) : page === "accounts" ? (
          <CategoriesPage />
        ) : page === "posts" ? (
          <PostsPage />
        ) : page === "settings" ? (
          <SettingsPage system={system} />
        ) : (
          <JobsPage jobs={jobs} />
        )}
      </main>
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="dot" title={`${label}: ${ok ? "ready" : "not available"}`}>
      <i className={ok ? "ok" : "off"} />
      {label}
    </span>
  );
}
