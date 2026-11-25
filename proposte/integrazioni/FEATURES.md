# Rotate: integration design for NOTAMs, CrewLink reload, crew lists and other features

Status: design proposal (25 Nov 2026). No repo files were changed. All code is in `features/` next to this file and has been syntax-checked with `node --check`. Parsers and classifiers were run against sample NOTAMs.

| File | What it is |
|---|---|
| `worker-notam.js` | Cloudflare Worker routes `/notam` and `/nas`. Deploys on its own or merges into `rotate-wx`. |
| `client-notam.js` | Briefing NOTAM section: `brNotam`, `brNotHtml`, `brNcat`, `brNdec`. |
| `crewlink-bridge.js` | Bookmarklet or userscript run on CrewLink. Copies the duty plan PDF(s) to the clipboard. |
| `client-crewlink.js` | Rotate side: "Paste from CrewLink", import through the existing PDF pipeline, crew storage. |
| `crewlink-crew.js` | Crew-list extractor template. It must be calibrated on the real page. |
| `crewlink-probe.js` | Developer probe that records the JSON endpoints and response shapes of the new CrewLink SPA. |

---

## 0. What the code and history tell us

### Current state (index.html, v1.2.7)

- **Briefing panel.** `briefRender()` (~L1971) draws the panel and `brLive()` (~L2048) fetches METAR and TAF from `WXS/wx?ids=`. The NOTAM part is only links:
  - an FAA DINS link (`notams.faa.gov/dinsQueryWeb`);
  - NAS status (`nasstatus.faa.gov`);
  - LIDO.
- **NAS status is fetched straight from the browser** (`brGet("https://nasstatus.faa.gov/api/airport-status-information")`). If FAA does not send CORS headers, this fails silently (`catch(e){}`), so the block probably never shows up in Safari. It should go through the worker.
- **Duty plan import.** `#pdf` file input → `pdfLines()` (pdf.js) → `parseLines()` (NetLine "Individual duty plan for …" layout) → `ingest()`.
  - `dpLabels()` already builds the exact report URL: `crewlink/clApp?crewlinkService=individualDutyPlan&crewlinkOperation=makeReport&buddyName=&beginDate=01Nov26&endDate=30Nov26`.
  - On iOS, `#dpGo` opens it in Safari through `x-safari-…`.
- **`FIX.parse`** points to `…/crew/service/pems/crew-clws-webui/index.html#/`. This is the new CrewLink web UI (Lufthansa Systems NetLine/Crew, the "CrewLink web services" UI: an Angular-style SPA on a JSON backend). The "Parsing" button (`#parseB`, Beta 82) only shows the toast "coming soon".
- **`privacy.html` is already out of date.** It says "The developer has no server", but the weather worker exists. Every new worker route must be added to it.

### Beta 59 automatic CrewLink import: what it was and why it went

Beta 59 is **not in git**. The history goes from Beta 57 (`25220ea`) to Beta 64 (`f9dcdd1`), and no commit contains fetch or userscript code. The design can still be rebuilt from leftovers in the translation tables `IT_E` and `IT_S` (~L2277-2278), which are still in today's file:

- "Automatic duty plan import" / "Duty plan imported by itself, then saved to Drive"
- Steps: "Tap Duty plan in the CrewLink page" → "CrewLink opens on the duty plan" → "Tap Generate Report" → "Rotate opens and imports it" → "Then tap 'Save to Drive' to update the Home Screen app"
- "Setup · Userscripts (recommended)":
  - "Install Userscripts (free app from the App Store)"
  - "Tap 'Change Userscripts Directory'…"
  - "Settings › Apps › Safari › Extensions › Userscripts: on, and allow crewlink.ita-airways.com"
  - "Save the Rotate script / Save to Files in the Userscripts folder"
- "Alternative · bookmark": "Create a Safari bookmark and paste this as its address. On the duty plan page, open it from Bookmarks"
- "The script only works on crewlink.ita-airways.com, reads the duty plan you can already see and sends it to Rotate."

So Beta 59 was a userscript (Userscripts Safari extension) or a bookmarklet that ran on CrewLink when the user tapped *Generate Report*. It read the duty plan and **opened Rotate in Safari** to hand it over. Rotate imported it and then had to **save to Google Drive** so that the **Home Screen copy of Rotate** could pick it up.

The changelog says only "automatic CrewLink import removed" and gives no reason. The leftover strings point to these likely causes:

1. **Safari and the Home Screen app have separate storage on iOS.** An import done in a Safari tab does not reach the installed PWA. The Drive round trip was a workaround.
2. **Setup was heavy.** It took about 7 steps: install the app, choose a folder, turn on the extension, allow per site, save the script.
3. **Hooking "Generate Report" was fragile.** The report opens in Safari's native PDF viewer, where no script can run.

The design below fixes all three:
- **the clipboard** carries data from Safari to the PWA;
- **the bookmarklet downloads the PDF itself** (same origin, the user's own session), so no PDF-viewer hook is needed;
- **one bookmark** is the whole setup, with Userscripts as an option.

---

## 1. NOTAMs in the briefing panel

### 1.1 Sources compared (checked Nov 2026)

| Source | Coverage | Access / terms | Fit for Rotate |
|---|---|---|---|
| **FAA NMS-API** (`api-nms.aim.faa.gov/nmsapi`, OAuth2 `client_credentials` at `/v1/auth/token`) | Domestic US, FDC, military and **international** (classification `INTERNATIONAL`, received through ICAO exchange). Queries by `location`, `classification`, `feature`, `effectiveStartDate/EndDate`. Answers in GeoJSON or AIXM 5.1. | Free US-government service, but **not self-serve**: ask NOTAMS@faa.gov for a `client_id`/`client_secret`. The legacy FAA NOTAM API (`external-api.faa.gov/notamapi/v1`) is being retired along with USNS and FNS. | **Recommended primary.** Free, authoritative for US airports, good for international ones. Secret stays in the worker. |
| **ICAO API Data Service** (`applications.icao.int/dataservices`) | Realtime NOTAMs pulled live from FAA DINS for a list of locations. Also stored NOTAMs (refreshed every 3 h) and a NOTAM decoder. | API key. **100 free calls**, then paid booster packs (2,000 calls ≈ USD 525 in the ICAO store). | Fallback only. Too expensive for routine use; with a 15-minute cache it is fine for an outage. |
| **FAA public NOTAM Search** (`notams.aim.faa.gov/notamSearch`), **DINS** (`notams.faa.gov/dinsQueryWeb`, used by Rotate today) | Worldwide | Web UIs, no API terms; scraping their undocumented POST endpoints is ToS-grey and breaks often. USNS was shut down on **18 Apr 2026** and FNS is due for retirement "later in 2026". The DINS link may stop working. | Keep only as a fallback **link**. Check the URL after the FNS retirement. |
| **EUROCONTROL EAD Basic** | Europe, best for LI** (Italy) | Free registration for individuals. Terms forbid redistribution and commercial use without written permission. Only the SWIM/B2B services are machine access, and they are restricted to operational stakeholders by agreement. | Not usable from a server. Only a deep link for the user. |
| **Notamify API** (Skymerse) | Worldwide, with AI-written summaries | Needs Notamify Pro (USD 19/month) plus API credits (1 credit per request, 5 ICAO codes per call). | Workable paid option if FAA access is refused. |
| **autorouter.aero API** | Europe-centred NOTAM and briefing for GA | Needs an account and OAuth. I could not confirm current public API terms or endpoints. Treat it as unverified and as a personal GA service. | Not recommended without written OK. |
| Aviation Edge, Jeppesen/Boeing NOTAM API, Cirium | Worldwide | Commercial contracts | Overkill for a free app. |
| **ITA Airways LIDO** | Official company briefing | Company system | Stays the **official** source. Rotate shows NOTAMs as support only (wording already in `.brf`). |

**Recommendation:**
- **FAA NMS-API through the existing Cloudflare Worker**, with the client id and secret stored as Worker **secrets**.
- Cache each airport at the edge for 15 minutes.
- Keep a KV "stale copy" so an FAA outage still shows the last good data, clearly marked.
- Optional fallback: the ICAO API key.
- Keep the LIDO link and a public-search link under the live block.

Apply for NMS-API access now. Approval is manual and can take weeks. Describe the use honestly: a free crew briefing aid, a few hundred calls a day, server-side caching.

### 1.2 How NOTAMs are shown to pilots

- **Same windows as the weather:**
  - departure airport: takeoff ±1 h;
  - arrival airport: landing ±1 h.
  - A NOTAM counts when `start < w1 && (end == null || end > w0)`.
  - Everything else that is active goes into a collapsed "Other active NOTAM (n)" `<details>`.
- **Sort order:**
  - Weight comes from the Q-code subject (letters 2-3): runway 90, ILS 85, navaid/GNSS 70, procedures 60, lighting 55, taxiway/apron 45, COM 45, ATS 40, services 35, airspace/warnings 30, obstacles 20.
  - **+100 for critical conditions** (letters 4-5 = `LC` closed, `AS` unserviceable, `AU` not available, `AW` withdrawn) on runway, ILS, navaid, procedure or lighting.
  - Closures and outages always come first and are summed up as red chips, e.g. "Runway closed", "ILS / landing aids unserviceable ×2".
  - When there is no Q-code (some FAA domestic NOTAMs), `brNq()` infers subject and condition from keywords in the text (`ILS`, `RWY`, `CLSD`, `U/S`, `OTS`…).
- **Each item shows:**
  - category, condition, a "NEW" mark if issued in the last 24 h, and the NOTAM id;
  - the E) text;
  - a plain-language line (ICAO Doc 8400 abbreviations expanded: CLSD → closed, U/S → unserviceable, WIP → work in progress…);
  - validity `25/06:00Z → 26/18:00Z EST` or `PERM`, plus the D) schedule and FL limits;
  - the full original text in a collapsed `<details>`.
- **Safety wording:**
  - footer: "Source: FAA NOTAM system via the Rotate server, updated hh:mmZ. Check the official briefing in LIDO.";
  - a stale copy is labelled with its age.
- **D) schedules** (e.g. `DAILY 0600-1800`) are shown but not evaluated. The B/C window decides, which errs toward showing more.

### 1.3 Worker `/notam` (and `/nas`): complete, ready to deploy

**What it does:**
- Answers only requests whose `Origin` is in `ALLOWED_ORIGINS` (default `https://rotate-lab.github.io`).
- Accepts at most 4 ICAO codes, each matching `^[A-Z]{4}$`.
- Caches each airport for 15 minutes, keeps an optional KV stale copy, and drops expired NOTAMs.
- Normalises every source to one compact shape: `{id, loc, q, start, end, perm, est, iss, sched, text, raw, lo, hi, fir, src}`, with times in epoch ms.
- Never sees personal data: input is airport codes only.

**Deploy:**

```bash
# standalone worker (then point brNotam/NAS at its URL instead of WXS), or merge into rotate-wx (recommended, see below)
npx wrangler deploy worker-notam.js --name rotate-notam --compatibility-date 2026-11-01
npx wrangler secret put FAA_CLIENT_ID
npx wrangler secret put FAA_CLIENT_SECRET
# optional
npx wrangler secret put ICAO_API_KEY
npx wrangler kv namespace create NOTAM_KV   # then add the binding to wrangler.toml
```

```toml
# wrangler.toml
name = "rotate-wx"
main = "worker.js"
compatibility_date = "2026-11-01"
[vars]
ALLOWED_ORIGINS = "https://rotate-lab.github.io"
[[kv_namespaces]]
binding = "NOTAM_KV"
id = "<id from wrangler kv namespace create>"
```

The existing `rotate-wx` source is not in the repo. To merge, keep its `fetch()` and add `const r = await rotateExtra(req, env, ctx); if (r) return r;` as its first line. Optionally put the worker source in the repo (`/worker`) so it is versioned with the app.

**Verify before go-live:**
- The NMS GeoJSON field names. The normaliser follows the `coreNOTAMData.notam` / `notamTranslation` structure that the FAA APIs use, with a fallback to parsing the ICAO text.
- The field names in the ICAO API sample output.

Log one real response with `wrangler tail` and adjust `normNms()` if needed.

```js
// Rotate · NOTAM + NAS routes for the Cloudflare Worker (rotate-wx)
// Routes:  GET /notam?ids=LIRF,KJFK   GET /nas   (OPTIONS preflight)
// Secrets: FAA_CLIENT_ID, FAA_CLIENT_SECRET          (wrangler secret put …)
// Optional: ICAO_API_KEY (fallback source), NOTAM_KV (KV binding, stale copy if upstream is down)
// Vars:    ALLOWED_ORIGINS="https://rotate-lab.github.io" (comma list; add http://localhost:8080 for dev)
// Privacy: receives only ICAO airport codes. No personal data, no logging of request bodies.

const NMS_TOKEN = "https://api-nms.aim.faa.gov/v1/auth/token";
const NMS_API = "https://api-nms.aim.faa.gov/nmsapi";
const ICAO_RT = "https://applications.icao.int/dataservices/api/notams-realtime-list";
const NAS_URL = "https://nasstatus.faa.gov/api/airport-status-information";
const TTL = 900;        // edge cache per airport: 15 min
const NAS_TTL = 120;    // NAS status: 2 min
const MAX_IDS = 4;      // a briefing never needs more than dep + arr (+ 2 alternates)
let TOK = null, TOK_EXP = 0; // token cached per isolate

/* ---------- CORS (only Rotate's origin) ---------- */
function origins(env) { return String(env.ALLOWED_ORIGINS || "https://rotate-lab.github.io").split(",").map(s => s.trim()).filter(Boolean); }
function corsHeaders(req, env, h = new Headers()) {
  const o = req.headers.get("Origin");
  if (o && origins(env).includes(o)) { h.set("Access-Control-Allow-Origin", o); h.set("Access-Control-Allow-Methods", "GET, OPTIONS"); h.set("Access-Control-Max-Age", "86400"); }
  h.append("Vary", "Origin");
  return h;
}
function reply(req, env, body, status = 200, type = "application/json; charset=utf-8", maxAge = 300) {
  const h = corsHeaders(req, env, new Headers({ "Content-Type": type, "Cache-Control": "private, max-age=" + maxAge, "X-Content-Type-Options": "nosniff" }));
  return new Response(typeof body == "string" ? body : JSON.stringify(body), { status, headers: h });
}
function allowed(req, env) {
  const o = req.headers.get("Origin");
  // browsers always send Origin on cross-origin fetch; requests without it (curl, other sites' servers) are refused to protect the API quota
  return !!o && origins(env).includes(o);
}

/* ---------- ICAO NOTAM text helpers ---------- */
// "2611250600" (YYMMDDhhmm) -> epoch ms
function icaoTime(s) {
  const m = String(s || "").match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
function isoTime(s) { const t = Date.parse(s || ""); return isNaN(t) ? null : t; }
// splits an ICAO-format NOTAM into its items Q) A) B) C) D) E) F) G)
function parseIcao(raw) {
  const t = String(raw || "").replace(/\r/g, "");
  const out = {};
  const re = /(?:^|\s)([QABCDEFG])\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ k: m[1], i: m.index + m[0].length, s: m.index });
  marks.forEach((x, j) => { if (!(x.k in out)) out[x.k] = t.slice(x.i, j + 1 < marks.length ? marks[j + 1].s : t.length).trim(); });
  const head = (t.match(/^\(?\s*([A-Z]\d{4}\/\d{2})/) || [])[1] || "";
  const q = (out.Q || "").split("/").map(s => s.trim());
  return {
    id: head,
    fir: q[0] || "",
    q: (q[1] || "").replace(/^Q/, ""),
    lo: q[5] && /^\d{3}$/.test(q[5]) ? +q[5] : null,
    hi: q[6] && /^\d{3}$/.test(q[6]) ? +q[6] : null,
    a: out.A || "",
    start: icaoTime(out.B),
    end: /PERM/.test(out.C || "") ? null : icaoTime(out.C),
    perm: /PERM/.test(out.C || ""),
    est: /EST/.test(out.C || ""),
    sched: out.D || "",
    text: (out.E || "").replace(/\)\s*$/, "").trim(),
    lower: out.F || "", upper: out.G || ""
  };
}
// the one shape Rotate understands, whatever the source
function mk(o) {
  return {
    id: o.id || "", loc: o.loc || "", q: String(o.q || "").toUpperCase().replace(/^Q/, "").slice(0, 4),
    start: o.start ?? null, end: o.end ?? null, perm: !!o.perm, est: !!o.est,
    iss: o.iss ?? null, sched: o.sched || "", text: String(o.text || "").trim(), raw: String(o.raw || "").trim(),
    lo: o.lo ?? null, hi: o.hi ?? null, fir: o.fir || "", src: o.src
  };
}

/* ---------- Source 1: FAA NMS-API (OAuth2 client_credentials) ---------- */
async function nmsToken(env) {
  if (TOK && Date.now() < TOK_EXP) return TOK;
  const r = await fetch(NMS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(env.FAA_CLIENT_ID + ":" + env.FAA_CLIENT_SECRET) },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("nms token " + r.status);
  const j = await r.json();
  TOK = j.access_token; TOK_EXP = Date.now() + ((+j.expires_in || 1800) - 60) * 1000;
  return TOK;
}
function normNms(f, icao) {
  const c = (f && f.properties && f.properties.coreNOTAMData) || f.coreNOTAMData || {};
  const n = c.notam || {};
  const tr = c.notamTranslation || [];
  const icaoTxt = (tr.find(t => t.type == "ICAO") || {}).formattedText || n.icaoMessage || "";
  const p = icaoTxt ? parseIcao(icaoTxt) : {};
  const endRaw = String(n.effectiveEnd || "");
  return mk({
    id: p.id || (n.series && n.number ? n.series + n.number + "/" + String(n.year || "").slice(-2) : n.number || n.id),
    loc: n.icaoLocation || n.location || icao,
    q: n.selectionCode || p.q,
    start: isoTime(n.effectiveStart) ?? p.start,
    end: /PERM/i.test(endRaw) ? null : (isoTime(endRaw.replace(/EST$/i, "")) ?? p.end),
    perm: /PERM/i.test(endRaw) || p.perm,
    est: /EST/i.test(endRaw) || p.est,
    iss: isoTime(n.issued),
    sched: n.schedule || p.sched,
    text: p.text || n.text,
    raw: icaoTxt || (tr.find(t => t.type == "LOCAL_FORMAT") || {}).formattedText || n.text,
    lo: n.minimumFL != null && n.minimumFL !== "" ? +n.minimumFL : p.lo,
    hi: n.maximumFL != null && n.maximumFL !== "" ? +n.maximumFL : p.hi,
    fir: n.affectedFIR || p.fir, src: "FAA"
  });
}
async function fromNms(icao, env) {
  const tok = await nmsToken(env);
  const r = await fetch(NMS_API + "/v1/notams?location=" + icao, { headers: { Authorization: "Bearer " + tok, Accept: "application/json", nmsResponseFormat: "GEOJSON" } });
  if (r.status == 401) { TOK = null; throw new Error("nms 401"); }
  if (!r.ok) throw new Error("nms " + r.status);
  const j = await r.json();
  const items = (j.data && (j.data.geojson || j.data.items)) || j.items || [];
  return items.map(f => normNms(f, icao));
}

/* ---------- Source 2 (optional, paid after 100 calls): ICAO API Data Service ---------- */
// field names per ICAO's "Realtime NOTAMs" sample; verify against your account's sample output before enabling
async function fromIcao(icao, env) {
  const u = ICAO_RT + "?api_key=" + encodeURIComponent(env.ICAO_API_KEY) + "&format=json&criticality=&locations=" + icao;
  const r = await fetch(u);
  if (!r.ok) throw new Error("icao " + r.status);
  const a = await r.json();
  return (Array.isArray(a) ? a : []).map(x => {
    const p = parseIcao(x.all || x.message || "");
    return mk(Object.assign({}, p, { id: p.id || x.key || x.id, loc: x.location || icao, q: x.Qcode || p.q, raw: x.all || x.message, src: "ICAO" }));
  });
}

/* ---------- per-airport fetch with edge cache + optional KV stale copy ---------- */
async function notamsFor(icao, env, ctx) {
  const cache = caches.default, ck = new Request("https://cache.rotate.invalid/notam/v1/" + icao);
  const hit = await cache.match(ck);
  if (hit) return { list: await hit.json(), cached: true };
  let list, err;
  try {
    if (env.FAA_CLIENT_ID && env.FAA_CLIENT_SECRET) list = await fromNms(icao, env);
    else if (env.ICAO_API_KEY) list = await fromIcao(icao, env);
    else throw new Error("no NOTAM source configured");
  } catch (e) {
    err = e;
    if (env.ICAO_API_KEY && env.FAA_CLIENT_ID) { try { list = await fromIcao(icao, env); err = null; } catch (e2) {} }
  }
  if (!list) {
    if (env.NOTAM_KV) { const old = await env.NOTAM_KV.get("n:" + icao, "json"); if (old) return { list: old.list, stale: old.at }; }
    throw err;
  }
  const now = Date.now();
  list = list.filter(n => n.end == null || n.end > now);          // drop expired ones
  const seen = new Set(); list = list.filter(n => { const k = n.id + n.loc; if (seen.has(k)) return false; seen.add(k); return true; });
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + TTL } })));
  if (env.NOTAM_KV) ctx.waitUntil(env.NOTAM_KV.put("n:" + icao, JSON.stringify({ at: now, list }), { expirationTtl: 86400 * 2 }));
  return { list };
}

async function handleNotam(req, env, ctx) {
  const ids = [...new Set(String(new URL(req.url).searchParams.get("ids") || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > MAX_IDS || !ids.every(s => /^[A-Z]{4}$/.test(s))) return reply(req, env, { error: "ids: 1-" + MAX_IDS + " ICAO codes" }, 400);
  const out = { ts: Date.now(), notams: [], err: {}, stale: {} };
  await Promise.all(ids.map(async id => {
    try { const r = await notamsFor(id, env, ctx); out.notams.push(...r.list); if (r.stale) out.stale[id] = r.stale; }
    catch (e) { out.err[id] = "unavailable"; console.log("notam " + id + ": " + (e && e.message)); }
  }));
  return reply(req, env, out, Object.keys(out.err).length == ids.length ? 502 : 200);
}

async function handleNas(req, env, ctx) {
  const cache = caches.default, ck = new Request("https://cache.rotate.invalid/nas/v1");
  let hit = await cache.match(ck);
  if (!hit) {
    const r = await fetch(NAS_URL, { headers: { Accept: "application/xml" } });
    if (!r.ok) return reply(req, env, { error: "nas " + r.status }, 502);
    const x = await r.text();
    ctx.waitUntil(cache.put(ck, new Response(x, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=" + NAS_TTL } })));
    return reply(req, env, x, 200, "application/xml; charset=utf-8", 60);
  }
  return reply(req, env, await hit.text(), 200, "application/xml; charset=utf-8", 60);
}

// Call this first from the existing worker's fetch(): `const r = await rotateExtra(req, env, ctx); if (r) return r;`
export async function rotateExtra(req, env, ctx) {
  const p = new URL(req.url).pathname;
  if (p != "/notam" && p != "/nas") return null;
  if (req.method == "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (req.method != "GET") return reply(req, env, { error: "method" }, 405);
  if (!allowed(req, env)) return reply(req, env, { error: "origin" }, 403);
  return p == "/notam" ? handleNotam(req, env, ctx) : handleNas(req, env, ctx);
}

// Standalone deploy (separate worker). When merging into rotate-wx, keep its fetch() and call rotateExtra() at the top.
export default {
  async fetch(req, env, ctx) {
    return (await rotateExtra(req, env, ctx)) || new Response("Not found", { status: 404 });
  }
};
```

### 1.4 Client: briefing NOTAM section (matches the existing style)

**Changes in `briefRender()`:**
- Replace the NOTAM group with the version below.
- Start the NOTAM fetch next to `brLive()`.
  - `brLive` returns early for non-US airports, before the NAS block, so do not chain the NOTAM fetch inside it.

```js
 +'</div><div class="brg"><h4>NOTAM</h4><div id="brNot"></div>'
 +(ids.length?row(tt("All NOTAM for the two airports","Tutti i NOTAM dei due aeroporti"),ids.join(" · ")+" · "+tt("FAA search","ricerca FAA"),"https://www.notams.faa.gov/dinsQueryWeb/queryRetrievalMapAction.do?reportType=Raw&retrieveLocId="+ids.join("+")+"&actionType=notamRetrievalByICAOs",icN):"")
 +row("National Airspace System Status",…)+'<div id="brNas"></div>'
 +row(tt("Company briefing (LIDO)",…))
…
 $("#brX").onclick=briefClose;brLive(f,d0,a0,ia,ib);brNotam(f,d0,a0,ia,ib);
```

**NAS through the worker:** in `brLive` replace `brGet("https://nasstatus.faa.gov/api/airport-status-information",true)` with `brGet(WXS+"/nas",true)`.

**New code** (put it after `brLive`; it uses `brGet`, `esc`, `tt`, `brZ`, `brD`, `brDZ`, `cityN`, `WXS`):

```js
/* NOTAM (Rotate server → FAA NMS): those valid inside the takeoff / landing window first, closures and outages on top */
// [Q-code subject (letters 2-3), key, EN, IT, weight]  ICAO Doc 8126 / PANS-ABC Q-code subjects
const BRNQ=[[/^MR/,"rwy","Runway","Pista",90],[/^I[CDGILMOSTUWXY]/,"ils","ILS / landing aids","ILS / assistenze all'atterraggio",85],[/^(N[ABDLMNTVX]|G[AW])/,"nav","Navaids / GNSS","Radioassistenze / GNSS",70],[/^P[ADHIKLMNOPRTUX]/,"pro","Procedures","Procedure",60],[/^L/,"lgt","Lighting","Luci",55],[/^(MX|MA|MN|MS|MT|MU|MW|MY|MK|MD|MB|MC|MG|MH|MM|MO|MP)/,"twy","Taxiway / apron","Taxiway / piazzale",45],[/^C/,"com","COM / radar","COM / radar",45],[/^S/,"ats","ATS / ATIS","Servizi ATS / ATIS",40],[/^F/,"fac","Aerodrome services","Servizi aeroportuali",35],[/^(A|R|W)/,"asp","Airspace / warnings","Spazio aereo / avvisi",30],[/^O/,"obs","Obstacles","Ostacoli",20]];
const BRNC={LC:["Closed","Chiuso"],AS:["Unserviceable","Fuori servizio"],AU:["Not available","Non disponibile"],AW:["Withdrawn","Ritirato"],LT:["Limited","Limitato"],CH:["Changed","Modificato"],AH:["Hours changed","Orari modificati"]};
// FAA domestic NOTAMs may lack a Q-code: guess subject and condition from the text keywords
function brNq(t){t=" "+String(t||"").toUpperCase()+" ";const s=/\b(ILS|LOC|LLZ|GP|GS)\b/.test(t)?"IC":/\bRWY\b/.test(t)&&!/\bTWY\b/.test(t)?"MR":/\b(VOR|DME|NDB|TACAN|VORTAC|GPS|GNSS)\b/.test(t)?"NA":/\b(IAP|SID|STAR|RNAV|RNP)\b/.test(t)?"PI":/\b(TWY|APRON|RAMP)\b/.test(t)?"MX":/\b(PAPI|ALS|LGT|LIGHTS?)\b/.test(t)?"LX":/\b(OBST|CRANE|TOWER)\b/.test(t)?"OB":"";
 const c=/\bCLSD\b/.test(t)?"LC":/\b(U\/S|UNSERVICEABLE|OTS)\b/.test(t)?"AS":/\bUNAVBL\b/.test(t)?"AU":"XX";return s?s+c:""}
function brNcat(q,txt){q=String(q||"").toUpperCase().replace(/^Q/,"");if(!/^[A-Z]{4}$/.test(q)||q.startsWith("XX"))q=brNq(txt)||q;const s=q.slice(0,2),c=q.slice(2,4),R=BRNQ.find(x=>x[0].test(s)),cl=BRNC[c];
 const k=R?R[1]:"oth",crit=!!cl&&/^(LC|AS|AU|AW)$/.test(c)&&/^(rwy|ils|nav|pro|lgt)$/.test(k);
 return{k,l:R?tt(R[2],R[3]):tt("Other","Altro"),w:(R?R[4]:10)+(crit?100:cl&&c=="LT"?20:0),crit,cl:cl?tt(cl[0],cl[1]):""}}
// small plain-language aid, ICAO Doc 8400 abbreviations (the raw text always stays visible)
const BRNA={CLSD:"closed","U/S":"unserviceable",AVBL:"available",UNAVBL:"unavailable",WIP:"work in progress",RWY:"runway",TWY:"taxiway",THR:"threshold",DTHR:"displaced threshold",APCH:"approach",DEP:"departure",ARR:"arrival",RTE:"route",ACFT:"aircraft",OPR:"operating",OPS:"operations",EXC:"except",BTN:"between",MAINT:"maintenance",LGT:"lights",ALS:"approach lighting",PAPI:"PAPI",SFC:"surface",AGL:"above ground",AMSL:"above MSL",ELEV:"elevation",OBST:"obstacle",TEMPO:"temporarily",FLW:"following",INFO:"information",REF:"reference",DLY:"daily",SR:"sunrise",SS:"sunset",HR:"hours",TIL:"until",ACT:"active",SER:"service",FREQ:"frequency",PROC:"procedure",GP:"glide path",LLZ:"localizer",CAT:"category",TORA:"TORA",LDA:"LDA",ASDA:"ASDA",TODA:"TODA",PPR:"prior permission required",RESTR:"restricted",PSN:"position",NML:"normal",CTN:"caution"};
function brNdec(t){return String(t||"").replace(/[A-Z/]{2,}/g,w=>BRNA[w]||w)}
const brFL=n=>String(n).padStart(3,"0");
function brNotHtml(iata,ap,dep,w0,w1,L,err,stale){
 const now=Date.now(),inW=n=>n.start!=null&&n.start<w1&&(n.end==null||n.end>w0);
 const A=L.map(n=>Object.assign({},n,{c:brNcat(n.q,n.text)})).sort((a,b)=>b.c.w-a.c.w||(a.start||0)-(b.start||0)),hit=A.filter(inW),oth=A.filter(n=>!inW(n));
 const item=n=>{const dec=brNdec(n.text);return'<div class="bnt'+(n.c.crit?" crit":"")+'"><div class="bnth"><span class="bntc">'+esc(n.c.l)+'</span>'+(n.c.cl?'<span class="'+(n.c.crit?"brz":"bntk")+'">'+esc(n.c.cl)+'</span>':"")
  +(n.iss&&now-n.iss<864e5?'<span class="bntn">'+tt("NEW","NUOVO")+'</span>':"")+'<small>'+esc(n.id)+'</small></div>'
  +'<div class="bntx">'+esc(n.text||n.raw)+'</div>'
  +(dec!=n.text?'<div class="bntd">'+esc(dec)+'</div>':"")
  +'<small class="bntv">'+(n.start!=null?brDZ(n.start):"?")+' → '+(n.end==null?(n.perm?"PERM":"?"):brDZ(n.end)+(n.est?" EST":""))
  +(n.sched?' · '+esc(n.sched):"")+(n.lo!=null&&n.hi!=null&&!(n.lo==0&&n.hi==999)?' · FL'+brFL(n.lo)+'–'+brFL(n.hi):"")+'</small>'
  +(n.raw?'<details class="bntr"><summary>'+tt("Original text","Testo originale")+'</summary><pre>'+esc(n.raw)+'</pre></details>':"")+'</div>'};
 const crit=hit.filter(n=>n.c.crit),sum={};crit.forEach(n=>{const k=n.c.l+" "+n.c.cl.toLowerCase();sum[k]=(sum[k]||0)+1});
 let h='<div class="brd'+(crit.length?" warn":"")+'"><div class="brdr"><span class="brrole">'+(dep?tt("TAKEOFF","DECOLLO"):tt("LANDING","ATTERRAGGIO"))+'</span><span class="brin">'+hit.length+' / '+A.length+' NOTAM</span></div>'
  +'<div class="brdh"><b>'+esc(ap)+'</b><span>'+esc(cityN(iata))+'</span></div>'
  +'<div class="brwin"><span>'+tt("Valid in window","Validi nella finestra")+'</span><b>'+brD(w0)+' '+brZ(w0)+' – '+brZ(w1)+'</b></div>';
 if(err&&!A.length)return h+'<p class="brnc">'+tt("NOTAM not available right now","NOTAM non disponibili adesso")+'</p></div>';
 if(stale)h+='<p class="brnc">'+tt("Server copy from ","Copia del server delle ")+brZ(stale)+' — '+tt("the NOTAM source is not answering","la fonte NOTAM non risponde")+'</p>';
 if(Object.keys(sum).length)h+='<div class="brsum">'+Object.entries(sum).map(([k,v])=>'<span class="brz">'+esc(k)+(v>1?" ×"+v:"")+'</span>').join("")+'</div>';
 h+=hit.length?hit.map(item).join(""):'<p class="brn">'+tt("No NOTAM valid in the window.","Nessun NOTAM valido nella finestra.")+'</p>';
 if(oth.length)h+='<details><summary>'+tt("Other active NOTAM","Altri NOTAM attivi")+' ('+oth.length+')</summary>'+oth.map(item).join("")+'</details>';
 return h+'</div>'}
async function brNotam(f,d0,a0,ia,ib){const box=$("#brNot");if(!box||!WXS)return;const W=[[f.from,ia,1,d0],[f.to,ib,0,a0]].filter(x=>x[1]);if(!W.length)return;
 box.innerHTML='<p class="brn">'+tt("Loading NOTAM…","Carico i NOTAM…")+'</p>';
 try{const j=await brGet(WXS+"/notam?ids="+[...new Set(W.map(x=>x[1]))].join(","));if(!document.body.contains(box))return;
  box.innerHTML=W.map(([iata,ap,dep,t])=>brNotHtml(iata,ap,dep,t-36e5,t+36e5,(j.notams||[]).filter(n=>n.loc==ap),(j.err||{})[ap],(j.stale||{})[ap])).join("")
   +'<p class="brn">'+tt("Source: FAA NOTAM system via the Rotate server, updated ","Fonte: sistema NOTAM FAA tramite il server di Rotate, aggiornato ")+brZ(j.ts||Date.now())+'. '+tt("Check the official briefing in LIDO.","Verifica il briefing ufficiale in LIDO.")+'</p>'}
 catch(e){if(document.body.contains(box))box.innerHTML='<p class="brn">'+tt("NOTAM not available right now: use the links below.","NOTAM non disponibili adesso: usa i link qui sotto.")+'</p>'}}
```

**CSS** (add next to the `.brd` rules, ~L395-408):

```css
.bnt{padding:8px 10px;border-radius:10px;background:rgba(31,91,214,.06);margin-top:6px}.bnt.crit{background:rgba(255,69,58,.10);box-shadow:inset 3px 0 0 #ff453a}
.bnth{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:3px}.bnth small{margin-left:auto;color:var(--tx2);font-variant-numeric:tabular-nums}
.bntc{font:700 11px var(--fb);letter-spacing:.04em;text-transform:uppercase;color:var(--ac)}.bntk{font:600 11px var(--fb);padding:2px 7px;border-radius:99px;background:var(--sep)}
.bntn{font:700 10px var(--fb);padding:2px 6px;border-radius:99px;background:#ffd60a;color:#000}
.bntx{font:13px/1.45 ui-monospace,Menlo,monospace;word-break:break-word}.bntd{font-size:12.5px;color:var(--tx2);margin-top:2px}
.bntv{display:block;font-size:11.5px;color:var(--tx2);margin-top:4px}.bntr pre{white-space:pre-wrap;font-size:11.5px;margin:4px 0 0}
```

The `sw.js` fetch handler already sends worker calls straight to the network (never cached), so it needs no change.

**Effort:**

| Task | Time |
|---|---|
| Worker | 0.5 day |
| Client | 0.5-1 day |
| Waiting for FAA credentials | weeks, outside our control |
| Field-name calibration with real data | 0.5 day |
| Privacy page | 15 min |

**Risks:**
- *Operational:* NOTAMs are safety-critical. The UI must keep "support only, check LIDO" and show the data age. Never hide NOTAMs: anything filtered out stays one tap away under "Other active".
- *Coverage:* FAA international data is what other states send through ICAO. Spot-check LIRF and LIMC against LIDO and EAD for a week before shipping.
- *ToS:* NMS-API credentials belong to the app owner. Do not pass them to the client. Respect FAA rate guidance, which the 15-minute cache does.
- *Abuse:* the Origin check plus the 4-code limit protects the quota. Add a Cloudflare rate-limiting rule (e.g. 60 requests/min per IP on `/notam`) if needed.

---

## 2. "Duty plan reload": refresh the roster from CrewLink

### 2.1 Constraints that rule options in or out

- CrewLink is an **authenticated company portal** (NetLine/Crew by Lufthansa Systems) behind ITA Airways SSO. There is **no public API**; Lufthansa Systems publishes none for CrewLink. Its responses carry no CORS headers for third-party origins, so **Rotate cannot fetch from it directly**, and the session cookies belong to CrewLink's origin anyway.
- On iOS, **Safari and the Home Screen PWA have separate storage**. This is what sank Beta 59.
- **Web Share Target is still not supported by Safari on iOS**:
  - caniuse lists iOS Safari 3.2-26.5 as unsupported;
  - WebKit bug 194593 is still open.
  - A manifest `share_target` only helps Android users, who can share the PDF straight into Rotate. That is cheap to add, but it does not help the iPhone fleet.
- A static PWA cannot receive pushes about roster changes without a server that knows the roster.

### 2.2 Options

| Option | How | Verdict |
|---|---|---|
| **A. Bookmarklet + clipboard** (recommended) | User opens CrewLink in Safari (already logged in through SSO) and taps the *Rotate ⟳* bookmark. The script, **in CrewLink's own origin and session**, fetches the same `makeReport` PDF(s) Rotate links to today: current and next month, plus the previous month in the first week (actual block times). It puts them on the clipboard as `ROTATE1 {json}` with base64 PDFs, ~150-400 KB. Back in the PWA, a "Paste from CrewLink" bar appears; one tap, then iOS "Paste", runs the **existing** `pdfLines → parseLines → ingest` pipeline. | No server, no stored credentials, same document as the manual flow. Setup = one bookmark. Survives Safari/PWA storage isolation. About 4 taps instead of download, Save to Files, import. |
| **A′. Userscripts extension** (same code) | The same script as a userscript (`@match https://crewlink.ita-airways.com/*`) adds a floating "Send to Rotate" button on every CrewLink page. | Smoother daily use (no Bookmarks menu) and immune to page CSP, since the extension runs as a content script. Heavier setup, which is what Beta 59 offered. Ship as "advanced". |
| **B. iOS Shortcut** ("Run JavaScript on Web Page" from Safari's share sheet) | The Shortcut runs the same fetch-and-base64 JS on the CrewLink page and returns it through `completion()`. Then "Copy to Clipboard" and "Show Notification: open Rotate". It could also "Save File" to iCloud Drive/Rotate as an archive. | Works and appears in the share sheet. Needs "Allow Running Scripts". Distributed as an iCloud link that the owner has to maintain. Good second path for users who dislike bookmarklets. Shortcuts **cannot** fetch CrewLink itself: "Get Contents of URL" has no SSO cookies. |
| **C. Encrypted drop box on the worker** (phase 2, optional) | Rotate generates a random channel id and an AES-GCM key and embeds them in a **personal** bookmarklet. The bookmarklet encrypts the payload and POSTs it to `WXS/drop/<channel>` (KV, 10-minute TTL). The PWA fetches it on `visibilitychange`, decrypts and deletes it. | Removes the paste tap. The worker only ever holds ciphertext, but it is still a personal-data transfer, so it needs a privacy-policy update and DPIA notes. **May be blocked by CrewLink's CSP** (`connect-src`). Test first. A userscript using `GM.xmlHttpRequest` avoids that. |
| **D. Worker logs into CrewLink with the pilot's credentials** | Store username and password (and an MFA seed?) in the worker; cron fetches the roster and pushes it. | **No.** It breaks company acceptable-use and credential-sharing rules and probably the SSO terms, and it means getting round MFA. It makes the worker a honeypot holding every user's airline credentials. Cloudflare IPs logging in as many crew trigger SSO risk alerts and account lockouts. Rotate would become the GDPR controller of rosters for every user. Lufthansa Systems / ITA could reasonably ask for the app to be taken down. |
| **E. Call the new CrewLink web-UI JSON API from the bookmarklet** | Once the probe (`crewlink-probe.js`) shows the SPA's endpoints (roster, crew lists), the bookmarklet calls them same-origin with the SPA's own token, which lives in that page's storage. That gives structured JSON instead of a PDF. | Best long-term data quality, and needed for crew lists. Undocumented and may change. Start with the PDF route (A), which works today because Rotate already parses that PDF. |

### 2.3 Implementation plan (A, with A′ and B on the same payload)

**1. New Duty plan tab "Reload".** It replaces the hint text in `#dpI` and wires up the `#parseB` button, which says "Parsing: coming soon" today.

- Button **"Reload from CrewLink"**:
  - `clbStart()` (remember that we are waiting);
  - then the existing `#dpGo` iOS logic opens `crewlink/clApp?crewlinkService=individualDutyPlan&crewlinkOperation=default` in Safari.
- Button **"Paste from CrewLink"**, always visible. The floating `#clbBar` also appears on return for 20 minutes.
- **Setup card**, reusing the Beta 59 strings already present in `IT_E`/`IT_S`:
  - "Copy the bookmark code";
  - "Create a Safari bookmark and paste this as its address…";
  - Userscripts steps as "Advanced";
  - "The script only works on crewlink.ita-airways.com, reads the duty plan you can already see and sends it to Rotate…".
  - The bookmark code is `"javascript:"+encodeURIComponent(src)` of `crewlink-bridge.js` (about 4.5 KB; Safari handles that).
  - iOS gotcha: you can't add a `javascript:` bookmark directly. Bookmark any page, then *Edit* it and paste the code into the address field.

**2. Bridge script** (runs inside CrewLink; works as both bookmarklet and userscript body):

```js
// Rotate · CrewLink bridge. Runs INSIDE crewlink.ita-airways.com (bookmarklet or Userscripts), in the pilot's own logged-in session.
// Reads only the pilot's own Individual duty plan PDF(s) (the same file as the manual flow) and puts them on the clipboard for Rotate.
(()=>{const H="crewlink.ita-airways.com";if(location.hostname!=H){alert("Rotate: open CrewLink ("+H+"), log in, then tap the bookmark again.");return}
const M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],p2=n=>String(n).padStart(2,"0"),cl=d=>p2(d.getDate())+M[d.getMonth()]+String(d.getFullYear()).slice(2);
const t=new Date(),mo=(t.getDate()<=7?[-1]:[]).concat([0,1]);/* previous month too in the first week: actual block times for the logbook */
const per=mo.map(i=>[new Date(t.getFullYear(),t.getMonth()+i,1),new Date(t.getFullYear(),t.getMonth()+i+1,0)]);
const url=([a,b])=>"/crewlink/clApp?"+new URLSearchParams({crewlinkService:"individualDutyPlan",crewlinkOperation:"makeReport",buddyName:"",beginDate:cl(a),endDate:cl(b)});
const isPdf=b=>b.byteLength>4&&new TextDecoder().decode(new Uint8Array(b,0,5))=="%PDF-";
async function pdf(u){const r=await fetch(u,{credentials:"include"});if(!r.ok)throw new Error("HTTP "+r.status);let b=await r.arrayBuffer();
 if(!isPdf(b)){const d=new DOMParser().parseFromString(new TextDecoder().decode(b),"text/html"),e=d.querySelector("embed[src],iframe[src],object[data],a[href*='.pdf'],a[href*='makeReport']"),s=e&&(e.getAttribute("src")||e.getAttribute("data")||e.getAttribute("href"));
  if(!s)throw new Error(d.querySelector("input[type=password]")||/log ?in|sign ?in|password/i.test(d.body?d.body.textContent:"")?"login":"no PDF");
  const r2=await fetch(new URL(s,r.url),{credentials:"include"});b=await r2.arrayBuffer();if(!isPdf(b))throw new Error("no PDF")}
 return b}
const b64=b=>{let s="";const u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)};
const job=(async()=>{const files=[];for(const p of per)files.push({n:cl(p[0])+"-"+cl(p[1])+".pdf",b64:b64(await pdf(url(p)))});return"ROTATE1 "+JSON.stringify({v:1,t:"dp",at:Date.now(),files})})();
const o=document.createElement("div");o.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#0b1220;color:#fff;font:15px/1.35 -apple-system,system-ui,sans-serif;padding:14px 16px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)";o.textContent="Rotate: reading your duty plan…";document.body.appendChild(o);
const done=(ok,m)=>{o.textContent=m;o.style.background=ok?"#0a7d3b":"#b3261e";setTimeout(()=>o.remove(),ok?7000:10000)};
const fail=e=>done(0,"Rotate: "+(e&&e.message=="login"?"log in to CrewLink first, then tap the bookmark again.":"could not read the duty plan ("+(e&&e.message||e)+")."));
const okMsg="✓ Copied for Rotate. Open Rotate › Duty plan › “Paste from CrewLink”.";
const button=s=>{o.textContent="";const b=document.createElement("button");b.textContent="Copy for Rotate";b.style.cssText="font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:0;background:#1a73e8;color:#fff";b.onclick=()=>navigator.clipboard.writeText(s).then(()=>done(1,okMsg),fail);o.appendChild(b)};
/* Safari: clipboard.write() must start inside the tap; a ClipboardItem may hold a Promise that resolves after the downloads */
try{navigator.clipboard.write([new ClipboardItem({"text/plain":job.then(s=>new Blob([s],{type:"text/plain"}))})]).then(()=>done(1,okMsg),()=>job.then(button,fail))}catch(e){job.then(button,fail)}
})();
```

Key points:
- `ClipboardItem` takes a **Promise**, so the clipboard write starts inside the user's tap and finishes after the downloads. Safari requires this; a plain `writeText` after `await fetch` is refused.
- If that fails, the overlay turns into a "Copy for Rotate" button, which gives a fresh gesture.
- If `makeReport` returns an HTML wrapper instead of the PDF, the script follows the embedded `embed/iframe/a` link.
- If it finds a login form, it tells the user to log in. It never sees or handles credentials.

**Userscript header** for A′ (body = the same function, run from a floating button's `onclick`):

```js
// ==UserScript==
// @name        Rotate · CrewLink bridge
// @match       https://crewlink.ita-airways.com/*
// @grant       none
// @inject-into content
// @run-at      document-idle
// ==/UserScript==
```

**3. iOS Shortcut (B).** Build it once and share it as an iCloud link from the Rotate setup card:
1. Shortcut settings: *Show in Share Sheet*, input type *Safari web pages*.
2. Action **Run JavaScript on Web Page**. Use the body of `crewlink-bridge.js`, but replace the overlay and clipboard part with `job.then(s=>completion(s),e=>completion("ERR "+e.message))`.
3. **If** the result begins with `ERR` → **Show Alert**. **Otherwise** → **Copy to Clipboard** → **Show Notification** "Duty plan ready, open Rotate and tap Paste from CrewLink".
4. *Settings › Apps › Shortcuts › Advanced › Allow Running Scripts* must be on.

**4. Rotate side.** Add after the `#pdf` change handler. It reuses `pdfLines`, `parseLines`, `ingest`, `toast`, `tt`, `save`, `syncDirty`.

```js
/* ===== Reload from CrewLink: clipboard bridge (Safari tab → Home Screen app, which have separate storage on iOS) ===== */
const CLB="ROTATE1 ",CLB_MAX=6e6;
async function clbImport(s){s=String(s||"").trim();if(!s.startsWith(CLB)||s.length>CLB_MAX)return 0;let P;try{P=JSON.parse(s.slice(CLB.length))}catch(e){return 0}
 if(!P||P.v!==1)return 0;
 if(P.t=="dp"){let ok=0,dd=0;const fs=(Array.isArray(P.files)?P.files:[]).slice(0,4);
  for(const f of fs){try{const u=Uint8Array.from(atob(String(f.b64||"")),c=>c.charCodeAt(0)),ls=await pdfLines(u.buffer),n=ingest(parseLines(ls),String(f.n||"CrewLink.pdf"),ls);if(n){ok++;dd+=n}}catch(e){}}
  if(ok){toast(tt("Duty plan reloaded","Duty plan ricaricato"),ok+"/"+fs.length+" PDF · "+dd+" "+tt("days","giorni"));if(typeof syncDirty=="function")syncDirty()}return ok}
 if(P.t=="crew")return crewIngest(P);
 return 0}
async function clbPaste(){let s="";try{s=await navigator.clipboard.readText()}catch(e){toast(tt("Paste not allowed","Incolla non consentito"),tt("Tap “Paste” in the bubble that appears","Tocca “Incolla” nel fumetto che compare"));return}
 const n=await clbImport(s);if(!n){toast(tt("Nothing from CrewLink in the clipboard","Negli appunti non c'è niente da CrewLink"),tt("Run the Rotate bookmark on CrewLink first","Prima usa il segnalibro Rotate su CrewLink"));return}
 try{await navigator.clipboard.writeText(" ")}catch(e){} /* do not leave roster / crew data on the clipboard */
 try{localStorage.removeItem("rot_clw")}catch(e){}clbBar()}
function clbStart(){try{localStorage.setItem("rot_clw",String(Date.now()))}catch(e){}}  // call when "Reload from CrewLink" opens Safari
function clbBar(){let w=0;try{w=+localStorage.getItem("rot_clw")||0}catch(e){}const on=w&&Date.now()-w<20*6e4;let b=document.getElementById("clbBar");
 if(!on){if(b)b.remove();return}
 if(!b){b=document.createElement("div");b.id="clbBar";b.className="clbb";b.innerHTML='<span>'+tt("Back from CrewLink?","Di ritorno da CrewLink?")+'</span><button type="button" id="clbP">'+tt("Paste from CrewLink","Incolla da CrewLink")+'</button><button type="button" id="clbX" aria-label="Close">×</button>';document.body.appendChild(b);
  $("#clbP").onclick=clbPaste;$("#clbX").onclick=()=>{try{localStorage.removeItem("rot_clw")}catch(e){}clbBar()}}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)clbBar()});

/* ===== Crew per flight (opt-in, local only, purged 30 days after the flight) ===== */
const CREW_KEEP=30*864e5;
function crewOn(){try{return localStorage.getItem("rot_crew")=="1"}catch(e){return false}}
function crewIngest(P){if(!crewOn()){toast(tt("Crew lists are off","Liste equipaggio disattivate"),tt("Turn them on in Settings › Rotate App","Attivale in Impostazioni › Rotate App"));return 0}
 let n=0;(Array.isArray(P.items)?P.items:[]).forEach(it=>{const D=days[it.d];if(!D)return;const fn=String(it.fn||"").replace(/\s+/g,"").toUpperCase();
  const f=(D.ev||[]).find(e=>e.t=="fl"&&e.fn.replace(/\s+/g,"").toUpperCase()==fn);if(!f)return;
  f.crew=(Array.isArray(it.crew)?it.crew:[]).slice(0,24).map(c=>({r:String(c.r||"").slice(0,6),n:String(c.n||"").slice(0,48)})).filter(c=>c.n);f.crewAt=Date.now();n++});
 if(n){save();toast(tt("Crew list saved","Lista equipaggio salvata"),n+" "+tt("flights","voli"))}return n}
function crewPurge(){const lim=Date.now()-CREW_KEEP;let ch=0;Object.keys(days).forEach(k=>{if(new Date(k+"T00:00:00Z").getTime()>=lim)return;(days[k].ev||[]).forEach(e=>{if(e.crew){delete e.crew;delete e.crewAt;ch=1}})});if(ch)save()}
// briefing / day detail: '<div class="brg"><h4>'+tt("Crew","Equipaggio")+'</h4>'+crewHtml(f)+'</div>'
function crewHtml(f){if(!f||!f.crew||!f.crew.length)return"";return'<div class="brd">'+f.crew.map(c=>'<div class="brdp"><b>'+esc(c.r)+'</b><span>'+esc(c.n)+'</span></div>').join("")+'<small class="brdt">'+tt("From CrewLink, ","Da CrewLink, ")+fmtAt(f.crewAt)+'</small></div>'}
```

```css
.clbb{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:60;display:flex;gap:10px;align-items:center;background:var(--card);box-shadow:var(--sh);border-radius:14px;padding:10px 12px}
.clbb span{flex:1;font-size:14px}.clbb #clbP{border:0;border-radius:10px;padding:9px 14px;background:var(--blue);color:#fff;font:600 14px var(--fb)}.clbb #clbX{border:0;background:none;font-size:22px;color:var(--tx2)}
```

**5. Roster-change awareness** (local, no server): in `ingest()`, before `Object.assign(days,res.days)`, diff each incoming day with the existing one (flights, check-in, standby). Show "3 days changed: 27 Nov AZ608 → AZ610, …" in the toast or in a sheet. This is the realistic "notification for roster changes": you see it every time you reload.

**Effort:**

| Task | Time |
|---|---|
| Bridge + Rotate paste + setup UI | 1.5-2 days |
| Shortcut | 0.5 day |
| Diff | 0.5-1 day |
| Encrypted drop (C) | 1-1.5 days, optional |

Testing must be done by a crew member on a real CrewLink account. Nobody outside the company can reach it, and it was not reachable from this research environment.

**Risks:**
- *ToS and IT policy.* This is user-initiated, in the user's own session, and fetches the same document the user can already download by hand. It is functionally the same as Save to Files and far lower risk than any server-side access. Still:
  - CrewLink's terms and ITA IT policy may ban scripts or automation. Ask ITA (crew IT / DPO) before promoting it widely.
  - Keep a kill switch: a constant in index.html that hides the feature.
- *CSP.* A strict `script-src` on CrewLink may block bookmarklets in Safari. Then fall back to Userscripts or the Shortcut, which are both immune.
- *Clipboard privacy.* Universal Clipboard can sync the roster to the user's own Mac. Rotate overwrites the clipboard after import. Never log the payload.
- *Robustness.* If ITA retires the legacy `clApp` and keeps only the new web UI, `makeReport` disappears. Then use option E with the probe output.

---

## 3. "Show crew": who flies each sector

### 3.1 Data source
- The NetLine duty-plan PDF that Rotate parses today has no crew names.
- CrewLink shows crew per duty either in the legacy `clApp` (a crew-list page per duty or flight) or in the new web UI (`crew-clws-webui`).
- The exact page and endpoint must be found on a real account:
  - run `crewlink-probe.js` on the new web UI;
  - or use Safari Web Inspector (Mac › Develop › iPhone) and open a crew list.

The probe records only endpoint URLs and the **shape** of the JSON (keys and types, never values), so it can be shared with the developer safely.

### 3.2 Approach
- **Same clipboard bridge, new payload** `{"v":1,"t":"crew","items":[{"d":"2026-11-27","fn":"AZ 608","crew":[{"r":"CP","n":"ROSSI Mario"}]}]}`.
- **Legacy HTML page:** use the template extractor below. Calibrate `RANK` and the name regex on the real table.
- **New web UI:** after the probe, write a bridge that calls the crew endpoint for the visible duties.
- **In Rotate:**
  - `crewIngest()` attaches `crew` to the matching flight (date + flight number);
  - show it in the briefing panel and the day detail (`crewHtml(f)`);
  - optional: prefill pilot names in the In-flight rest planner and its PDF.

```js
/* Rotate · crew list bridge (TEMPLATE: calibrate SEL/RANK against the real CrewLink crew-list page before shipping).
   Run on the CrewLink page that shows the crew of one or more duties. Copies ONLY rank + name per flight. */
(()=>{if(location.hostname!="crewlink.ita-airways.com"){alert("Rotate: open the crew list in CrewLink first.");return}
const RANK=/^(CMD|CPT|CP|FO|SFO|SO|FE|RP|CSD|PU|PS|CC|CA|FA|AV|AS|ASS|SP|CM\d|INS|TRI|TRE|LTC)$/i;
const MON={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12},p2=n=>String(n).padStart(2,"0");
const docs=[document].concat([...document.querySelectorAll("iframe,frame")].map(f=>{try{return f.contentDocument}catch(e){return null}}).filter(Boolean));
const items=[];
docs.forEach(d=>d.querySelectorAll("table").forEach(tb=>{
 /* flight + date: nearest preceding text like "AZ 608 27Nov26" (legacy CrewLink) or "AZ608 · 2026-11-27" */
 let ctx="",el=tb;for(let i=0;i<6&&el&&!/\b[A-Z]{2}\s?\d{1,4}\b/.test(ctx);i++){el=el.previousElementSibling||el.parentElement;ctx=(el&&el.textContent||"")+" "+ctx}
 ctx+=" "+(tb.querySelector("caption,thead")||{textContent:""}).textContent;
 const fm=ctx.match(/\b(AZ|ITY|DH\/AZ)\s?(\d{1,4})\b/),dm=ctx.match(/\b(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\b/)||ctx.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
 if(!fm||!dm)return;
 const d=dm[2]in MON?"20"+dm[3]+"-"+p2(MON[dm[2]])+"-"+dm[1]:dm[1]+"-"+dm[2]+"-"+dm[3];
 const crew=[];tb.querySelectorAll("tr").forEach(tr=>{const c=[...tr.cells].map(x=>x.textContent.replace(/\s+/g," ").trim());const ri=c.findIndex(x=>RANK.test(x));if(ri<0)return;
  const nm=c.find((x,i)=>i!=ri&&/^[A-ZÀ-Ý' -]{2,}(,|\s)\s*[A-Za-zÀ-ÿ' -]{2,}$/.test(x)&&!/\d/.test(x));if(nm)crew.push({r:c[ri].toUpperCase(),n:nm.replace(/\s*,\s*/," ")})});
 if(crew.length)items.push({d,fn:fm[1].replace("DH/","")+" "+fm[2],crew})}));
if(!items.length){alert("Rotate: no crew list recognised on this page.");return}
const s="ROTATE1 "+JSON.stringify({v:1,t:"crew",at:Date.now(),items});
navigator.clipboard.writeText(s).then(()=>alert("Rotate: crew of "+items.length+" flight(s) copied. Open Rotate › “Paste from CrewLink”."),()=>prompt("Copy this, then paste in Rotate:",s));
})();
```

Developer probe (new web UI):

```js
/* Rotate · CrewLink endpoint probe (developer only, run once on the NEW web UI .../crew-clws-webui/index.html#/).
   Records which JSON endpoints the SPA calls and the SHAPE of the answers (keys and types, never values),
   so the bridge can later call the same endpoints. Navigate to Roster / Crew list after running it, then tap it again to copy the report. */
(()=>{const W=window;if(W.__rotProbe){navigator.clipboard.writeText(JSON.stringify(W.__rotProbe,null,1)).then(()=>alert("Rotate probe: "+W.__rotProbe.length+" calls copied"));return}
const log=W.__rotProbe=[];
const shape=(v,d)=>d>3?typeof v:Array.isArray(v)?[v.length?shape(v[0],d+1):"empty"]:v&&typeof v=="object"?Object.fromEntries(Object.keys(v).slice(0,40).map(k=>[k,shape(v[k],d+1)])):typeof v;
const rec=(m,u,st,txt,hdr)=>{let j=null;try{j=shape(JSON.parse(txt),0)}catch(e){}log.push({m,u:String(u).replace(/([?&](?:token|access_token|code)=)[^&]+/gi,"$1…"),st,auth:!!hdr,shape:j})};
const F=W.fetch;W.fetch=async(i,o)=>{const r=await F(i,o);try{const c=r.clone();c.text().then(t=>rec((o&&o.method)||"GET",typeof i=="string"?i:i.url,r.status,t,o&&o.headers&&(o.headers.Authorization||o.headers.authorization||(o.headers.get&&o.headers.get("Authorization")))))}catch(e){}return r};
const X=W.XMLHttpRequest.prototype,op=X.open,sh=X.setRequestHeader,se=X.send;
X.open=function(m,u){this.__r={m,u};return op.apply(this,arguments)};X.setRequestHeader=function(k,v){if(/^authorization$/i.test(k))this.__a=1;return sh.apply(this,arguments)};
X.send=function(){this.addEventListener("load",()=>rec(this.__r.m,this.__r.u,this.status,this.responseText,this.__a));return se.apply(this,arguments)};
alert("Rotate probe on. Open your roster and a crew list, then tap the bookmark again.")})();
```

### 3.3 Privacy (GDPR): colleagues' names are personal data of third parties
- Make it **opt-in** (`rot_crew`, off by default), with a clear explanation in Settings.
- Keep **only rank and name**. No staff numbers, phone numbers, addresses or seniority.
- Store **only on the device**. Strip `crew` in `gdJson()` (Drive backup) unless a second explicit opt-in is set. Never put crew lists in shared PDFs by default.
- **Auto-purge** 30 days after the flight (`crewPurge()` at start-up).
- Never send it to the worker in plaintext. Option C carries only ciphertext.
- Update `privacy.html`. Ask the ITA DPO whether crew may keep copies of crew lists on personal devices; many airlines allow viewing in CrewLink but not exporting.

**Effort:** 1 day after the page or endpoint is known; 0.5 day for the probe session with a crew member.

**Risks:**
- *Legal and IT policy:* the highest of all the features here. Do not ship without the company's OK.
- *Fragility:* the HTML layout is unknown and the template must be calibrated.

---

## 4. Other features worth doing (taken from the code and changelog)

| Idea | Recommended approach | Effort | Notes / risk |
|---|---|---|---|
| **NAS status that actually loads** | Route it through the worker `/nas` (code above, 2-minute cache). The client changes one line. | 15 min | Today's direct fetch to `nasstatus.faa.gov` most likely fails on CORS and the error is swallowed silently. |
| **"Parsing" button (Beta 82, "to be configured")** | Make it the entry point for **Reload from CrewLink** (section 2). Once the JSON API is known, it can open `FIX.parse` (new web UI) with the bridge. | included in §2 | Remove the "coming soon" toast. |
| **SIGMET / turbulence along the route** | Worker `/sigmet` proxying AWC `api/data/isigmet?format=json` (international SIGMETs, the same AWC family the worker already uses). Filter by the FIRs of departure and arrival; the FIR comes from the NOTAM Q) line or a small table. Then add a "great-circle intersects polygon" test. Show TS/TURB/ICE chips next to the GFA/SIGWX links. | 1-1.5 days | Public US-government data, no key. |
| **Calendar export (ICS)** | Generate `.ics` on the device with stable `UID`s (`date+fn@rotate`), a `VALARM` at check-in −2 h, and the layover hotel from `ht`. Share it with `navigator.share({files})`. | 0.5-1 day | iOS Calendar *imports* (it does not update), so re-import duplicates events. Tell users to use a dedicated "Rotate" calendar. **Live subscription (webcal)** needs a server that holds the roster, so not recommended. Alternative that really syncs: **Google Calendar API** through the Google sign-in already used for Drive (`calendar.events` scope, upsert by `iCalUID`). That gives a real sync to the iPhone calendar if the Google account is added on iOS, but `calendar.events` is a *sensitive* scope and needs Google OAuth verification. |
| **Roster-change notifications** | Local diff on every reload (§2.3 step 5), plus check-in reminders through the ICS `VALARM`s. | 0.5-1 day | Real Web Push works for Home Screen web apps on iOS 16.4+. It only makes sense if a server knows when the roster changes, which is option D (rejected). Do not do it. |
| **Android share-to-Rotate** | Manifest `share_target` (POST, `application/pdf`) + service-worker handler → the existing import. | 0.5 day | Android/Chrome only; iOS Safari still has no Web Share Target. |
| **Privacy page refresh** | List the worker: what it receives (ICAO codes only), Cloudflare as processor, no logs of payloads, and the clipboard bridge. | 30 min | Needed now; the page already says "no server". |
| **Worker source in the repo** | Commit `worker/` with `wrangler.toml` and an Actions deploy on tag. | 1 h | Today the worker is the only piece outside version control. |

---

## 5. Suggested order

1. **Now:** email NOTAMS@faa.gov for NMS-API access. Fix the privacy page. Move NAS to the worker.
2. **Sprint 1:** clipboard bridge + "Reload from CrewLink" + roster diff. Gives the biggest daily win with the lowest risk.
3. **When FAA credentials arrive:** `/notam` worker + briefing NOTAM section. One week side by side with LIDO before turning it on.
4. **Sprint 2:** ICS export, SIGMET chips, Android share target.
5. **Only with written OK from ITA (DPO / IT security):** crew lists; encrypted drop box (C) if paste friction matters.

---

## Sources

- FAA NOTAM Management Service (NMS) and FAQs: https://www.faa.gov/about/initiatives/notam, https://www.faa.gov/about/initiatives/notam/faqs
- FAA NMS briefing (NMS-API onboarding, timeline): https://www.faa.gov/air_traffic/flight_info/aeronav/acf/media/Presentations/5-notam-mod-brief.pdf
- FAA NMS user brief: https://www.faasafety.gov/files/events/SO/SO15/2025/SO15140643/FAA_NOTAM_ManagementService.pdf
- USNS shutdown 18 Apr 2026 / FNS retirement later in 2026: https://www.eaa.org/eaa/news-and-publications/eaa-news-and-aviation-news/2026-04-16-FAAs-New-NOTAM-System-Online-April-18, https://generalaviationnews.com/2026/05/13/first-phase-of-notam-overhaul-completed/, https://nbaa.org/aircraft-operations/airspace/faa-plans-april-18-changeover-to-new-notam-system/, https://flightops.news/posts/the-faas-notam-system-overhaul-is-halfway-done-and-the-harder-half-is-still-ahead/
- NMS-API endpoints, OAuth flow and query parameters (`api-nms.aim.faa.gov`, `/v1/auth/token`, `/v1/notams`, `nmsResponseFormat`): npm package `faa-nms-api` 1.0.3 (README and dist, inspected locally), https://www.npmjs.com/package/faa-nms-api, https://apis.io/apis/faa/faa-nms-api/
- Legacy FAA NOTAM API: https://apis.io/apis/faa/faa-notam-api/
- ICAO API Data Service (100 free calls, booster packs, realtime NOTAMs from DINS): https://applications.icao.int/dataservices, https://icao.int/safety/iStars/Pages/Get-NOTAM-Data.aspx, https://store.icao.int/en/icao-api-service-plans-booster-pack-for-2k-calls
- EUROCONTROL EAD Basic: https://www.ead.eurocontrol.int/cms-eadbasic/opencms/en/ead-solutions/ead-basic
- Notamify API credits and pricing: https://skymerse.gitbook.io/notamify-api/v2/basics/notamify-api-credits
- Web Share Target on iOS (not supported): https://caniuse.com/wf-app-share-targets, https://bugs.webkit.org/show_bug.cgi?id=194593
- Shortcuts "Run JavaScript on Web Page" (`completion()`, share sheet only, Allow Running Scripts): https://support.apple.com/guide/shortcuts/apd218e2187d/ios
- Lufthansa Systems NetLine/Crew interaction apps (CrewLink; no public API): https://www.lhsystems.com/solutions/holistic-crew-management/netline-crew-interaction-apps

**Not verified (sites blocked from the research environment):**
- the autorouter.aero API terms;
- whether `notams.aim.faa.gov/notamSearch` and DINS still work after the FNS retirement;
- the exact field names of the NMS GeoJSON and ICAO responses;
- CrewLink's CSP, its `makeReport` response type and the crew-list page structure.

Each of these has a "verify" step in the plan above.
