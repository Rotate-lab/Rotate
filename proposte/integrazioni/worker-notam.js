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
