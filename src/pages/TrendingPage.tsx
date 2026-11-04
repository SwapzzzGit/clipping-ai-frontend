import { useEffect, useMemo, useRef, useState } from "react";
import { api, ago, clock } from "../api";
import { usePolling } from "../hooks";
import { Category, pub } from "../publishApi";

// Trending videos from the YouTube Data API v3, grouped by YouTube's own video categories.
// The key is typed in once and kept in this browser only; it is sent straight to googleapis.com.
const YT = "https://www.googleapis.com/youtube/v3";
const KEY_STORE = "clipper:youtubeKey";
const REGION_STORE = "clipper:trendingRegion";
const REGIONS: [string, string][] = [
  ["US", "United States"], ["GB", "United Kingdom"], ["IN", "India"], ["CA", "Canada"], ["AU", "Australia"],
  ["DE", "Germany"], ["FR", "France"], ["JP", "Japan"], ["BR", "Brazil"],
];
const MIN_LENGTH: [number, string][] = [[0, "Any length"], [60, "1+ min"], [300, "5+ min"], [600, "10+ min"]];

interface YtVideo {
  id: string;
  snippet: {
    title: string; channelTitle: string; publishedAt: string; categoryId: string;
    defaultLanguage?: string; defaultAudioLanguage?: string; thumbnails?: Record<string, { url: string }>;
  };
  statistics?: { viewCount?: string };
  contentDetails?: { duration: string };
}
interface YtCategory { id: string; snippet: { title: string } }
interface Loaded { videos: YtVideo[]; podcasts: YtVideo[]; names: Record<string, string>; at: string }
// Not a YouTube category id (those are numeric), so it can't collide with one.
const PODCAST_ID = "podcast";

const readStore = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: keep it for this visit only */ } };

async function yt<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const res = await fetch(`${YT}/${path}?${new URLSearchParams({ ...params, key })}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `YouTube API error ${res.status}`);
  return body as T;
}

// Languages a region's podcasts can be in. Search ignores region and language, so results are checked after.
const REGION_LANGS: Record<string, string[]> = {
  US: ["en"], GB: ["en"], CA: ["en"], AU: ["en"], IN: ["hi", "en"], DE: ["de"], FR: ["fr"], JP: ["ja"], BR: ["pt"],
};
const hasJapanese = (t: string) => /[぀-ヿ一-鿿]/.test(t);
const hasDevanagari = (t: string) => /[ऀ-ॿ]/.test(t);

function inRegionLanguage(v: YtVideo, langs: string[]): boolean {
  const tag = (v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || "").split("-")[0].toLowerCase();
  if (tag) return langs.includes(tag);
  const script = langs.includes("ja") ? hasJapanese : langs.includes("hi") ? hasDevanagari : null;
  return script ? script(v.snippet.title) : true;
}

// YouTube has no podcast category, so podcasts come from a search for the word, ranked by views, last 30 days.
async function fetchPodcasts(key: string, region: string): Promise<YtVideo[]> {
  const langs = REGION_LANGS[region] || ["en"];
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const found = await yt<{ items: { id: { videoId?: string } }[] }>("search", {
    part: "id", type: "video", q: "podcast", order: "viewCount", regionCode: region,
    relevanceLanguage: langs[0], publishedAfter: since, maxResults: "50",
  }, key);
  const ids = found.items.map((i) => i.id.videoId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const details = await yt<{ items: YtVideo[] }>("videos", {
    part: "snippet,statistics,contentDetails", id: ids.join(","),
  }, key);
  return details.items.filter((v) => inRegionLanguage(v, langs));
}

async function fetchTrending(key: string, region: string): Promise<Loaded> {
  const [cats, first, podcasts] = await Promise.all([
    yt<{ items: YtCategory[] }>("videoCategories", { part: "snippet", regionCode: region }, key).catch(() => ({ items: [] })),
    yt<{ items: YtVideo[]; nextPageToken?: string }>("videos", {
      part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: region, maxResults: "50",
    }, key),
    fetchPodcasts(key, region),
  ]);
  const videos = [...first.items];
  let token = first.nextPageToken;
  if (token && videos.length < 100) {
    const second = await yt<{ items: YtVideo[] }>("videos", {
      part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: region, maxResults: "50", pageToken: token,
    }, key);
    videos.push(...second.items);
  }
  const names = Object.fromEntries(cats.items.map((c) => [c.id, c.snippet.title]));
  return { videos, podcasts, names, at: new Date().toISOString() };
}

function parseDuration(iso: string | undefined): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export default function TrendingPage() {
  const { data: cats } = usePolling<Category[]>(pub.categories, 0);
  const [key, setKey] = useState(() => readStore(KEY_STORE));
  const [keyDraft, setKeyDraft] = useState("");
  const [region, setRegion] = useState(() => readStore(REGION_STORE) || "US");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minLen, setMinLen] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [catId, setCatId] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const reqId = useRef(0);

  async function load() {
    if (!key) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchTrending(key, region);
      if (id === reqId.current) setLoaded(r);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [key, region]);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    const k = keyDraft.trim();
    if (!k) return;
    writeStore(KEY_STORE, k);
    setKey(k);
    setKeyDraft("");
  }

  function forgetKey() {
    writeStore(KEY_STORE, "");
    setKey("");
    setLoaded(null);
    setPicked(new Set());
  }

  function changeRegion(r: string) {
    writeStore(REGION_STORE, r);
    setRegion(r);
    setPicked(new Set());
  }

  const nameOf = (id: string) => (id === PODCAST_ID ? "Podcasts" : loaded?.names[id] || `Category ${id}`);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keep = (v: YtVideo) =>
      (!q || `${v.snippet.title} ${v.snippet.channelTitle}`.toLowerCase().includes(q)) &&
      parseDuration(v.contentDetails?.duration) >= minLen;
    const byViews = (a: YtVideo, b: YtVideo) => +(b.statistics?.viewCount || 0) - +(a.statistics?.viewCount || 0);
    const map = new Map<string, YtVideo[]>();
    for (const v of (loaded?.videos || []).filter(keep)) {
      const list = map.get(v.snippet.categoryId) || [];
      list.push(v);
      map.set(v.snippet.categoryId, list);
    }
    const trending: [string, YtVideo[]][] = [...map.entries()]
      .map(([id, vids]): [string, YtVideo[]] => [id, vids.sort(byViews)])
      .sort((a, b) => b[1].length - a[1].length);
    const podcasts = (loaded?.podcasts || []).filter(keep).sort(byViews);
    return podcasts.length ? [[PODCAST_ID, podcasts] as [string, YtVideo[]], ...trending] : trending;
  }, [loaded, search, minLen]);

  const total = groups.reduce((n, [, v]) => n + v.length, 0);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function send(ids: string[]) {
    if (ids.length === 0) return;
    setSending(true);
    setMsg(null);
    try {
      const { default_mode } = await api.settings();
      const r = await pub.createBatch({
        text: ids.map(watchUrl).join("\n"),
        default_category: catId || null,
        mode: default_mode,
        num_clips: 5,
        min_sec: 20,
        max_sec: 60,
        captions: true,
      });
      setSent((s) => new Set([...s, ...ids]));
      setPicked((p) => new Set([...p].filter((id) => !ids.includes(id))));
      setMsg({ ok: r.errors.length === 0, text: `Sent ${r.jobs.length} video${r.jobs.length === 1 ? "" : "s"} to clipping.`, errors: r.errors });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (!key) {
    return (
      <div className="catpage">
        <header className="pagehead">
          <h1>Trending videos</h1>
          <p className="muted">Paste a YouTube Data API v3 key to load what's trending by category.</p>
        </header>
        <form className="panel" onSubmit={saveKey}>
          <label className="field"><span>YouTube Data API key</span>
            <input type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza…" />
          </label>
          <p className="muted small">
            Create one in Google Cloud Console, enable "YouTube Data API v3", and restrict the key to this site.
            It is stored only in this browser.
          </p>
          <div className="row-end"><button className="primary" disabled={!keyDraft.trim()}>Save key</button></div>
        </form>
      </div>
    );
  }

  return (
    <div className="catpage">
      <header className="pagehead">
        <h1>Trending videos</h1>
        <p className="muted">
          Grouped by YouTube category. Pick videos and send them to a category to clip them.
          {loaded && <> Updated {ago(loaded.at)}.</>}
        </p>
      </header>

      <section className="panel trend-head">
        <label className="field"><span>Region</span>
          <select value={region} onChange={(e) => changeRegion(e.target.value)}>
            {REGIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className="field"><span>Title or channel</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" />
        </label>
        <label className="field"><span>Length</span>
          <select value={minLen} onChange={(e) => setMinLen(+e.target.value)}>
            {MIN_LENGTH.map(([sec, label]) => <option key={sec} value={sec}>{label}</option>)}
          </select>
        </label>
        <div className="row-end">
          <button onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          <button className="link danger" onClick={forgetKey}>Change key</button>
        </div>
      </section>

      {error && <div className="banner bad">{error}</div>}
      {msg && (
        <div className={`banner ${msg.ok ? "good" : "bad"}`}>
          {msg.text} {msg.ok && <a href="#/">Watch progress on Jobs</a>}
          {msg.errors && msg.errors.length > 0 && <div className="small">{msg.errors.join("; ")}</div>}
        </div>
      )}

      {loaded && (
        <div className="trend-bar">
          <b>{picked.size} selected</b>
          <label className="field trend-cat"><span>Send to category</span>
            <select value={catId} onChange={(e) => setCatId(e.target.value)}>
              <option value="">No category</option>
              {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="primary" disabled={sending || picked.size === 0}
            onClick={() => void send([...picked])}>
            {sending ? "Sending…" : picked.size ? `Send ${picked.size} to clipping` : "Send to clipping"}
          </button>
          {picked.size > 0 && <button className="link" onClick={() => setPicked(new Set())}>Clear</button>}
        </div>
      )}

      {!loaded && !loading && !error && <p className="muted">Loading trending videos…</p>}
      {loaded && groups.length > 0 && (
        <nav className="trend-jump" aria-label="Categories">
          {groups.map(([id, vids]) => (
            <a key={id} href={`#trend-${id}`} className="chip">{nameOf(id)} · {vids.length}</a>
          ))}
        </nav>
      )}
      {loaded && loaded.podcasts.length === 0 && (
        <p className="muted small">No podcast videos in this region's language from the last 30 days.</p>
      )}
      {loaded && total === 0 && !loading && (
        <div className="empty"><b>No videos match.</b><p>Try another region or clear the filters.</p></div>
      )}

      {groups.map(([id, vids]) => (
        <section key={id} id={`trend-${id}`} className="trend-group">
          <div className="section-head"><h2>{nameOf(id)}</h2><span className="muted">{vids.length}</span></div>
          <div className="trend-grid">
            {vids.map((v) => {
              const thumb = v.snippet.thumbnails?.medium?.url;
              const secs = parseDuration(v.contentDetails?.duration);
              const isSent = sent.has(v.id);
              return (
                <article key={v.id} className={`vcard ${picked.has(v.id) ? "picked" : ""}`}>
                  <a className="vthumb" href={watchUrl(v.id)} target="_blank" rel="noreferrer">
                    {thumb && <img src={thumb} alt="" loading="lazy" />}
                    {secs > 0 && <span className="vlen">{clock(secs)}</span>}
                  </a>
                  <div className="vbody">
                    <a className="vtitle" href={watchUrl(v.id)} target="_blank" rel="noreferrer">{v.snippet.title}</a>
                    <div className="vmeta">
                      {v.snippet.channelTitle} · {compact.format(+(v.statistics?.viewCount || 0))} views · {ago(v.snippet.publishedAt)}
                    </div>
                    <div className="vact">
                      <label className="vpick">
                        <input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} />
                        Select
                      </label>
                      <button className="link" disabled={sending} onClick={() => void send([v.id])}>
                        {isSent ? "Sent again" : "Send to clipping"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
