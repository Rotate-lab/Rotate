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
    // invio di modulo da CrewLink: con la sua politica sui referrer il browser può mandare "Origin: null"; il codice nel modulo basta
    const isForm = req.method === "POST" && /x-www-form-urlencoded|multipart\/form-data/i.test(req.headers.get("Content-Type") || "") && /\/(drop|hop)$/.test(url.pathname);
    if (origin && !allowed.includes(origin) && !(isForm && origin === "null")) return isForm ? page("err", "it", "origin " + origin, "", HOME) : J({ error: "origin" }, 403);
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
      if (!m) {
        // segnalibro collegato a una cassetta che non esiste più (es. spazio dati ricreato): pagina che spiega come ricollegare
        if (isForm) { const f0 = await req.formData().catch(() => null); return page("lost", f0 && f0.get("l"), "", "", HOME); }
        return J({ error: "not found" }, 404);
      }
      let t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), body = null, form = null;
      const ctype = req.headers.get("Content-Type") || "";
      // da CrewLink i dati arrivano con un invio di modulo (la CSP di CrewLink blocca fetch verso altri siti): il codice è nel modulo
      if (!t && req.method === "POST" && (p[2] === "drop" || p[2] === "hop") && /x-www-form-urlencoded|multipart\/form-data/i.test(ctype)) {
        form = await req.formData();
        t = String(form.get("t") || "");
      }
      // la richiesta può arrivare con navigator.sendBeacon (niente intestazioni): il codice è nel corpo
      else if (!t && req.method === "POST" && p[2] === "req") {
        const x = await req.text();
        if (x.length > MAX_REQ) return J({ error: "too large" }, 413);
        try { body = JSON.parse(x); } catch (e) { return J({ error: "bad json" }, 400); }
        t = String((body && body.t) || "");
      }
      const h = TOK.test(t) ? await sha(t) : "", R = !!h && h === m.r, W = !!h && h === m.w;
      if (!R && !W) return form ? page("auth", form.get("l"), "", "", HOME) : J({ error: "unauthorized" }, 401);
      const what = p[2] || "";
      const back = form && /^https:\/\/crewlink\.ita-airways\.com\//.test(String(form.get("back") || "")) ? String(form.get("back")) : HOME;

      // richiesta persa (es. dopo il login): torna su CrewLink con la richiesta cifrata nell'indirizzo
      if (what === "hop" && req.method === "POST") {
        const q = await env.BOX.get("q:" + id);
        let frag = "none";
        if (q) { try { const x = JSON.parse(q); frag = "v1." + b64u.to(b64u.from(x.iv)) + "." + b64u.to(b64u.from(x.ct)); } catch (e) {} }
        return hopPage(frag !== "none", form.get("l"), back + "#rotate-req=" + frag);
      }

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
          let d;
          if (form) d = { iv: String(form.get("iv") || ""), ct: String(form.get("ct") || ""), note: String(form.get("note") || "") };
          else {
            const x = await req.text();
            if (x.length > MAX_DROP) return J({ error: "too large" }, 413);
            try { d = JSON.parse(x); } catch (e) { return J({ error: "bad json" }, 400); }
          }
          if (typeof d.iv !== "string" || typeof d.ct !== "string" || !d.iv || !d.ct) return form ? page("err", form.get("l"), "400", "", back) : J({ error: "bad request" }, 400);
          if (d.ct.length > MAX_DROP) return form ? page("err", form.get("l"), "413", "", back) : J({ error: "too large" }, 413);
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
          if (form) return page("ok", form.get("l"), "", String(form.get("w") || d.note || ""), back, push === 201 || push === 200);
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

/* ---------- pagine mostrate su Safari dopo l'invio da CrewLink ---------- */
const HOME = "https://crewlink.ita-airways.com/crewlink/clApp?crewlinkService=crewlinkForCrew&crewlinkOperation=loadMainFrameSet";
const escH = s => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const CSS = 'body{margin:0;padding:0 22px 48px;font:18px/1.5 -apple-system,system-ui,sans-serif;color:#fff;-webkit-text-size-adjust:100%}'
  + '.up{display:flex;align-items:center;gap:10px;padding:12px 0 0;font-weight:700;font-size:16px}.up span{font-size:40px;line-height:1}'
  + 'h1{font-size:32px;line-height:1.15;margin:26px 0 8px}.sum{font-size:18px;opacity:.92;margin:0 0 26px}'
  + '.cta{background:#fff;border-radius:16px;padding:20px 16px;font-size:26px;line-height:1.15;font-weight:900;text-align:center;margin:0 0 12px}'
  + '.cta2{border:3px solid #fff;border-radius:16px;padding:16px;font-size:22px;line-height:1.2;font-weight:800;text-align:center;margin:0 0 22px}.or{text-align:center;font-weight:700;opacity:.85;margin:0 0 12px}'
  + 'p{margin:0 0 16px}.sub{font-size:17px}.btn{display:block;text-align:center;background:rgba(255,255,255,.16);border-radius:12px;padding:14px;color:#fff;font-weight:700;text-decoration:none;margin:0 0 12px}'
  + 'a{color:#fff}.small{font-size:15px;opacity:.85}';
function html(bg, title, body, extraHead) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' + (extraHead || "")
    + '<title>Rotate · ' + escH(title) + '</title><style>' + CSS + 'body{background:' + bg + '}.cta{color:' + bg + '}</style></head><body>' + body + '</body></html>';
}
const reply = (h, status) => new Response(h, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
function page(kind, lang, code, info, back, pushed) {
  const it = String(lang || "it") !== "en", T = (e, i) => (it ? i : e), bk = escH(back || HOME);
  if (kind === "ok") {
    const sum = escH(String(info || "").replace(/^(Pronti|Ready):\s*/, "").replace(/\.?\s*(Tocca per aprire Rotate|Tap to open Rotate)\.?$/, ""));
    return reply(html("#0a6b34", T("Finished", "Finito"),
      '<h1 style="margin-top:44px">✓ ' + T("Finished", "Finito") + '</h1>'
      + '<p class="sum">' + (sum ? sum + "<br>" : "") + T("Rotate has received everything.", "Rotate ha ricevuto tutto.") + '</p>'
      + (pushed
        ? '<div class="cta">↑ ' + T("Open the notification up here", "Apri la notifica qua sopra") + '</div><p class="or">' + T("or", "oppure") + '</p><div class="cta2">' + T("Open Rotate again from the Home Screen", "Riapri Rotate dalla schermata Home") + '</div>'
        : '<div class="cta">' + T("Open Rotate again from the Home Screen", "Riapri Rotate dalla schermata Home") + '</div><p class="sub">' + T("Turn on notifications in Rotate › Settings › CrewLink: next time Rotate will tell you when it is done.", "Attiva le notifiche in Rotate › Impostazioni › CrewLink: la prossima volta Rotate ti avvisa quando ha finito.") + '</p>')
      + '<p class="sub">' + T("Duty plan and crew are imported by themselves as soon as Rotate opens.", "Duty plan ed equipaggio si importano da soli appena Rotate si apre.") + '</p>'
      + '<p class="small"><a href="' + bk + '">' + T("Back to CrewLink", "Torna a CrewLink") + '</a></p>'));
  }
  if (kind === "lost") return reply(html("#8a4b00", T("Link to redo", "Collegamento da rifare"),
    '<h1>' + T("This bookmark is no longer linked", "Questo segnalibro non è più collegato") + '</h1>'
    + '<p>' + T("The Rotate server does not know it any more (its storage was recreated).", "Il server di Rotate non lo riconosce più (lo spazio dati è stato ricreato).") + '</p>'
    + '<div class="cta">' + T("GO BACK TO ROTATE", "TORNA A ROTATE") + '</div>'
    + '<p class="sub">' + T("In Rotate: <b>Duty plan › CrewLink link › Link again</b>, then copy the bookmark again and replace the address of the Rotate bookmark.", "In Rotate: <b>Duty plan › Collegamento CrewLink › Ricollega</b>, poi copia di nuovo il segnalibro e sostituisci l'indirizzo del segnalibro Rotate.") + '</p>'), 404);
  if (kind === "auth") return reply(html("#a3221a", T("Not sent", "Non inviato"),
    '<h1>' + T("Bookmark not valid", "Segnalibro non valido") + '</h1>'
    + '<p class="sub">' + T("In Rotate: <b>Duty plan › CrewLink link › Copy bookmark</b> and replace the address of the Rotate bookmark.", "In Rotate: <b>Duty plan › Collegamento CrewLink › Copia segnalibro</b> e sostituisci l'indirizzo del segnalibro Rotate.") + '</p>'
    + '<p class="small"><a href="' + bk + '">' + T("Back to CrewLink", "Torna a CrewLink") + '</a></p>'), 401);
  return reply(html("#a3221a", T("Not sent", "Non inviato"),
    '<h1>' + T("Not sent", "Non inviato") + '</h1>'
    + '<p class="sub">' + T("Rotate did not receive the data (" + escH(code) + "). Go back to CrewLink and tap the Rotate bookmark again.", "Rotate non ha ricevuto i dati (" + escH(code) + "). Torna a CrewLink e tocca di nuovo il segnalibro Rotate.") + '</p>'
    + '<a class="btn" href="' + bk + '">' + T("Back to CrewLink", "Torna a CrewLink") + '</a>'), 400);
}
// richiesta persa (es. dopo il login): trovata → torna subito su CrewLink; nessuna → si spiega da dove partire
function hopPage(found, lang, to) {
  const it = String(lang || "it") !== "en", T = (e, i) => (it ? i : e), u = escH(to);
  if (found) return reply(html("#111", "CrewLink",
    '<h1>' + T("Rotate request found", "Richiesta di Rotate trovata") + '</h1>'
    + '<p class="sub">' + T("Going back to CrewLink. <b>When it reloads, tap the Rotate bookmark again.</b>", "Torno su CrewLink. <b>Quando si ricarica, tocca di nuovo il segnalibro Rotate.</b>") + '</p>'
    + '<a class="btn" href="' + u + '">' + T("Continue", "Continua") + '</a>'
    + '<script>location.replace(' + JSON.stringify(to).replace(/</g, "\\u003c") + ')</script>',
    '<meta http-equiv="refresh" content="0;url=' + u + '">'));
  return reply(html("#111", "CrewLink",
    '<h1>' + T("No request from Rotate", "Nessuna richiesta da Rotate") + '</h1>'
    + '<p class="sub">' + T("To download duty plan <b>and crew</b>, start from Rotate: <b>Roster › wheel</b> (or Show crew), then tap the Rotate bookmark on CrewLink.", "Per scaricare duty plan <b>ed equipaggio</b> parti da Rotate: <b>Roster › rotella</b> (o Mostra equipaggio), poi tocca il segnalibro Rotate su CrewLink.") + '</p>'
    + '<div class="cta">' + T("GO BACK TO ROTATE", "TORNA A ROTATE") + '</div>'
    + '<p class="sub">' + T("Or continue here: the bookmark downloads only the duty plan of this month and the next one.", "Oppure continua da qui: il segnalibro scarica solo il duty plan di questo mese e del prossimo.") + '</p>'
    + '<a class="btn" href="' + u + '">' + T("Continue with the duty plan only", "Continua con il solo duty plan") + '</a>'));
}

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
