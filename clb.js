/* Rotate · ponte CrewLink → Rotate (v7)
 * Questo codice sta tutto dentro il segnalibro "Rotate" (o in Userscripts): la regola di sicurezza di CrewLink (CSP)
 * permette gli script del segnalibro e le richieste verso CrewLink stesso, ma non script o richieste verso altri siti.
 * Per questo:
 * - la richiesta di Rotate (periodo del duty plan e voli di cui serve l'equipaggio) arriva cifrata nell'indirizzo: #rotate-req=…
 * - duty plan e liste equipaggio si leggono da CrewLink, nella sessione del pilota (stessi passi dei pulsanti);
 * - il risultato, cifrato con la chiave del telefono, parte verso la cassetta postale di Rotate con un normale invio di modulo,
 *   che porta alla pagina "Fatto". Rotate lo ritira e lo importa da solo.
 * Nessuna richiesta verso altri siti parte da CrewLink, quindi nessun blocco di sicurezza.
 */
(() => {
  "use strict";
  const C = window.__rotate || {}, H = "crewlink.ita-airways.com", AUTO = !!C.a, BV = 7;
  let IT = /^it/i.test(C.l || navigator.language || "");
  const T = (e, i) => (IT ? i : e);
  if (window.__rotateRun) return;
  if (location.hostname !== H) { if (!AUTO) alert(T("Rotate: open CrewLink (" + H + "), log in, then tap the bookmark again.", "Rotate: apri CrewLink (" + H + "), fai il login, poi tocca di nuovo il segnalibro.")); return; }
  if (!C.b || !C.i || !C.w || !C.k) { if (!AUTO) alert(T("Rotate: this bookmark is incomplete. Create it again in Rotate › Duty plan › CrewLink link.", "Rotate: segnalibro incompleto. Ricrealo in Rotate › Duty plan › Collegamento CrewLink.")); return; }
  window.__rotateRun = 1;

  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], MO = {};
  M.forEach((m, i) => (MO[m] = i + 1));
  const p2 = n => String(n).padStart(2, "0"), cl = d => p2(d.getDate()) + M[d.getMonth()] + String(d.getFullYear()).slice(2);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const u8b64 = u => { let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  const b64u8 = s => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const fnN = x => String(x || "").replace(/\s+/g, "").replace(/^([A-Z0-9]{2})0+/, "$1").toUpperCase();
  const BOX = C.b.replace(/\/+$/, "") + "/box/" + C.i, HOME = location.origin + "/crewlink/clApp?crewlinkService=crewlinkForCrew&crewlinkOperation=loadMainFrameSet";

  /* cifratura (AES-GCM 256, chiave del telefono) */
  let KEY = null;
  const key = async () => KEY || (KEY = await crypto.subtle.importKey("raw", b64u8(C.k), "AES-GCM", false, ["encrypt", "decrypt"]));
  const seal = async obj => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(obj)))); return { iv: u8b64(iv), ct: u8b64(ct) }; };
  const unseal = async x => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u8(x.iv) }, await key(), b64u8(x.ct))));

  /* pagine di CrewLink: frame annidati compresi */
  const docsOf = w0 => { const out = []; const walk = (w, d) => { if (d > 5) return; try { if (w.document) out.push(w.document); } catch (e) {} try { for (let i = 0; i < w.frames.length; i++) walk(w.frames[i], d + 1); } catch (e) {} }; walk(w0, 0); return out; };
  const loginPage = () => docsOf(window).some(d => { try { return !!d.querySelector("input[type=password]"); } catch (e) { return false; } });
  /* il riquadro e il modulo vanno nel frame visibile più grande (la pagina principale di CrewLink è un frameset) */
  const host = () => {
    if (document.body && document.body.tagName === "BODY") return document;
    let best = null, area = 0;
    const walk = w => { for (let i = 0; i < w.frames.length; i++) { const f = w.frames[i]; try { const d = f.document; if (d.body && d.body.tagName === "BODY") { const a = (f.innerWidth || 0) * (f.innerHeight || 0); if (a > area) { area = a; best = d; } } walk(f); } catch (e) {} } };
    walk(window);
    return best || document;
  };

  /* CrewLink, solo richieste verso CrewLink stesso */
  let step = "";
  const isPdf = b => b.byteLength > 4 && new TextDecoder().decode(new Uint8Array(b, 0, 5)) === "%PDF-";
  const tmo = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);
  const get = u => tmo(fetch(u, { credentials: "include", cache: "no-store" }), 30000);
  const post = fl => tmo(fetch("/crewlink/clApp", { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fl) }), 30000);
  const html = async r => { const t = await r.text(); if (/type=["']?password/i.test(t)) throw new Error("login"); return new DOMParser().parseFromString(t, "text/html"); };
  async function pdfOf(r, b) {
    if (isPdf(b)) return b;
    const tx = new TextDecoder().decode(b), d = new DOMParser().parseFromString(tx, "text/html");
    const e = [...d.querySelectorAll("embed[src],iframe[src],frame[src],object[data],a[href*='.pdf'],a[href*='makeReport']")].find(x => !/(Result|Status|Clock|Header)\w*\.(html|jsp)/i.test(x.getAttribute("src") || x.getAttribute("data") || x.getAttribute("href") || ""));
    let s = e && (e.getAttribute("src") || e.getAttribute("data") || e.getAttribute("href"));
    if (!s) { const m = tx.match(/["'](\/crewlink\/[^"'\s]*(?:pdf|[Rr]eport|print|[Ff]ile|[Dd]ownload)[^"'\s]*|[^"'\s]+\.pdf[^"'\s]*)["']/); s = m && m[1]; }
    if (!s) throw new Error(d.querySelector("input[type=password]") || /log ?in|sign ?in|password/i.test(d.body ? d.body.textContent : "") ? "login" : "no PDF · " + (d.title || ""));
    const u = new URL(s, r.url);
    if (u.origin !== location.origin) throw new Error("no PDF");
    const r2 = await get(u.href), b2 = await r2.arrayBuffer();
    if (!isPdf(b2)) throw new Error("no PDF");
    return b2;
  }
  const dutyPlan = async p => { const r = await get("/crewlink/clApp?" + new URLSearchParams({ crewlinkService: "individualDutyPlan", crewlinkOperation: "makeReport", buddyName: "", beginDate: p.b, endDate: p.e })); if (!r.ok) throw new Error("HTTP " + r.status); return pdfOf(r, await r.arrayBuffer()); };

  /* lista equipaggio: righe col codice crew (IT405770); ruolo = colonna dopo, nome = "COGNOME, NOME".
     Una riga "AZ 641 24Nov26 SFO …" apre il volo a cui appartengono le righe seguenti. */
  const FT = /\b([A-Z0-9]{2})\s?(\d{1,4})\s+(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\s+([A-Z]{3})/;
  function crewOf(dd) {
    const items = [];
    const add = m => { const d = "20" + m[5] + "-" + p2(MO[m[4]]) + "-" + m[3], fn = m[1] + " " + m[2]; let x = items.find(y => y.d === d && y.fn === fn); if (!x) { x = { d, fn, crew: [] }; items.push(x); } return x; };
    dd.forEach(d => {
      const body = ((d.body && d.body.textContent) || "").replace(/\s+/g, " ");
      d.querySelectorAll("table").forEach(tb => {
        let cur = null;
        const ctx = () => { let el = tb, m = null; for (let i = 0; i < 10 && !m && el; i++) { el = el.previousElementSibling || el.parentElement; if (el) m = (el.textContent || "").replace(/\s+/g, " ").match(FT); } return m || body.match(FT); };
        [...tb.rows].forEach(tr => {
          const c = [...tr.cells].map(x => x.textContent.replace(/\s+/g, " ").trim()), k = c.findIndex(x => /^[A-Z]{2}\d{5,7}$/.test(x));
          if (k < 0) { const m = c.join(" ").match(FT); if (m) cur = add(m); return; }
          const rk = c[k + 1] || "", nm = c.slice(k + 1).find(x => /^[^\d,]{2,},\s*[^\d,]{2,}$/.test(x));
          if (!nm || !/^[A-Z0-9\/]{1,4}$/.test(rk)) return;
          if (!cur) { const m = ctx(); if (!m) return; cur = add(m); }
          if (!cur.crew.some(y => y.n === nm)) cur.crew.push({ r: rk, n: nm });
        });
      });
    });
    return items.filter(x => x.crew.length);
  }
  const isoOf = d => "20" + d.slice(5) + "-" + p2(MO[d.slice(2, 5)]) + "-" + d.slice(0, 2);
  const pick = (items, f) => items.find(x => fnN(x.fn) === fnN(f.a + f.n) && x.d === isoOf(f.d)) || (items.length === 1 && fnN(items[0].fn) === fnN(f.a + f.n) ? items[0] : null);
  const legForms = D => [...D.forms].filter(F => F.querySelector("[name=crewlinkOperation][value=exploreFlight]"));
  const fields = F => { const o = {}; [...F.elements].forEach(x => { if (x.name) o[x.name] = x.value; }); return o; };
  const clear = () => post({ crewlinkService: "showCrew", crewlinkOperation: "clearCrewList", crewlinkSourcePage: "spCrew" }).catch(() => {});
  async function crewFor(f) {
    await clear();
    let d = await html(await post({ depDatePeriodBegin: f.d, depDatePeriodEnd: f.d, fnAirline: f.a, fnNumber: f.n, depAp: f.ap || "", arrAp: "", crewlinkService: "showCrew", crewlinkOperation: "showCrew", crewlinkSourcePage: "spCrew" }));
    let fs = legForms(d);
    if (!fs.length) { d = await html(await get("/crewlink/clApp?crewlinkService=showCrew&crewlinkOperation=legList")); fs = legForms(d); }
    if (!fs.length) return null;
    let got = [];
    for (const F of fs.slice(0, 3)) got = got.concat(crewOf([await html(await post(fields(F)))]));
    return pick(got, f) || pick(crewOf([await html(await get("/crewlink/clApp?crewlinkService=showCrew&crewlinkOperation=crewOnFlight"))]), f);
  }
  const retry = async (fn, n = 2) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (e.message === "login" || i >= n) throw e; await sleep(900); } } };

  /* riquadro in basso */
  let o = null;
  const ui = {
    box() { if (!o || !o.isConnected) { const D = host(); o = D.createElement("div"); o.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#fff;font:15px/1.4 -apple-system,system-ui,sans-serif;padding:14px 16px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35)"; (D.body || D.documentElement).appendChild(o); } return o; },
    msg(t, s, bg) { const b = this.box(), D = b.ownerDocument; b.textContent = ""; b.style.background = bg || "#111"; const h = D.createElement("b"); h.textContent = t; b.appendChild(h); if (s) { const p = D.createElement("div"); p.style.cssText = "opacity:.8;font-size:13px;margin-top:3px"; p.textContent = s; b.appendChild(p); } },
    done(ok, t, s, ms) { this.msg(t, s, ok ? "#0a6b34" : "#a3221a"); const b = o; setTimeout(() => { if (b) b.remove(); }, ms || 15000); },
  };

  /* invio di modulo verso la cassetta postale: porta alla pagina "Fatto" (o, senza richiesta, a recuperarla) */
  const submit = (path, fl) => {
    const D = host(), f = D.createElement("form");
    f.method = "POST"; f.action = BOX + path; f.target = "_top"; f.acceptCharset = "utf-8"; f.style.display = "none";
    Object.keys(fl).forEach(n => { const i = D.createElement("input"); i.type = "hidden"; i.name = n; i.value = fl[n]; f.appendChild(i); });
    (D.body || D.documentElement).appendChild(f);
    f.submit();
  };

  async function run() {
    /* 1. la richiesta di Rotate: nell'indirizzo, o messa da parte prima del login (Userscripts) */
    let raw = (location.hash.match(/rotate-req=([^&]+)/) || [])[1] || "";
    if (raw) { try { sessionStorage.setItem("rotate-req", raw); } catch (e) {} }
    else { try { raw = sessionStorage.getItem("rotate-req") || ""; } catch (e) {} }
    if (AUTO) { if (!raw) return; try { if (sessionStorage.getItem("rotate-done") === raw) return; } catch (e) {} }
    if (loginPage()) { ui.done(0, T("Rotate: log in to CrewLink", "Rotate: fai il login a CrewLink"), AUTO ? T("After the login Rotate continues by itself.", "Dopo il login Rotate continua da solo.") : T("Then tap the bookmark again.", "Poi tocca di nuovo il segnalibro."), 8000); return; }
    if (!raw) {
      /* aperto senza passare da Rotate, o la richiesta si è persa con il login: si recupera dalla cassetta e si torna qui */
      alert(T("Rotate fetches its request now. When CrewLink reloads, tap the Rotate bookmark again.", "Rotate recupera la sua richiesta. Quando CrewLink si ricarica, tocca di nuovo il segnalibro Rotate."));
      submit("/hop", { t: C.w, back: HOME });
      return;
    }
    let rq = null;
    if (raw !== "none") { const pp = raw.split("."); rq = await unseal({ iv: pp[1], ct: pp[2] }); }
    if (rq && rq.l) IT = rq.l === "it";
    if (!rq) { const t = new Date(); rq = { id: "", dp: [0, 1].map(i => ({ b: cl(new Date(t.getFullYear(), t.getMonth() + i, 1)), e: cl(new Date(t.getFullYear(), t.getMonth() + i + 1, 0)) })), fl: [] }; }
    const dps = Array.isArray(rq.dp) ? rq.dp.slice(0, 3) : [], fl = Array.isArray(rq.fl) ? rq.fl.slice(0, 80) : [];
    const out = { v: 1, bv: BV, t: "bundle", rid: rq.id || "", at: Date.now(), dp: dps.map(p => ({ b: p.b, e: p.e })), asked: fl.map(f => f.k || ""), files: [], crew: { items: [] }, miss: [] };
    const sub = T("Keep Safari open until it is done", "Non chiudere Safari finché non ha finito");

    /* 2. duty plan */
    for (const p of dps) {
      step = "duty plan"; ui.msg("Rotate · duty plan " + (p.lbl || p.b + "–" + p.e) + "…", sub);
      try { out.files.push({ n: p.b + "-" + p.e + ".pdf", b64: u8b64(new Uint8Array(await retry(() => dutyPlan(p)))) }); }
      catch (e) { if (e.message === "login") throw e; if (dps.length === 1 && !fl.length) throw e; }
    }
    /* 3. equipaggio, un volo alla volta */
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i]; step = T("crew ", "equipaggio ") + f.a + f.n;
      ui.msg(T("Rotate · crew ", "Rotate · equipaggio ") + (i + 1) + "/" + fl.length + " · " + f.a + " " + f.n + " " + f.d, sub);
      try { const it = await retry(() => crewFor(f)); if (it) out.crew.items.push(it); else out.miss.push(f.k || f.a + f.n); }
      catch (e) { if (e.message === "login") throw e; out.miss.push(f.k || f.a + f.n); }
    }
    if (fl.length) await clear();
    if (!out.files.length && !out.crew.items.length) throw new Error(T("nothing found", "niente trovato"));
    step = T("sending", "invio");
    const nc = out.crew.items.length;
    const what = [out.files.length ? "duty plan" + (dps.length === 1 && dps[0].lbl ? " " + dps[0].lbl : "") : "", nc ? T("crew of " + nc + (nc > 1 ? " flights" : " flight"), "equipaggio di " + nc + (nc > 1 ? " voli" : " volo")) : ""].filter(Boolean).join(" · ");
    ui.msg(T("Rotate · sending to Rotate…", "Rotate · invio a Rotate…"), what);

    /* 4. consegna cifrata con un invio di modulo */
    const s = await seal(out);
    try { sessionStorage.removeItem("rotate-req"); sessionStorage.setItem("rotate-done", raw); } catch (e) {}
    submit("/drop", { t: C.w, iv: s.iv, ct: s.ct, l: IT ? "it" : "en", back: HOME, miss: String(out.miss.length), note: T("Ready: ", "Pronti: ") + what + T(". Tap to open Rotate.", ". Tocca per aprire Rotate.") });
  }

  run().catch(e => {
    if (e && e.message === "login") { ui.done(0, T("Rotate: log in to CrewLink", "Rotate: fai il login a CrewLink"), AUTO ? T("After the login Rotate continues by itself.", "Dopo il login Rotate continua da solo.") : T("Then tap the bookmark again.", "Poi tocca di nuovo il segnalibro."), 8000); return; }
    ui.done(0, T("Rotate: something went wrong", "Rotate: qualcosa non ha funzionato"), (step ? step + ": " : "") + ((e && e.message) || e));
  }).finally(() => { window.__rotateRun = 0; });
})();
