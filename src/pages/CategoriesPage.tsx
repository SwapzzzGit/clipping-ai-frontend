import { useEffect, useState } from "react";
import { usePolling } from "../hooks";
import { Account, Category, connectAccount, pub, Platform, PLATFORM_LABEL } from "../publishApi";

const CONNECT_LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", mock: "test account" };
const COLORS = ["#e0531f", "#2d7d5a", "#2d5fb5", "#8a4fbf", "#b8860b", "#c2185b", "#00838f"];

export default function CategoriesPage() {
  const { data: platforms, refresh: refreshPlatforms } = usePolling<Platform[]>(pub.platforms, 0);
  const { data: accounts, refresh: refreshAccounts } = usePolling<Account[]>(pub.accounts, 10000);
  const { data: cats, refresh: refreshCats } = usePolling<Category[]>(pub.categories, 10000);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const ready = (platforms || []).filter((p) => p.connect_ready);
  const refreshAll = () => Promise.all([refreshPlatforms(), refreshAccounts(), refreshCats()]);

  async function connect(platform: string) {
    setMsg(null);
    try {
      const acct = await connectAccount(platform, platform === "mock" ? `test${Math.floor(Math.random() * 900 + 100)}` : undefined);
      if (acct) setMsg({ ok: true, text: `Connected ${acct.display_name || acct.username}` });
      await refreshAll();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="catpage">
      <header className="pagehead">
        <h1>Accounts & categories</h1>
        <p className="muted">
          Connect your channels, then group them into categories. A video submitted to a category is clipped once and
          posted to every account in it.
        </p>
      </header>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}

      <section className="panel">
        <div className="section-head"><h2>Connected accounts</h2><span className="muted">{accounts?.length ?? 0}</span></div>
        <div className="platforms">
          {ready.map((p) => (
            <div key={p.id} className="platform">
              <div className="pl-head">
                <b>{p.label || PLATFORM_LABEL[p.id] || p.id}</b>
                <span className="muted small">{p.accounts} connected</span>
              </div>
              <button className="primary" onClick={() => connect(p.id)}>Connect {CONNECT_LABEL[p.id] || p.label}</button>
            </div>
          ))}
          {platforms && ready.length === 0 && <p className="muted small">Publishing isn't available on this server yet.</p>}
        </div>
        {accounts && accounts.length > 0 ? (
          <AccountTable accounts={accounts} cats={cats || []} onChange={refreshAll} setMsg={setMsg} />
        ) : (
          <p className="muted small">No accounts yet. "Connect" opens the platform's own login in a pop-up: sign in, press
            Allow, and the account appears here. Your password goes only to the platform. Repeat to add more accounts.</p>
        )}
      </section>

      <section className="catlist">
        <div className="section-head">
          <h2>Categories</h2>
          <button className="primary" onClick={() => setEditing("new")}>New category</button>
        </div>
        {editing === "new" && (
          <CategoryForm accounts={accounts || []} onDone={async () => { setEditing(null); await refreshCats(); }} />
        )}
        {(cats || []).length === 0 && editing !== "new" && (
          <div className="empty"><b>No categories yet.</b><p>Create one per niche, e.g. Finance, Motivation, Entertainment.</p></div>
        )}
        {(cats || []).map((c) =>
          editing === c.id ? (
            <CategoryForm key={c.id} cat={c} accounts={accounts || []} onDone={async () => { setEditing(null); await refreshCats(); }} />
          ) : (
            <CategoryCard key={c.id} cat={c} onEdit={() => setEditing(c.id)} />
          ),
        )}
      </section>
    </div>
  );
}

function AccountTable({ accounts, cats, onChange, setMsg }: {
  accounts: Account[]; cats: Category[]; onChange: () => void; setMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);

  async function toggle(cat: Category, accountId: string) {
    const ids = cat.account_ids.includes(accountId) ? cat.account_ids.filter((a) => a !== accountId) : [...cat.account_ids, accountId];
    await pub.updateCategory(cat.id, { account_ids: ids });
    onChange();
  }

  async function disconnect(a: Account) {
    if (confirm !== a.id) {
      setConfirm(a.id);
      setTimeout(() => setConfirm(null), 4000);
      return;
    }
    try {
      await pub.disconnect(a.id);
      for (const c of cats.filter((c) => c.account_ids.includes(a.id))) {
        await pub.updateCategory(c.id, { account_ids: c.account_ids.filter((x) => x !== a.id) });
      }
      setMsg({ ok: true, text: `Disconnected ${a.display_name || a.username}` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="tablewrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Platform</th>
            <th>Categories</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>
                <b>{a.display_name || a.username}</b>
                {a.username && a.display_name && <span className="muted small"> @{a.username}</span>}
                {a.status === "reconnect_needed" && <div className="badtext small">Reconnect needed</div>}
              </td>
              <td><span className={`chip plat-${a.platform}`}>{PLATFORM_LABEL[a.platform] || a.platform}</span></td>
              <td>
                <div className="chips">
                  {cats.length === 0 && <span className="muted small">Create a category first</span>}
                  {cats.map((c) => (
                    <label key={c.id} className={`togglechip ${c.account_ids.includes(a.id) ? "on" : ""}`}
                      style={{ ["--cat" as string]: c.color }}>
                      <input type="checkbox" checked={c.account_ids.includes(a.id)} onChange={() => toggle(c, a.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </td>
              <td className="right">
                <button className="link danger" onClick={() => disconnect(a)}>
                  {confirm === a.id ? "Click again to disconnect" : "Disconnect"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryCard({ cat, onEdit }: { cat: Category; onEdit: () => void }) {
  return (
    <article className="catcard" style={{ ["--cat" as string]: cat.color }}>
      <div className="cc-head">
        <span className="swatch" aria-hidden="true" />
        <h3>{cat.name}</h3>
        <span className={`chip ${cat.approval === "auto" ? "auto" : ""}`}>
          {cat.approval === "auto" ? `Auto: score ≥ ${cat.min_score}, top ${cat.max_clips_per_video}` : "Manual approval"}
        </span>
        {!cat.autopublish && <span className="chip">Publishing paused</span>}
        <button className="link" onClick={onEdit}>Edit</button>
      </div>
      {cat.description && <p className="muted small">{cat.description}</p>}
      <div className="chips">
        {(cat.accounts || []).length === 0 ? (
          <span className="badtext small">No accounts: clips will render but nothing posts</span>
        ) : (
          (cat.accounts || []).map((a) => (
            <span key={a.id} className={`chip plat-${a.platform}`}>{PLATFORM_LABEL[a.platform] || a.platform} · {a.display_name || a.username}</span>
          ))
        )}
      </div>
      <p className="muted small">
        {cat.job_count ?? 0} videos · {cat.spacing_minutes ? `posts spaced ${cat.spacing_minutes} min apart` : "posts go out together"}
        {cat.hashtags.length > 0 && ` · ${cat.hashtags.join(" ")}`}
        {cat.use_llm_captions && " · LLM-written captions"}
      </p>
    </article>
  );
}

function CategoryForm({ cat, accounts, onDone }: { cat?: Category; accounts: Account[]; onDone: () => void }) {
  const [f, setF] = useState<Partial<Category>>(cat ? { ...cat } : {
    name: "", description: "", color: COLORS[Math.floor(Math.random() * COLORS.length)], account_ids: [],
    approval: "manual", autopublish: true, min_score: 7, max_clips_per_video: 3, spacing_minutes: 0, hashtags: [],
    use_llm_captions: false, rules: "",
  });
  const [tags, setTags] = useState((cat?.hashtags || []).join(" "));
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => setErr(null), [f.name]);
  const set = <K extends keyof Category>(k: K, v: Category[K]) => setF({ ...f, [k]: v });
  const fid = cat?.id || "new";

  async function save() {
    const body = { ...f, hashtags: tags.split(/[\s,]+/).filter(Boolean) };
    delete (body as Partial<Category>).accounts;
    delete (body as Partial<Category>).job_count;
    try {
      if (cat) await pub.updateCategory(cat.id, body);
      else await pub.createCategory(body);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function del() {
    if (!confirmDel) { setConfirmDel(true); return; }
    await pub.deleteCategory(cat!.id);
    onDone();
  }

  return (
    <form className="panel catform" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>{cat ? `Edit ${cat.name}` : "New category"}</h2>
      <div className="grid2">
        <label className="field"><span>Name</span>
          <input id={`cf-name-${fid}`} required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Finance" />
        </label>
        <label className="field"><span>Colour</span>
          <span className="colors">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`colordot ${f.color === c ? "on" : ""}`} style={{ background: c }}
                aria-label={`Colour ${c}`} onClick={() => set("color", c)} />
            ))}
          </span>
        </label>
      </div>
      <label className="field"><span>Description (optional)</span>
        <input id={`cf-desc-${fid}`} value={f.description} onChange={(e) => set("description", e.target.value)}
          placeholder="Money habits, investing, side hustles" />
      </label>

      <div className="field">
        <span>Accounts that post this category</span>
        <div className="chips">
          {accounts.length === 0 && <span className="muted small">Connect accounts above first.</span>}
          {accounts.map((a) => {
            const on = f.account_ids!.includes(a.id);
            return (
              <label key={a.id} className={`togglechip ${on ? "on" : ""}`} style={{ ["--cat" as string]: f.color }}>
                <input type="checkbox" checked={on} onChange={() =>
                  set("account_ids", on ? f.account_ids!.filter((x) => x !== a.id) : [...f.account_ids!, a.id])} />
                {PLATFORM_LABEL[a.platform] || a.platform} · {a.display_name || a.username}
              </label>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span>How clips get approved</span>
        <div className="seg">
          {(["manual", "auto"] as const).map((m) => (
            <label key={m} className={f.approval === m ? "on" : ""}>
              <input type="radio" name={`cf-appr-${fid}`} checked={f.approval === m} onChange={() => set("approval", m)} />
              <b>{m === "manual" ? "I approve each clip" : "Fully automatic"}</b>
              <small>{m === "manual" ? "Approving a clip on its job page posts it to every account here."
                : "The best clips above the score threshold post as soon as they render."}</small>
            </label>
          ))}
        </div>
      </div>

      <div className="grid3">
        <label className="field"><span>Min score (auto)</span>
          <input id={`cf-min-${fid}`} type="number" min={0} max={10} step={0.5} value={f.min_score}
            disabled={f.approval !== "auto"} onChange={(e) => set("min_score", +e.target.value)} />
        </label>
        <label className="field"><span>Max clips per video (auto)</span>
          <input id={`cf-max-${fid}`} type="number" min={1} max={20} value={f.max_clips_per_video}
            disabled={f.approval !== "auto"} onChange={(e) => set("max_clips_per_video", +e.target.value)} />
        </label>
        <label className="field"><span>Minutes between clips</span>
          <input id={`cf-gap-${fid}`} type="number" min={0} max={10080} value={f.spacing_minutes}
            onChange={(e) => set("spacing_minutes", +e.target.value)} />
        </label>
      </div>

      <label className="field"><span>Hashtags added to every post</span>
        <input id={`cf-tags-${fid}`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#finance #money" />
      </label>
      <label className="field"><span>Content rules for choosing clips (optional; empty = campaign_rules.txt)</span>
        <textarea id={`cf-rules-${fid}`} rows={3} value={f.rules} onChange={(e) => set("rules", e.target.value)}
          placeholder={"DO pick concrete money advice.\nDON'T pick moments that recommend specific stocks."} />
      </label>
      <label className="check">
        <input id={`cf-auto-${fid}`} type="checkbox" checked={!!f.autopublish} onChange={(e) => set("autopublish", e.target.checked)} />
        Publish approved clips automatically (untick to pause posting for this category)
      </label>
      <label className="check">
        <input id={`cf-llm-${fid}`} type="checkbox" checked={!!f.use_llm_captions} onChange={(e) => set("use_llm_captions", e.target.checked)} />
        Write per-platform titles and captions with the API-key LLM
      </label>

      {err && <div className="banner bad">{err}</div>}
      <div className="row-end">
        {cat && <button type="button" className="danger" onClick={del}>{confirmDel ? "Click again to delete" : "Delete category"}</button>}
        <button type="button" onClick={onDone}>Cancel</button>
        <button className="primary" type="submit">{cat ? "Save" : "Create category"}</button>
      </div>
    </form>
  );
}
