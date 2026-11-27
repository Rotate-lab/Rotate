/* Rotate · cassetta postale CrewLink (Cloudflare Worker, formato "ES module")
 *
 * Il segnalibro Rotate, dentro CrewLink, consegna qui duty plan ed equipaggio CIFRATI;
 * l'app Rotate li ritira e li decifra. La chiave sta solo nel telefono (app + segnalibro):
 * il Worker e Cloudflare vedono soltanto dati illeggibili, cancellati dopo l'import o al
 * massimo dopo 24 ore. Quando arriva una consegna, manda una notifica push all'app.
 *
 * Configurazione (dashboard Cloudflare):
 *   - binding KV namespace con nome variabile  BOX
 *   - (facoltativo) variabile ORIGINS: altre origini permesse, separate da virgola
 *
 * Ogni cassetta ha due codici segreti: "rt" (solo l'app: legge le consegne) e
 * "wt" (app e segnalibro: lascia consegne e legge la richiesta). Il Worker conserva
 * soltanto l'impronta SHA-256 dei codici, mai i codici.
 */
const ORIGINS = ["https://rotate-lab.github.io", "https://crewlink.ita-airways.com"];
const PUSH_HOSTS = ["web.push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
const DROP_TTL = 86400, REQ_TTL = 40 * 86400, BOX_TTL = 400 * 86400;
const MAX_DROP = 8e6, MAX_REQ = 2e5, MAX_KEEP = 4;
const ID = /^[A-Za-z0-9_-]{22,64}$/, TOK = /^[A-Za-z0-9_-]{32,128}$/;
const enc = new TextEncoder();

const b64u = {
  to(buf) { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  from(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get("Origin") || "";
    const allowed = ORIGINS.concat(String(env.ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean));
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : ORIGINS[0],
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !allowed.includes(origin)) return J({ error: "origin" }, 403);
    if (!env.BOX) return J({ error: "KV binding BOX missing" }, 500);
    try {
      const p = url.pathname.split("/").filter(Boolean);
      if (p[0] === "health") return J({ ok: true });
      if (p[0] === "vapid" && req.method === "GET") return J({ key: (await vapid(env)).pub });
      if (p[0] !== "box") return J({ error: "not found" }, 404);

      // nuova cassetta: l'app sceglie id e codici, il Worker salva solo le impronte
      if (p.length === 1 && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        if (!ID.test(b.id || "") || !TOK.test(b.rt || "") || !TOK.test(b.wt || "")) return J({ error: "bad request" }, 400);
        if (await env.BOX.get("m:" + b.id)) return J({ error: "exists" }, 409);
        await env.BOX.put("m:" + b.id, JSON.stringify({ r: await sha(b.rt), w: await sha(b.wt), at: Date.now() }), { expirationTtl: BOX_TTL });
        return J({ ok: true }, 201);
      }

      const id = p[1];
      if (!ID.test(id || "")) return J({ error: "not found" }, 404);
      const m = await env.BOX.get("m:" + id, { type: "json" });
      if (!m) return J({ error: "not found" }, 404);
      let t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), body = null;
      // la richiesta può arrivare con navigator.sendBeacon (niente intestazioni): il codice è nel corpo
      if (!t && req.method === "POST" && p[2] === "req") {
        const x = await req.text();
        if (x.length > MAX_REQ) return J({ error: "too large" }, 413);
        try { body = JSON.parse(x); } catch (e) { return J({ error: "bad json" }, 400); }
        t = String((body && body.t) || "");
      }
      const h = TOK.test(t) ? await sha(t) : "", R = !!h && h === m.r, W = !!h && h === m.w;
      if (!R && !W) return J({ error: "unauthorized" }, 401);
      const what = p[2] || "";

      // richiesta dell'app (cosa scaricare): la scrive l'app, la leggono app e segnalibro
      if (what === "req") {
        if ((req.method === "PUT" || req.method === "POST") && R) {
          const x = body ? JSON.stringify({ iv: body.iv, ct: body.ct }) : await req.text();
          if (x.length > MAX_REQ) return J({ error: "too large" }, 413);
          await env.BOX.put("q:" + id, x, { expirationTtl: REQ_TTL });
          return J({ ok: true });
        }
        if (req.method === "GET") { const x = await env.BOX.get("q:" + id); return x ? new Response(x, { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } }) : J(null); }
        if (req.method === "DELETE") { await env.BOX.delete("q:" + id); return J({ ok: true }); }
      }

      // consegne: le lascia il segnalibro, le ritira (e cancella) solo l'app
      if (what === "drop") {
        if (req.method === "POST" && W) {
          const x = await req.text();
          if (x.length > MAX_DROP) return J({ error: "too large" }, 413);
          let d; try { d = JSON.parse(x); } catch (e) { return J({ error: "bad json" }, 400); }
          if (typeof d.iv !== "string" || typeof d.ct !== "string") return J({ error: "bad request" }, 400);
          const L = (await env.BOX.get("d:" + id, { type: "json" })) || [];
          const it = { n: crypto.randomUUID(), at: Date.now(), iv: d.iv, ct: d.ct };
          L.push(it);
          while (L.length > MAX_KEEP || (L.length > 1 && JSON.stringify(L).length > 2e7)) L.shift();
          await env.BOX.put("d:" + id, JSON.stringify(L), { expirationTtl: DROP_TTL });
          let push = null;
          if (m.push) {
            push = await sendPush(env, m.push, { title: "Rotate", body: String(d.note || "").slice(0, 160) || "CrewLink ✓", tag: "rotate-clb" }).catch(() => "error");
            if (push === 404 || push === 410) { delete m.push; await env.BOX.put("m:" + id, JSON.stringify(m), { expirationTtl: BOX_TTL }); }
          }
          return J({ ok: true, n: it.n, push });
        }
        if (req.method === "GET" && R) return J((await env.BOX.get("d:" + id, { type: "json" })) || []);
        if (req.method === "DELETE" && R) {
          const ids = (url.searchParams.get("n") || "").split(",").filter(Boolean);
          const L = ((await env.BOX.get("d:" + id, { type: "json" })) || []).filter(x => !ids.includes(x.n));
          if (L.length) await env.BOX.put("d:" + id, JSON.stringify(L), { expirationTtl: DROP_TTL }); else await env.BOX.delete("d:" + id);
          return J({ ok: true, left: L.length });
        }
      }

      // notifiche push dell'app
      if (what === "push" && R) {
        if (req.method === "PUT") {
          const s = await req.json().catch(() => null);
          if (!s || !/^https:\/\//.test(s.endpoint || "") || !s.keys || !s.keys.p256dh || !s.keys.auth) return J({ error: "bad subscription" }, 400);
          if (!pushHostOk(s.endpoint)) return J({ error: "push host" }, 400);
          m.push = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
          await env.BOX.put("m:" + id, JSON.stringify(m), { expirationTtl: BOX_TTL });
          return J({ ok: true });
        }
        if (req.method === "POST") { const b = await req.json().catch(() => ({})); const st = m.push ? await sendPush(env, m.push, { title: "Rotate", body: String(b.note || "Rotate ✓").slice(0, 160), tag: "rotate-test" }).catch(() => "error") : null; return J({ ok: st === 201 || st === 200, status: st }); }
        if (req.method === "DELETE") { delete m.push; await env.BOX.put("m:" + id, JSON.stringify(m), { expirationTtl: BOX_TTL }); return J({ ok: true }); }
      }

      // scollega: cancella tutto
      if (!what && req.method === "DELETE" && R) {
        await Promise.all(["m:", "q:", "d:"].map(k => env.BOX.delete(k + id)));
        return J({ ok: true });
      }
      return J({ error: "not found" }, 404);
    } catch (e) {
      return J({ error: String((e && e.message) || e) }, 500);
    }
  },
};

/* ---------- Web Push (RFC 8030 / 8291 / 8292) senza librerie ---------- */
function pushHostOk(u) { try { const h = new URL(u).hostname; return PUSH_HOSTS.some(x => h === x || h.endsWith("." + x)); } catch (e) { return false; } }

// chiave VAPID del server: creata la prima volta e conservata nel KV
async function vapid(env) {
  const v = await env.BOX.get("vapid", { type: "json" });
  if (v) return v;
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const nv = { jwk: await crypto.subtle.exportKey("jwk", k.privateKey), pub: b64u.to(await crypto.subtle.exportKey("raw", k.publicKey)) };
  await env.BOX.put("vapid", JSON.stringify(nv));
  return nv;
}

async function vapidJwt(v, aud) {
  const h = b64u.to(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u.to(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://rotate-lab.github.io" })));
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + c));
  return h + "." + c + "." + b64u.to(sig);
}

// cifratura del contenuto della notifica (aes128gcm, un solo record)
export async function encryptPush(sub, plain) {
  const ua = b64u.from(sub.keys.p256dh), auth = b64u.from(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const hk = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), len * 8));
  const ikm = await hk(auth, ecdh, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hk(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(plain, new Uint8Array([2]))));
  const hdr = new Uint8Array(21 + asPub.length);
  hdr.set(salt, 0); new DataView(hdr.buffer).setUint32(16, 4096); hdr[20] = asPub.length; hdr.set(asPub, 21);
  return cat(hdr, ct);
}

export async function sendPush(env, sub, msg) {
  if (!sub || !pushHostOk(sub.endpoint)) return null;
  const v = await vapid(env), ep = new URL(sub.endpoint);
  const body = await encryptPush(sub, enc.encode(JSON.stringify(msg)));
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { "Authorization": "vapid t=" + (await vapidJwt(v, ep.origin)) + ", k=" + v.pub, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high" },
    body,
  });
  return r.status;
}
