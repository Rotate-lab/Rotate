/* Rotate · ponte CrewLink → Rotate
 * Caricato dal segnalibro "Rotate" (o da Userscripts) dentro crewlink.ita-airways.com, nella sessione del pilota.
 * 1. legge la richiesta cifrata che Rotate ha lasciato sulla cassetta postale (Cloudflare Worker);
 * 2. scarica il duty plan del periodo e, per ogni volo richiesto, la lista equipaggio (gli stessi passi dei pulsanti di Show Crew);
 * 3. cifra tutto con la chiave del telefono e lo consegna alla cassetta. Rotate lo ritira e lo importa da solo.
 * Password e dati in chiaro non escono mai da CrewLink e dal telefono.
 */
(() => {
  "use strict";
  const C = window.__rotate || {}, H = "crewlink.ita-airways.com", AUTO = !!C.a;
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

  /* ---- cifratura (AES-GCM 256, chiave del telefono) ---- */
  let KEY = null;
  const key = async () => KEY || (KEY = await crypto.subtle.importKey("raw", b64u8(C.k), "AES-GCM", false, ["encrypt", "decrypt"]));
  const seal = async obj => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(obj)))); return { iv: u8b64(iv), ct: u8b64(ct) }; };
  const unseal = async x => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u8(x.iv) }, await key(), b64u8(x.ct))));

  /* ---- cassetta postale ---- */
  const box = (path, opt) => fetch(C.b.replace(/\/+$/, "") + "/box/" + C.i + path, Object.assign({ headers: { Authorization: "Bearer " + C.w, "Content-Type": "application/json" }, cache: "no-store" }, opt || {}));

  /* ---- CrewLink ---- */
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
    const r2 = await get(new URL(s, r.url).href), b2 = await r2.arrayBuffer();
    if (!isPdf(b2)) throw new Error("no PDF");
    return b2;
  }
  const dutyPlan = async p => { const r = await get("/crewlink/clApp?" + new URLSearchParams({ crewlinkService: "individualDutyPlan", crewlinkOperation: "makeReport", buddyName: "", beginDate: p.b, endDate: p.e })); if (!r.ok) throw new Error("HTTP " + r.status); return pdfOf(r, await r.arrayBuffer()); };

  /* lista equipaggio nella pagina: righe col codice crew (IT405770); ruolo = colonna dopo, nome = "COGNOME, NOME".
     Una riga "AZ 641 24Nov26 SFO …" apre il volo a cui appartengono le righe seguenti. */
  const FT = /\b([A-Z0-9]{2})\s?(\d{1,4})\s+(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\s+([A-Z]{3})/;
  function crewOf(docs) {
    const items = [];
    const add = m => { const d = "20" + m[5] + "-" + p2(MO[m[4]]) + "-" + m[3], fn = m[1] + " " + m[2]; let x = items.find(y => y.d === d && y.fn === fn); if (!x) { x = { d, fn, crew: [] }; items.push(x); } return x; };
    docs.forEach(d => {
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

  /* ---- riquadro in basso ---- */
  const o = document.createElement("div");
  o.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#fff;font:15px/1.4 -apple-system,system-ui,sans-serif;padding:14px 16px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  const ui = {
    on: false,
    show() { if (!this.on) { (document.body || document.documentElement).appendChild(o); this.on = true; } },
    msg(t, s) { this.show(); o.textContent = ""; const b = document.createElement("b"); b.textContent = t; o.appendChild(b); if (s) { const p = document.createElement("div"); p.style.cssText = "opacity:.75;font-size:13px;margin-top:3px"; p.textContent = s; o.appendChild(p); } },
    done(ok, t, s, ms) { this.msg(t, s); o.style.background = ok ? "#0a6b34" : "#a3221a"; setTimeout(() => { o.remove(); this.on = false; }, ms || (ok ? 15000 : 15000)); },
    button(t, fn) { const b = document.createElement("button"); b.textContent = t; b.style.cssText = "display:block;margin-top:10px;font:inherit;font-weight:700;padding:12px 18px;border-radius:6px;border:0;background:#fff;color:#111"; b.onclick = fn; o.appendChild(b); },
  };

  async function run() {
    /* 1. richiesta lasciata da Rotate */
    let rq = null, boxOk = true;
    try { const r = await box("/req"); if (!r.ok) throw new Error("HTTP " + r.status); const x = await r.json(); rq = x ? await unseal(x) : null; }
    catch (e) { boxOk = false; if (AUTO) return; }
    if (rq && rq.l) IT = rq.l === "it";
    if (AUTO) { if (!rq) return; try { if (sessionStorage.getItem("rotate-done") === rq.id) return; } catch (e) {} }
    if (!rq) { const t = new Date(); rq = { id: "", dp: [0, 1].map(i => ({ b: cl(new Date(t.getFullYear(), t.getMonth() + i, 1)), e: cl(new Date(t.getFullYear(), t.getMonth() + i + 1, 0)) })), fl: [] }; }
    const dps = Array.isArray(rq.dp) ? rq.dp.slice(0, 3) : [], fl = Array.isArray(rq.fl) ? rq.fl.slice(0, 80) : [];
    const out = { v: 1, t: "bundle", rid: rq.id || "", at: Date.now(), dp: dps.map(p => ({ b: p.b, e: p.e })), asked: fl.map(f => f.k || ""), files: [], crew: { items: [] }, miss: [] };
    const sub = T("Keep Safari open until it is done", "Non chiudere Safari finché non ha finito");

    /* 2. duty plan */
    for (const p of dps) {
      step = "duty plan"; ui.msg(T("Rotate · duty plan ", "Rotate · duty plan ") + (p.lbl || p.b + "–" + p.e) + "…", sub);
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
    step = "";
    const nc = out.crew.items.length;
    const what = [out.files.length ? T("duty plan", "duty plan") + (dps.length === 1 && dps[0].lbl ? " " + dps[0].lbl : "") : "", nc ? T("crew of " + nc + (nc > 1 ? " flights" : " flight"), "equipaggio di " + nc + (nc > 1 ? " voli" : " volo")) : ""].filter(Boolean).join(" · ");

    /* 4. consegna cifrata */
    if (boxOk) {
      try {
        const r = await box("/drop", { method: "POST", body: JSON.stringify(Object.assign(await seal(out), { note: T("Ready: ", "Pronti: ") + what + T(". Tap to open Rotate.", ". Tocca per aprire Rotate.") })) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        await box("/req", { method: "DELETE" }).catch(() => {});
        try { sessionStorage.setItem("rotate-done", rq.id || ""); } catch (e) {}
        ui.done(1, T("Done ✓ ", "Fatto ✓ ") + what, T("Go back to Rotate (◀ Rotate at the top left): it imports by itself.", "Torna a Rotate (◀ Rotate in alto a sinistra): importa da solo.") + (out.miss.length ? " " + T(out.miss.length + " crew lists not found.", out.miss.length + " liste equipaggio non trovate.") : ""));
        return;
      } catch (e) {}
    }
    /* senza cassetta: si passa dagli appunti (serve un tocco) */
    ui.msg(T("Rotate server not reachable", "Server Rotate non raggiungibile"), T("Copy the data and paste it in Rotate.", "Copia i dati e incollali in Rotate."));
    ui.button(T("Copy for Rotate", "Copia per Rotate"), () => navigator.clipboard.writeText("ROTATE1 " + JSON.stringify(Object.assign({ bv: 6 }, out))).then(() => ui.done(1, T("Copied", "Copiato"), T("Open Rotate and tap Paste.", "Apri Rotate e tocca Incolla.")), e => ui.done(0, "Rotate: " + e)));
  }

  run().catch(e => {
    if (e && e.message === "login") { ui.done(0, T("Rotate: log in to CrewLink", "Rotate: fai il login a CrewLink"), AUTO ? T("After the login Rotate continues by itself.", "Dopo il login Rotate continua da solo.") : T("Then tap the bookmark again.", "Poi tocca di nuovo il segnalibro."), 8000); return; }
    ui.done(0, T("Rotate: something went wrong", "Rotate: qualcosa non ha funzionato"), (step ? step + ": " : "") + ((e && e.message) || e));
  }).finally(() => { window.__rotateRun = 0; });
})();
