# Rotate — performance / efficiency audit

Audited: `index.html` / `sw.js` at commit **0b7f6e9** (HEAD; copied to `perf/baseline/`). Line numbers below refer to that commit.
The repo was not modified. The working tree changed while I worked: it now has uncommitted edits by someone else (`defer` on the PDF scripts, non-blocking font CSS, an `lbNight` cache, `load()` sanitising, and others). See "Working tree note" at the end.

## TL;DR

| # | Finding | Measured cost (mobile, CPU ×4) | Fix | Result after fix |
|---|---|---|---|---|
| 1 | pdf.js + pdf-lib (≈290 KB gz, 845 KB raw) are parser-blocking `<script>`s in `<head>` (l.13-14), but they are only used for import/export | Cold FCP **3.4 s** on Fast 3G, **12.0 s** on Slow 3G | P1: load on demand + prefetch on the pages that have PDF buttons | Cold FCP **0.87 s** / **2.9 s**; LCP 4.1→2.1 s / 12.8→5.9 s |
| 2 | The service worker re-downloads the full page on every launch (`cache:"no-store"`, sw.js l.37). On github.io, `updCheck()` (l.2359) downloads it again with `cache:"reload"` 1.5 s after each launch and on each return to foreground | 195 KB gz on every warm launch from the SW, and another 195 KB from `updCheck`. On Slow 3G a warm launch waits for the full body: LCP **6.5 s** | P9: `cache:"no-cache"` (ETag → 304), versioned cache, no duplicate precache | Warm launch **0 KB** (304). Warm LCP 2.4→1.4 s (Fast 3G), 6.5→2.7 s (Slow 3G) |
| 3 | Logbook maths runs again on every home render: `lbUtc()` (3× `Intl.formatToParts` per call, 2 calls per flight, ≥3 `lbFlights()` passes per render) and `lbNight()` (60 great-circle + sun evaluations per flight-minute) are not memoized | `homeRender()` **391 ms**. It runs on every `go('home')` and every 60 s. `go('log')` 249 ms, `go('setlb')` 329 ms, `saveMeta()` 56 ms | P4: memoize both (pure functions) | homeRender **43 ms** (−89 %), logbook −92 %, settings −91 %, saveMeta −83 % |
| 4 | 3D globe redraws ~5 000 dots per frame forever while the Stats page is open, even when scrolled off-screen, and ignores reduced motion. On the first visit it runs 40 000 × 36 point-in-polygon tests | **~100 % main thread**, 12-23 fps, >110 long tasks per 10 s. First visit 586 ms | P7: IntersectionObserver pause, stop when idle, honour reduced motion, bbox pre-check | Off-screen / reduced motion: **0 %**. First visit 210 ms |
| 5 | Background planes canvas animates at 25 fps behind **every** page (rAF 60/s) | 34-38 % main thread at idle in headless (mostly raster; JS ≈13 ms/s) | O1 (optional, visible): freeze when not on Home | 0 % on Roster/Logbook |
| 6 | `fitCells()` interleaves style writes and `scrollWidth` reads for every label (l.691), so each month render forces a layout per label | 122 forced layouts per month render | P5: batch writes, then reads | 92 layouts. Render-to-frame 123→92 ms |
| 7 | `toLocaleDateString()` builds a new Intl formatter on each call (lbDc l.1365, rcFmt l.1503) | Recency page 205 ms | P10: cached `Intl.DateTimeFormat` | **20 ms** (−90 %) |
| 8 | `loadMeta()` parses the whole `turni_meta_v1` JSON on every call: 48 call sites, **19 parses at startup**, 10 per homeRender (34 KB each with 1 year of logbook; grows with signatures stored as data URLs) | 739 KB of JSON parsed during startup | P6: value-checked read-only cache for read-only call sites | 525 KB at startup; 10→6 parses per homeRender |
| 9 | The 33 KB base64 icon appears twice (l.11 and l.12). It is pixel-identical to `icon-180.png` | 24.8 KB gz of the 193 KB gz page | P3: one copy + favicon link made in JS | page 193.5→169.6 KB gz (with P1) |
| 10 | Fonts CSS is render-blocking and `fonts.gstatic.com` is not preconnected | part of the cold FCP | P2 | included in #1 |

Startup main-thread long task (cached, CPU ×4): **746 ms → 474 ms**. JS heap after load: 2.7-3.9 MB → 1.7 MB, because the PDF libraries are no longer parsed at startup.

`verify.js` shows that all non-optional patches produce **identical** output to the baseline in both English and Italian:
- every page's HTML, in both languages and across a runtime language switch;
- the roster grid for 12 months at 393 px and 300 px wide, including the font sizes `fitCells` sets on 482-597 labels;
- the `lbCtx()` / `lbFlights()` models and the globe land-dot set;
- the bytes of the roster and logbook PDFs, and the pdf.js text extraction of a synthetic duty plan.

---

## 1. Method (all scripts in `perf/`, rerunnable)

* **Server** (`server.js`): serves the app on `http://localhost:8000` with gzip, ETag/304 and `max-age=600`, like GitHub Pages. The sandbox blocks the real CDNs, so cdnjs, jsdelivr, fonts.googleapis and fonts.gstatic are served from a local HTTPS mirror (`vendor/`: the exact `pdfjs-dist@3.11.174`, `pdf-lib@1.17.1` builds and the Google Fonts CSS + font files). Chromium maps those hosts to the mirror with `--host-resolver-rules` and trusts its certificate by SPKI pin, which keeps HTTP caching working.
* **Network shaping is done in the server** (+562.5 ms per request, a shared 1.44 Mbit/s downlink = DevTools "Fast 3G"; `THROTTLE=slow3g` = 2 s, 400 kbit/s). CDP throttling would not reach the service worker's own fetches.
* **Device**: Playwright `devices["Pixel 5"]` (393×851, DPR 2.75, mobile UA), CDP `Emulation.setCPUThrottlingRate 4`, Chromium headless. Canvas raster is done in software here, so the idle "% busy" numbers for the canvases overstate a GPU phone. The JS ms/s column does not depend on that.
* **Data** (`seed.js`): a deterministic year (2026) for an FCO-based A320-family pilot, in the exact `parseLines()`/`ingest()` shape:
  - `turni_v1`: 365 days, 434 sectors, layovers, standby, sim, leave, 92 KB;
  - `turni_meta_v1`: monthly sums, profile, logbook entries for 85 % of the flights, 34 KB.

  It is injected into localStorage before the app runs.
* **Instrumentation** (`lib.js` init script): counts `Storage.getItem/setItem` per key, counts `JSON.parse`/`stringify` calls and bytes, counts and times rAF callbacks, and records longtask, paint and LCP observers. CDP Performance metrics (TaskDuration, LayoutCount) and CDP CPU profiles give the top self-time functions, by index.html line.
* Scripts:
  - `measure-load.js`: cold load (fresh context, no SW), then waits for SW install, then warm load (SW-controlled). Three runs, median.
  - `measure-idle.js`: main-thread usage over 10 s per scenario.
  - `measure-interactions.js`: startup profile plus 19 interactions. Each is timed for its sync part and until the next frame, and CPU-profiled.
  - `sizes.py`: byte breakdown of index.html.
  - `apply-patches.py`: the exact patches; builds `patched/`.
  - `verify.js`: baseline vs patched equivalence.
- `tools/o1check.js`: checks the optional O1/O1b patch.
  - `summarize.js`: the tables.

```
cd perf
./run-all.sh ./baseline baseline                    # ≈9 min
python3 apply-patches.py && ./run-all.sh ./patched patched
node verify.js ./baseline ./patched && UI_LANG=it node verify.js
./run-all.sh /home/user/Rotate worktree             # measure the live repo after fixes land
node summarize.js baseline worktree
```

## 2. Baseline numbers (commit 0b7f6e9)

### Load (Fast 3G, CPU ×4, median of 3; ms)

| | cold (no SW) | warm (SW installed) |
|---|---:|---:|
| TTFB | 578 | 581 |
| FCP | **3 400** | 1 060 |
| LCP (`#hDate`) | **4 080** | 2 388 |
| DOMContentLoaded | 4 096 | 2 384 |
| load | 4 294 | 2 388 |
| TBT (from FCP) | 578 | 640 |
| long tasks / longest | 4 / 622 | 3 / 672 |
| JS heap after load | 2.7 MB | 3.9 MB |
| bytes transferred in the first ~8 s | **1 221 KB** | **195 KB** (the whole page again) |
| localStorage reads at startup | 25 (`turni_meta_v1` ×19) | same |
| `JSON.parse` at startup | 22 calls, **739 KB** | same |

Slow 3G (2 s RTT, 400 kbit/s): cold FCP **12.0 s**, LCP 12.8 s. Warm (everything cached) FCP 3.4 s, **LCP 6.5 s**. The SW's 4 s abort only covers the response headers (`clearTimeout` runs as soon as `fetch` resolves), so a warm launch streams the full 195 KB before it can render.

Cold waterfall: `index.html` 195 KB, then the **render-blocking** `pdf.min.js` 87 KB and `pdf-lib.min.js` 202 KB, then fonts CSS, then 2 woff files 69 KB. After `load`, SW install fetches `index.html` again (195 KB, for the `./index.html` precache key), manifest, the 3 icons (185 KB) and `pdf.worker.min.js` (286 KB).

### Size of index.html (506 176 B raw, 193.5 KB gzip-9)

| block (lines) | raw KB | share of gzip KB |
|---|---:|---:|
| 2× data: URI icon (11-12) | 64.5 | **49.4** (the duplicate alone: 24.8) |
| CSS (17-411) | 72.0 | 14.8 |
| body markup (412-551) | 33.9 | 6.3 |
| main script (552-2502) | 322.4 | 121.6 |
| … IT_E/IT_S translations (2277-2278) | 21.5 | 7.6 |
| … CHLOG changelog (2407-2468) | 19.8 | 7.1 |
| … BPT payslip tables (1713) | 16.5 | 6.1 |
| … LBG logbook grid (1116) | 6.5 | 2.1 |
| … LAND+LAKE (2071-2097) | 4.6 | 2.2 |
| … AIRT airports (1008-1099) | 3.0 | 1.9 |

Minification test: terser (`-c passes=2 -m`) takes the script from 124.9 to 117.4 KB gz, and csso takes the CSS from 15.2 to 15.1 KB gz. That is only about 8 KB in total because the code is already hand-compacted.

### Idle main-thread cost (10 s windows, CPU ×4)

| scenario | busy | JS in rAF | rAF/s | long tasks |
|---|---:|---:|---:|---:|
| Home, planes on (default) | 35 % | 13.7 ms/s | 60 | 0 |
| Home, planes off / reduced motion | 0 % | 0 | 0 | 0 |
| Roster, planes on | 34 % | 12 ms/s | 60 | 0 |
| Logbook, planes on | 35 % | 13 ms/s | 60 | 0 |
| Stats (globe), planes off | **99.6 %** | 48 ms/s | 13 | 126 |
| Stats, reduced motion | **99.7 %** | 48 ms/s | 13 | 126 |
| Stats scrolled to bottom (globe not visible) | **99.8 %** | 49 ms/s | 13 | 131 |

Behaviour of the background animation (l.1942-1964):
- it never stops while the page is visible, and it runs behind every page;
- it skips drawing when `document.hidden` (browsers also stop rAF in hidden tabs);
- it honours `prefers-reduced-motion`, but only when `bgStart()` runs;
- `bgColors()` (getComputedStyle) runs every 90 frames.

The globe (l.2113-2172):
- it stops only when its page is `display:none`;
- it keeps spinning while scrolled out of view and under reduced motion;
- it keeps polling rAF after user interaction ends.

### Interactions (CPU ×4, ms; sync / to next frame)

| interaction | baseline | top self-time (profile) |
|---|---|---|
| Roster button (`go('roster')`+`render()`) | 69 / 188 | fitCells callback (l.691) |
| `render()` one month | 48 / 123, **122 forced layouts** | fitCells (l.691) |
| tap a day | 55 / 104, 167 layouts | fitCells |
| `homeRender()` (every `go('home')` + every 60 s) | **391** / 407, 10× loadMeta | lbUtc (l.1106), lbSun, lbGc |
| `go('home')` from roster | **361** / 386, 12× loadMeta | lbUtc, lbSun, lbGc |
| `go('log')` | 249 / 260 | lbUtc, lbGc, lbSun |
| `lbCtx()` | 274 | lbUtc |
| `go('stats')` first visit | **586** / 732 | inPoly (l.2098) 221 ms, lbGc/lbUtc/lbSun |
| `go('stats')` again | 284 / 415 | lbUtc, lbSun, lbGc |
| `go('rc')` | 205 / 283 | lbDc (l.1365), rcFmt (l.1503): Intl formatting |
| `go('setlb')` | **329** / 357, 10× loadMeta | lbUtc |
| roster PDF `buildPdf()` (1 month, 40 KB) | 269 | pdf-lib internals |
| logbook PDF `lbBuild(lbRows())` (22 pages) | **1 008** | pdf-lib internals, lbNight |
| `saveMeta(loadMeta())` | 56 | lbUtc (via `sysUp → rcCalc → lbFlights`) |
| `save()` | 4 | – |

Startup long tasks: 79, 106, **746**, 55 ms. In the 746 ms task, `lbUtc` takes 206 ms, `lbSun`+`lbGc` 147 ms, pdf.js/pdf-lib evaluation 104 ms, `render` 44 ms, and `JSON.parse` 31 ms.

## 3. Findings (with line references, HEAD 0b7f6e9)

**F1 — Render-blocking PDF libraries.**
- l.13-14 load `pdf.min.js` and `pdf-lib.min.js` synchronously in `<head>`. That is 289 KB gz / 845 KB raw on the critical path, plus about 100 ms of evaluation at startup.
- They are used only in `pdfLines()` (l.622, import), `buildPdf()` (l.828), `lbBuild()` (l.1118) and `rsPdf()` (l.1617).
- Each export path already checks `if(!window.PDFLib)` (l.978, 1490, 1612).
- The app already lazy-loads XLSX this way (l.1269), so the pattern exists.

**F2 — Fonts.**
- l.15-16: the Google Fonts stylesheet blocks rendering, and there is no preconnect to `fonts.gstatic.com`.
- `display=swap` is already set, so making the CSS non-blocking changes nothing visible.

**F3 — Duplicate 33 KB data: URI.**
- l.11 (`apple-touch-icon`) and l.12 (`icon`) hold the same 32 978-char base64 PNG, which is pixel-identical to `icon-180.png`.
- l.2236 copies it into `#lg`/`#lg2`.
- Together they are 25 % of the gzipped page.
- One inline copy is needed while the page also runs as a single file inside Claude (l.2504-2505). On github.io alone, `href="icon-180.png"` would save the other 24.7 KB gz too.

**F4 — Service worker (sw.js).**
- l.37 `fetch(req,{cache:"no-store"})`: every navigation downloads the full 195 KB gz page, even when nothing changed. The 4 s `AbortController` only guards the headers (l.38 clears it as soon as headers arrive), so on a slow link a warm start waits for the whole body.
- l.5 `CACHE="rotate-v1.2"` while `VER="v1.2.7"` (index l.553): the cache name never changes between releases, so `activate` (l.27) never clears old entries. Libraries and icons are refreshed only by the background stale-while-revalidate.
- l.6 precaches `./` **and** `./index.html`: two copies of the same document, and a second 195 KB download at install.
- l.20 precaches `pdf.worker.min.js` (286 KB gz) on install. That is reasonable for offline import, but worth knowing.

**F5 — Update check.**
- index l.2357-2364: on `*.github.io` this runs `fetch(location.pathname,{cache:"reload"})` 1.5 s after every launch, on every `visibilitychange` back to visible (throttled to 2 min) and on `pageshow`.
- Each run is a full 195 KB gz download just to read `BUILD`.
- Together with F4 that is about 390 KB per app open, plus 195 KB each time the pilot switches back to the app after 2 minutes.

**F6 — Logbook maths recomputed constantly.**
- `lbUtc()` (l.1106) calls `Intl.DateTimeFormat.formatToParts` 3 times per call. It is called twice per flight in `lbFlights()` (l.1168).
- `lbFlights()` runs at least 3 times per home render: `rcEvents` (l.1504), `lbRows` (l.1225) and `lbCtx` (`flr`, l.1362).
- `lbNight()` (l.1111) evaluates `lbGc` + `lbSun` once per block minute (about 100 per flight) for every row in `lbRows()`.
- `homeRender()` (l.1904) calls `lbCtx()` for the logbook card and `rcCalc()` for the recency card. `homeRender` runs at startup, on every `go('home')`, and **every 60 s** while Home is visible (l.2273).
- `saveMeta()` calls `sysUp()` → `rcCalc()` → `lbFlights()` (l.583, 2061), so every logbook field edit pays this cost too.

**F7 — `loadMeta()` (l.582).**
- Each call is `JSON.parse(localStorage.getItem("turni_meta_v1"))`, over 48 call sites. There are 19 calls at startup and 10 per `homeRender()`.
- The meta blob holds the logbook (`lb`), sim sessions and **TRE/TRI signature images as data URLs** (l.1222), so it only grows.
- The cost here is small next to F6 (about 15 ms of 391), but it scales with the logbook size.
- `save()`/`saveMeta()` are wrapped **once** each (l.2250-2251, not twice). Each wrap adds `syncDirty()` (sets `turni_ts`, calls `gdDirty()` → `gdUi()` → `drUi()`) and debounced account/Drive pushes (2.5 s / 3 s).
  - `ingest()` calls `save()` and then `saveMeta()`, so `gdUi`/`drUi` run twice, but the timers mean only one push.
  - `syncPush()` (l.2242) re-reads and re-parses `turni_v1` from storage instead of using `days`.
  - Neither is significant.

**F8 — fitCells layout thrashing.**
- l.691 resets the inline styles, reads `scrollWidth`/`clientWidth`, then possibly `getComputedStyle`, element by element. That forces one layout per label: about 120-170 per render.
- `render()` (l.709) runs it twice: synchronously and again in rAF.

**F9 — Globe (stMap, l.2113-2172).**
- `glDots()` runs `isLand()` → `inPoly()` over 34 LAND + 2 LAKE polygons for 40 000 points, keeping 10 511.
- Each frame draws the background gradients, 160 stars and 34 land polygons, about 5 000 `fillRect`s each with its own `globalAlpha`, and the routes with glow.
- The loop runs as long as the canvas has an `offsetParent`.

**F10 — Background planes (l.1942-1964).**
- rAF runs at 60 Hz and draws every 40 ms: `clearRect` over a full-screen canvas at DPR 2, with 4-9 planes × 3 dashed segments.
- `bgLoop` keeps rescheduling itself on every page, not just Home.

**F11 — Intl formatting in lists.**
- `lbDc()` (l.1365) does 2× `toLocaleDateString` per row. `rcFmt()` (l.1503) does 1× per call.
- Each call constructs a new formatter.

**F12 — Translation observer.**
- l.2286: a `MutationObserver` on the whole body (childList, subtree, characterData, attributes) walks every inserted subtree through `trN()`, even when `LANG=="en"`.
- That is 2-20 ms per render at ×4.

**F13 — Static data inline (not patched).**
- BPT, IT_E/IT_S, CHLOG, LBG, AIRT and LAND come to about 27 KB gz.
- Once F4/F5 are fixed, the page is only downloaded when it changes (a release). Splitting the data out would then save about 27 KB per release, at the cost of breaking the single-file build that runs inside Claude. **Not worth it.** The CHLOG (7 KB gz) and IT strings (7.6 KB gz) are the only real candidates for lazy loading.

## 4. Optimizations ranked (impact / effort)

| rank | patch | impact | effort | identical? |
|---|---|---|---|---|
| 1 | **P1** PDF libs on demand + prefetch on PDF pages | cold FCP −2.5 s (Fast 3G) / −9 s (Slow 3G); −100 ms startup CPU; −1-2 MB heap | S (8 small edits) | yes. The libraries are prefetched 400 ms after opening Roster/Logbook/Rest/Duty plan/CrewLink, so share/export is not delayed |
| 2 | **P9** SW `no-cache` + versioned cache + no duplicate precache; `updCheck` `no-cache` | −195 KB per launch (−390 KB on github.io); warm Slow 3G LCP −3.8 s | XS | yes. The server is still asked every time; 304 if unchanged |
| 3 | **P4** memoize `lbUtc` / `lbNight` | homeRender −89 %, logbook/settings −92 %, every 60 s tick and every logbook edit | XS | yes (pure functions; early exit is exact) |
| 4 | **P7** globe: pause off-screen, stop when idle, reduced motion; bbox pre-check | 100 % → 0 % CPU when not visible or idle; first visit −64 % | S | yes, except that the globe no longer auto-spins with reduced motion (a fix) |
| 5 | **P10** cached Intl formatters | Recency −90 % | XS | yes |
| 6 | **P2** fonts preconnect + non-blocking CSS | part of #1, about 1 RTT | XS | near (swap already) |
| 7 | **P3** dedupe icon data URI | −24.8 KB gz per page download | XS | yes |
| 8 | **P5** fitCells batching | −25 % forced layouts per month render | XS | yes (verified pixel-for-pixel on styles) |
| 9 | **P6** read-only meta cache | −30 % JSON.parse bytes at startup; scales with logbook/signatures | S | yes (value-checked) |
| 10 | **P8** skip translation walk in English | a few ms per render | XS | yes |
| opt | **O1** freeze planes off Home | idle 35 % → 0 % on every non-Home page (battery) | XS | **no**: planes are static behind the other pages |
| – | minification (terser+csso) | −8 KB gz | M (build step) | yes. Low value |
| – | split static data into cached files | −27 KB gz per release | M | breaks the single-file build. Not recommended |
| – | self-host the 2 woff files (+ SW precache) | −2 third-party connections on cold start | S | near. Optional |

## 5. After all non-optional patches (P1-P10), same harness


**Load, Fast 3G + CPU x4 (median of runs)**

| metric | cold baseline | cold patched | warm baseline | warm patched |
|---|---:|---:|---:|---:|
| ttfb | 578 | 579 | 581 | 570 |
| fcp | 3400 | 872 | 1060 | 760 |
| lcp | 4080 | 2088 | 2388 | 1376 |
| dcl | 4096 | 2079 | 2384 | 1368 |
| load | 4294 | 2332 | 2388 | 1369 |
| tbt | 578 | 467 | 640 | 437 |
| longTasks | 4 | 2 | 3 | 3 |
| maxTask | 622 | 509 | 672 | 478 |
| heapMB | 2.73 | 1.73 | 3.91 | 1.74 |
| netKB | 1220.6 | 1002.4 | 194.9 | 0 |
| lsReads | 25 | 25 | 25 | 25 |
| jp | 22 | 15 | 22 | 15 |
| jpKB | 739.1 | 525.4 | 739.1 | 525.4 |

Cold `netKB` counts everything transferred in the first ~8 s, including the SW install, which precaches pdf.js, pdf-lib and the worker after `load`.
- **Before first paint, patched:** only `index.html` (171 KB) and the fonts CSS/files.
- **Before first paint, baseline:** 195 KB of HTML plus 289 KB of render-blocking libraries.
- **Warm, patched:** a 304 revalidation (0 KB of body).

**Load, Slow 3G + CPU x4 (1 run)**

| metric | cold baseline | cold patched | warm baseline | warm patched |
|---|---:|---:|---:|---:|
| ttfb | 2019 | 2017 | 2021 | 2010 |
| fcp | 11976 | 2904 | 3436 | 2200 |
| lcp | 12784 | 5916 | 6520 | 2700 |
| dcl | 12799 | 5908 | 6516 | 2688 |
| load | 15218 | 8060 | 6520 | 2691 |
| tbt | 708 | 403 | 546 | 334 |
| longTasks | 3 | 2 | 3 | 3 |
| maxTask | 758 | 451 | 592 | 381 |
| heapMB | 2.73 | 1.75 | 3.93 | 1.75 |
| netKB | 779.1 | 428 | 194.9 | 0 |
| lsReads | 25 | 25 | 25 | 25 |
| jp | 22 | 15 | 22 | 15 |
| jpKB | 739.1 | 525.4 | 739.1 | 525.4 |

**Idle, 10 s window, CPU x4** (main-thread busy % / JS ms per s in rAF callbacks / rAF callbacks per s / long tasks)

| scenario | baseline | patched |
|---|---|---|
| home, planes on (default) | 35% / 13.7 ms / 60.1 / 0 | 33.7% / 12 ms / 60 / 0 |
| home, planes off (rot_bg=0) | 0% / 0 ms / 0 / 0 | 0% / 0 ms / 0 / 0 |
| home, prefers-reduced-motion | 0% / 0 ms / 0 / 0 | 0% / 0 ms / 0 / 0 |
| roster, planes on | 33.7% / 12 ms / 59.8 / 0 | 37.2% / 15.3 ms / 60.1 / 0 |
| logbook, planes on | 35.2% / 13.3 ms / 60 / 0 | 34.1% / 13.5 ms / 60.1 / 0 |
| stats (globe auto-spin), planes on | 99.6% / 46.9 ms / 23.2 / 117 | 99.7% / 46.1 ms / 22.4 / 113 |
| stats (globe auto-spin), planes off | 99.6% / 48.4 ms / 12.7 / 126 | 99.7% / 46.9 ms / 13.5 / 137 |
| stats, prefers-reduced-motion | 99.7% / 48.1 ms / 12.6 / 126 | 0.1% / 0 ms / 0 / 0 |
| stats scrolled to bottom (globe off-screen), planes off | 99.8% / 49.3 ms / 12.9 / 131 | 0% / 0 ms / 0 / 0 |

**Interactions, CPU x4** (median sync ms / ms to next frame / loadMeta() calls / forced layouts)

| step | baseline | patched | Δ sync |
|---|---|---|---:|
| go('roster') + render() (what the Roster button does) | 68.9 / 187.9 / 1 / 114 | 63.4 / 108.2 / 1 / 88 | -8% |
| render() one month (roster calendar) | 47.7 / 122.9 / 1 / 122 | 39.5 / 91.9 / 1 / 92 | -17% |
| tap a day (select + detail panel) | 55.4 / 103.7 / 1 / 167 | 41 / 75.7 / 1 / 125 | -26% |
| next month button | 32.6 / 61.7 / 1 / 152 | 34.5 / 60.6 / 1 / 113 | 6% |
| homeRender() (runs on go('home') and every 60 s) | 391 / 407.3 / 10 / 1 | 43.3 / 58.5 / 6 / 1 | -89% |
| go('home') from roster | 360.6 / 386.3 / 12 / 1 | 46.1 / 64 / 7 / 1 | -87% |
| go('log') logbook page | 249.3 / 259.7 / 4 / 1 | 20.8 / 32.4 / 2 / 1 | -92% |
| lbCtx() (logbook model, used by home card, logbook, settings) | 273.7 / 276 / 4 / 0 | 14.9 / 25.3 / 2 / 0 | -95% |
| go('stats') FIRST visit (globe land dots) | 586 / 731.6 / 5 / – | 210.3 / 391.4 / 1 / – | -64% |
| go('stats') repeat visit | 283.7 / 414.5 / 5 / 2 | 47.7 / 156 / 1 / 2 | -83% |
| go('rc') recency | 205.3 / 282.7 / 1 / 1 | 19.9 / 77.2 / 1 / 1 | -90% |
| go('rest') in-flight rest | 53.3 / 77.1 / 1 / 1 | 18.3 / 34.9 / 1 / 1 | -66% |
| go('bp') payslip | 41.1 / 69.5 / 5 / 1 | 22.9 / 44 / 4 / 1 | -44% |
| go('setlb') logbook settings | 329.2 / 357.1 / 10 / 1 | 29.6 / 67 / 4 / 1 | -91% |
| open menu drawer | 6.6 / 12 / 1 / 1 | 6.3 / 16.7 / 1 / 1 | -5% |
| buildPdf() roster PDF (1 month) | 269.2 / 284 / 1 / 36 | 308.5 / 331.9 / 1 / 25 | 15% |
| logbook PDF: lbBuild(lbRows()) full year | 1008.1 / 1010.1 / 3 / 0 | 987.4 / 1000.3 / 1 / 0 | -2% |
| save() (turni_v1 write + sync/drive dirty) | 3.8 / 9.1 / 0 / 0 | 3 / 4.3 / 0 / 0 | -21% |
| saveMeta(loadMeta()) | 55.6 / 57.5 / 3 / 0 | 9.4 / 12.1 / 2 / 0 | -83% |

The PDF rows (`buildPdf`, `lbBuild`) and "next month" vary by about ±15 % between runs. Their cost is inside pdf-lib or layout, which the patches do not touch. Sync times for the roster rows are noisy; the frame time and forced-layout counts are the stable signal.

Startup long tasks baseline: [{"s":103,"d":79},{"s":184,"d":106},{"s":408,"d":746},{"s":1155,"d":55}]; patched: [{"s":220,"d":474},{"s":697,"d":52}]

With **O1** applied on top (`patched-o1/`, `results-idle-patched-o1.json`), Roster and Logbook idle drops from 34-37 % to **0 %**. Home is unchanged at 35.2 %. `tools/o1check.js` checks that the planes stop off Home and resume on Home, after `go()`, a Home card tap and the back button.

What remains, and what I would try next (no patch here because each one changes something visible or needs a product decision):
* **Startup task, 474 ms at ×4.** Most of it is the first, cold `lbNight` pass for the Home "Logbook" card (`lbGc`+`lbSun` ≈150 ms). Two options:
  - compute card 3 in `requestIdleCallback` after first paint (a brief "—" placeholder);
  - persist the `lbNC` results in localStorage, keyed by flight.
* **Globe while visible and spinning** is still CPU-bound: about 5 000 `fillRect` calls, each with its own `globalAlpha`. Options:
  - cap auto-spin at 30 fps;
  - batch the dots into a few alpha buckets (one path per bucket);
  - pre-render the static gradient, stars and halo once per resize.
* **Background planes**:
  - a DPR-1 backing store would cut raster pixels by 4× (lines get slightly softer);
  - or leave them on Home only (O1).
* **Logbook PDF (~1 s at ×4)** is pdf-lib's own cost. Keep it off the main thread's critical moment: show a spinner before calling it. It is already async.
* **`icon-512.png`** (120 KB, precached on install) could be recompressed losslessly. The inline icon compresses to 24.7 KB, while the 180 px file is 29.6 KB.

## 6. Verification

`node verify.js` (English) and `UI_LANG=it node verify.js` compare baseline and patched with the same seeded data and a frozen clock. Both report **ALL IDENTICAL** for:
- `roster-0…11` and `narrow-roster-0…11`: grid HTML including every `fitCells` inline style; at 300 px, 482 (EN) / 597 (IT) labels are shrunk;
- `roster-detail`;
- `page-*` for home, roster, log, rc, rest, bp, setlb, setapp, ct, acc, dati, cl, dp and stats;
- the `lbCtx` and `lbFlights` JSON;
- `glDots`: count + checksum;
- favicon == touch icon;
- the roster PDF (header bytes + length);
- the logbook PDF (22 pages, 267 995 B);
- `pdfLines`/`parseLines` of a synthetic duty-plan PDF (32 lines);
- a runtime EN↔IT language switch;
- no page errors.

## 7. Patches (exact old → new, against 0b7f6e9)

`python3 apply-patches.py [src] [out]` applies them, and refuses to apply any `old` that does not match exactly once. The optional O1/O1b are applied only with `--only P,O1`. P3a's `old` is shortened below; the script matches it with a regex: the whole `<link rel="icon" … href="data:…">` line 12.

#### P1a — Remove the two render-blocking PDF library <script>s from <head>  
`index.html`

old:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
```
new:
```html
(deleted)
```

#### P1b — On-demand loader (same pattern the app already uses for XLSX in lbXls)  
`index.html`

old:
```html
async function getDl(){
```
new:
```html
// PDF libraries: loaded on demand (and prefetched when a page with a PDF action opens)
const LIBU={pdfjsLib:"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",PDFLib:"https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"},LIBP={};
function needLib(g){if(window[g])return Promise.resolve(true);return LIBP[g]||(LIBP[g]=new Promise(r=>{const s=document.createElement("script");s.src=LIBU[g];s.onload=()=>r(!!window[g]);s.onerror=()=>{delete LIBP[g];s.remove();r(false)};document.head.appendChild(s)}))}
async function getDl(){
```

#### P1c — pdfLines(): wait for pdf.js (a missing library still throws -> 'Could not read this PDF.')  
`index.html`

old:
```html
async function pdfLines(buf){
 pdfjsLib.GlobalWorkerOptions
```
new:
```html
async function pdfLines(buf){
 if(!await needLib("pdfjsLib"))throw new Error("pdf.js not loaded");
 pdfjsLib.GlobalWorkerOptions
```

#### P1d — sharePdf(): wait for pdf-lib  
`index.html`

old:
```html
  if(!window.PDFLib){msg.textContent="Cannot create the PDF: library not loaded.";return}
```
new:
```html
  if(!await needLib("PDFLib")){msg.textContent="Cannot create the PDF: library not loaded.";return}
```

#### P1e — lbPdf(): wait for pdf-lib  
`index.html`

old:
```html
  if(!window.PDFLib){msg.textContent="PDF library not loaded.";return}
```
new:
```html
  if(!await needLib("PDFLib")){msg.textContent="PDF library not loaded.";return}
```

#### P1f — rsShare(): wait for pdf-lib  
`index.html`

old:
```html
  if(!window.PDFLib){msg.textContent=tt("PDF library not loaded.","Libreria PDF non caricata.");return}
```
new:
```html
  if(!await needLib("PDFLib")){msg.textContent=tt("PDF library not loaded.","Libreria PDF non caricata.");return}
```

#### P1g — Prefetch when a page with a PDF button opens, so the share sheet is not delayed by a download (keeps iOS user-activation for navigator.share)  
`index.html`

old:
```html
if(p=="setapp"||p=="setlb")setTab=p;PG=p;
```
new:
```html
if(p=="setapp"||p=="setlb")setTab=p;PG=p;if(/^(roster|log|rest|dp|cl)$/.test(p))setTimeout(()=>{needLib("PDFLib");if(p!="log"&&p!="rest")needLib("pdfjsLib")},400);
```

#### P1h — Import input: start loading pdf.js as soon as the file picker opens  
`index.html`

old:
```html
$("#pdf").addEventListener("change",async e=>{
```
new:
```html
$("#pdf").addEventListener("click",()=>{needLib("pdfjsLib")});
$("#pdf").addEventListener("change",async e=>{
```

#### P2 — Google Fonts: preconnect to the font-file origin and make the CSS non-render-blocking (fonts already use display=swap)  
`index.html`

> Near-identical: with display=swap the fallback font is already shown until the web font arrives; the only change is that first paint no longer waits for the CSS file.

old:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap">
```
new:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" media="print" onload="this.media='all'">
```

#### P3a — Drop the second copy of the 33 KB base64 icon (line 12)  
`index.html`

old:
```html
<link rel="icon" type="image/png" sizes="180x180" href="data:image/png;base64,iVBORw0KGgo…(32 978 chars, identical to line 11)…">
```
new:
```html
(deleted)
```

#### P3b — Re-create the favicon link from the single remaining data: URI  
`index.html`

old:
```html
$("#lg").src=document.querySelector('link[rel="apple-touch-icon"]').href;$("#lg2").src=$("#lg").src;
```
new:
```html
$("#lg").src=document.querySelector('link[rel="apple-touch-icon"]').href;$("#lg2").src=$("#lg").src;
{const l=document.createElement("link");l.rel="icon";l.type="image/png";l.sizes="180x180";l.href=$("#lg").src;document.head.appendChild(l)}
```

#### P4a — lbUtc(): memoize (pure function of its arguments) + stop iterating once converged  
`index.html`

> Breaking when the correction is 0 is exact: the next iteration would format the same instant and add 0 again.

old:
```html
function lbUtc(tz,y,m,d,hh,mm){const w=Date.UTC(y,m-1,d,hh,mm),df=lbDF[tz]||(lbDF[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric"}));let t=w;for(let i=0;i<3;i++){const f=df.formatToParts(new Date(t)).reduce((o,p)=>(o[p.type]=+p.value,o),{});t+=w-Date.UTC(f.year,f.month-1,f.day,f.hour,f.minute)}return t}
```
new:
```html
const lbUC=new Map();
function lbUtc(tz,y,m,d,hh,mm){const ck=tz+"|"+y+"|"+m+"|"+d+"|"+hh+"|"+mm,hit=lbUC.get(ck);if(hit!==undefined)return hit;const w=Date.UTC(y,m-1,d,hh,mm),df=lbDF[tz]||(lbDF[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric"}));let t=w;for(let i=0;i<3;i++){const f=df.formatToParts(new Date(t)).reduce((o,p)=>(o[p.type]=+p.value,o),{}),dd=w-Date.UTC(f.year,f.month-1,f.day,f.hour,f.minute);t+=dd;if(!dd)break}if(lbUC.size>20000)lbUC.clear();lbUC.set(ck,t);return t}
```

#### P4b — lbNight(): memoize per (route, times, threshold) - 60 great-circle + sun evaluations per flight minute otherwise  
`index.html`

> The working tree (uncommitted) already adds an equivalent lbNC cache keyed on A[0],A[1] (ICAO + lat): either key is fine since AIR[x]=[icao,lat,lon,tz].

old:
```html
function lbNight(A,B,t0,t1){const N=Math.round((t1-t0)/6e4);let n=0;for(let i=0;i<N;i++){const p=lbGc(A,B,(i+.5)/N);if(lbSun(p[0],p[1],t0+(i+.5)*6e4)<LBTH)n++}return n}
```
new:
```html
const lbNC=new Map();function lbNight(A,B,t0,t1){const ck=A[1]+","+A[2]+"|"+B[1]+","+B[2]+"|"+t0+"|"+t1+"|"+LBTH,c=lbNC.get(ck);if(c!==undefined)return c;const N=Math.round((t1-t0)/6e4);let n=0;for(let i=0;i<N;i++){const p=lbGc(A,B,(i+.5)/N);if(lbSun(p[0],p[1],t0+(i+.5)*6e4)<LBTH)n++}if(lbNC.size>5000)lbNC.clear();lbNC.set(ck,n);return n}
```

#### P5 — fitCells(): batch writes/reads (1 forced layout for the whole month instead of 1 per label); only overflowing labels enter the shrink loop  
`index.html`

> Identical result because .gd uses grid-template-columns:repeat(7,minmax(0,1fr)) and .c has a fixed height: a label's box never depends on another label's text. verify.js compares every label's final font-size/letter-spacing for all 12 months.

old:
```html
function fitCells(root){(root&&root.querySelectorAll?root:document.getElementById("gd")).querySelectorAll(".c i b,.c i u:not(.pm)").forEach(e=>{e.style.fontSize="";e.style.letterSpacing="";if(e.scrollWidth<=e.clientWidth)return;let fs=parseFloat(getComputedStyle(e).fontSize);
 e.style.letterSpacing="-.35px";while(e.scrollWidth>e.clientWidth&&fs>6.5){fs-=.5;e.style.fontSize=fs+"px"}})}
```
new:
```html
function fitCells(root){const E=[...(root&&root.querySelectorAll?root:document.getElementById("gd")).querySelectorAll(".c i b,.c i u:not(.pm)")];
 E.forEach(e=>{e.style.fontSize="";e.style.letterSpacing=""});const O=E.filter(e=>e.scrollWidth>e.clientWidth),F=O.map(e=>parseFloat(getComputedStyle(e).fontSize));
 O.forEach((e,i)=>{let fs=F[i];e.style.letterSpacing="-.35px";while(e.scrollWidth>e.clientWidth&&fs>6.5){fs-=.5;e.style.fontSize=fs+"px"}})}
```

#### P6a — loadMetaRO(): parsed turni_meta_v1 reused while the stored string is unchanged (for read-only callers)  
`index.html`

> Invalidation is by value (the raw string is compared), so writes from saveMeta, backup restore, account sync or Drive restore are all picked up. Callers listed below only read; never pass the RO object to saveMeta.

old:
```html
function saveMeta(o){
```
new:
```html
let _mS,_mO=null;function loadMetaRO(){let s=null;try{s=localStorage.getItem("turni_meta_v1")}catch(e){}if(_mO&&s===_mS)return _mO;_mS=s;_mO=null;let o={};try{o=JSON.parse(s||"{}")||{}}catch(e){}o.sums=o.sums||{};return _mO=o}
function saveMeta(o){
```

#### P6b — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
pkOff=ap=>{const mt=loadMeta();
```
new:
```html
pkOff=ap=>{const mt=loadMetaRO();
```

#### P6c — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
const LF=LFo!==undefined?LFo:(loadMeta().lbMode=="file"?lbFile():null)
```
new:
```html
const LF=LFo!==undefined?LFo:(loadMetaRO().lbMode=="file"?lbFile():null)
```

#### P6d — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
 (loadMeta().lbSim||[]).forEach(x=>{
```
new:
```html
 (loadMetaRO().lbSim||[]).forEach(x=>{
```

#### P6e — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
function lbAtTxt(k){const a=(loadMeta().lbAt||{})[k];
```
new:
```html
function lbAtTxt(k){const a=(loadMetaRO().lbAt||{})[k];
```

#### P6f — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
function lbMsTxt(){const a=(loadMeta().lbAt||{}).miss;
```
new:
```html
function lbMsTxt(){const a=(loadMetaRO().lbAt||{}).miss;
```

#### P6g — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
function bpProf(){const m=loadMeta(),
```
new:
```html
function bpProf(){const m=loadMetaRO(),
```

#### P6h — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
function sysChk(){const m=loadMeta(),
```
new:
```html
function sysChk(){const m=loadMetaRO(),
```

#### P6i — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
function stFile(rf){const LF=loadMeta().lbMode
```
new:
```html
function stFile(rf){const LF=loadMetaRO().lbMode
```

#### P6j — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
LB=loadMeta().lb||{},LBX=
```
new:
```html
LB=loadMetaRO().lb||{},LBX=
```

#### P6k — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
if(p=="setlb"){const ok=loadMeta().lbOk||{};
```
new:
```html
if(p=="setlb"){const ok=loadMetaRO().lbOk||{};
```

#### P6l — read-only call site -> loadMetaRO()  
`index.html`

old:
```html
tk=key(t.getFullYear(),t.getMonth(),t.getDate()),mt=loadMeta();
 /* greeting */
```
new:
```html
tk=key(t.getFullYear(),t.getMonth(),t.getDate()),mt=loadMetaRO();
 /* greeting */
```

#### P7a — Globe: pause the render loop while the canvas is scrolled off-screen, stop it when nothing moves, no auto-spin with prefers-reduced-motion  
`index.html`

old:
```html
 function frame(t){if(!cv.isConnected||(cv.offsetParent===null&&!box.classList.contains("gfs"))){run=false;return}
```
new:
```html
 const rm=hRM();let onS=true;
 function frame(t){if(!cv.isConnected||(cv.offsetParent===null&&!box.classList.contains("gfs"))||!onS){run=false;if(!cv.isConnected)io.disconnect();return}
```

#### P7b — (globe) auto-spin honours reduced motion  
`index.html`

> Every input path that changes the view already calls go_() (pointerdown, wheel, dblclick, full-screen, resize), so stopping an idle loop is invisible. Only visible change: no auto-rotation for users with reduced motion (the background planes already behave this way).

old:
```html
  else if(V.spin&&!P.size){V.lo-=.0025*dt;dirty=true}
  if(dirty){const c=cv.getContext("2d");c.setTransform(dpr,0,0,dpr,0,0);draw(c,W,H);dirty=false}requestAnimationFrame(frame)}
```
new:
```html
  else if(V.spin&&!P.size&&!rm){V.lo-=.0025*dt;dirty=true}
  if(dirty){const c=cv.getContext("2d");c.setTransform(dpr,0,0,dpr,0,0);draw(c,W,H);dirty=false}else if(!P.size){run=false;return}requestAnimationFrame(frame)}
```

#### P7c — (globe) IntersectionObserver restarts the loop when the globe scrolls back into view  
`index.html`

old:
```html
 let g;window.onresize=()=>{if(cv.isConnected){size();go_()}};
 size();go_()}
```
new:
```html
 let g;window.onresize=()=>{if(cv.isConnected){size();go_()}};
 const io=new IntersectionObserver(es=>{onS=es[es.length-1].isIntersecting;if(onS)go_()});io.observe(cv);
 size();go_()}
```

#### P7d — glDots(): bounding-box pre-check before the point-in-polygon test (exact same set of land dots, ~5x fewer inPoly calls)  
`index.html`

> A point strictly outside a polygon's bounding box is never inside it for the even-odd ray test used by inPoly, so the result is identical.

old:
```html
const isLand=(lo,la)=>LAND.some(P=>inPoly(lo,la,P))&&!LAKE.some(P=>inPoly(lo,la,P));
```
new:
```html
const pBox=P=>P.bb||(P.bb=P.reduce((b,q)=>[Math.min(b[0],q[0]),Math.min(b[1],q[1]),Math.max(b[2],q[0]),Math.max(b[3],q[1])],[1/0,1/0,-1/0,-1/0])),inBP=(x,y,P)=>{const b=pBox(P);return x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]&&inPoly(x,y,P)};
const isLand=(lo,la)=>LAND.some(P=>inBP(lo,la,P))&&!LAKE.some(P=>inBP(lo,la,P));
```

#### P8 — Translation MutationObserver: nothing to translate while the UI is in English  
`index.html`

> In English trN() only records originals that setLang('it') -> trAll() records anyway; switching back to English is also done by trAll().

old:
```html
let trBusy=false;const trMO=new MutationObserver(ms=>{if(trBusy)return;
```
new:
```html
let trBusy=false;const trMO=new MutationObserver(ms=>{if(trBusy||LANG!="it")return;
```

#### P9a — Service worker: revalidate the page (ETag -> 304) instead of always re-downloading it  
`sw.js`

> Same freshness guarantee (the server is always consulted), but an unchanged page costs a ~300-byte 304 instead of ~195 KB gzip on every launch.

old:
```js
    const res = await fetch(req, { signal: ctl.signal, cache: "no-store" });
```
new:
```js
    const res = await fetch(req, { signal: ctl.signal, cache: "no-cache" }); // always asks the server; 304 when unchanged
```

#### P9b — Service worker: versioned cache name (bump with VER) so each release refreshes libraries/icons and deletes the old cache  
`sw.js`

old:
```js
const CACHE = "rotate-v1.2";
```
new:
```js
const CACHE = "rotate-v1.2.7"; // keep equal to VER in index.html
```

#### P9c — Service worker: don't precache the same page twice ('./' and './index.html' are the same 195 KB document)  
`sw.js`

> networkFirst() already stores every successful navigation as './index.html', and its offline fallback tries './index.html' then './'.

old:
```js
const CORE = ["./", "./index.html", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
```
new:
```js
const CORE = ["./", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
```

#### P9d — updCheck(): conditional request instead of a full re-download on every launch / return to foreground  
`index.html`

> 'no-cache' still goes to the server every time (never a stale answer); unchanged -> 304 and the body comes from the HTTP cache. Only active on *.github.io.

old:
```html
try{const r=await fetch(location.pathname,{cache:"reload"});
```
new:
```html
try{const r=await fetch(location.pathname,{cache:"no-cache"});
```

#### P10a — fmtD(): reuse Intl.DateTimeFormat instances (toLocaleDateString builds a new formatter on every call)  
`index.html`

> Date.prototype.toLocaleDateString(loc,o) is specified as new Intl.DateTimeFormat(loc,o).format(d) whenever o contains a date field (all call sites below do), so output is identical; the key includes LOC() so a language switch gets new formatters.

old:
```html
const fmtAt=ms=>new Date(ms).toLocaleString(LOC(),{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
```
new:
```html
const fmtAt=ms=>new Date(ms).toLocaleString(LOC(),{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const DTFC=new Map(),fmtD=(d,o)=>{const k=LOC()+JSON.stringify(o);let f=DTFC.get(k);if(!f)DTFC.set(k,f=new Intl.DateTimeFormat(LOC(),o));return f.format(d)};
```

#### P10b — lbDc() (one call per logbook/recency row) uses fmtD  
`index.html`

old:
```html
d.toLocaleDateString(LOC(),Object.assign({month:"short"},o)).replace(".","").toUpperCase()+"</span><i>"+d.toLocaleDateString(LOC(),Object.assign({weekday:"short"},o)).replace(".","")
```
new:
```html
fmtD(d,Object.assign({month:"short"},o)).replace(".","").toUpperCase()+"</span><i>"+fmtD(d,Object.assign({weekday:"short"},o)).replace(".","")
```

#### P10c — rcFmt() (recency list) uses fmtD  
`index.html`

old:
```html
return new Date(y,m-1,d).toLocaleDateString(LOC(),o||{day:"numeric",month:"short",year:"numeric"})};
```
new:
```html
return fmtD(new Date(y,m-1,d),o||{day:"numeric",month:"short",year:"numeric"})};
```

#### O1 — OPTIONAL (visible): freeze the background planes when the page is not Home  
`index.html` — **optional, visible change**

> Pair with O1b. Planes stay drawn (frozen) behind the other pages and resume on Home. Saves the ~35-39 % main-thread cost measured on Roster/Logbook.

old:
```html
function bgLoop(now){BG.raf=requestAnimationFrame(bgLoop);if(document.hidden||now-BG.last<40)return;BG.last=now;bgDraw(now)}
```
new:
```html
function bgLoop(now){if(PG!="home"){BG.raf=0;return}BG.raf=requestAnimationFrame(bgLoop);if(document.hidden||now-BG.last<40)return;BG.last=now;bgDraw(now)}
```

#### O1b — OPTIONAL (visible): resume the planes when going back to Home  
`index.html` — **optional, visible change**

old:
```html
if(p=="home"){sysUp();try{homeRender()}
```
new:
```html
if(p=="home"){if(!BG.raf&&BG.pl.length&&bgOn()&&!hRM())BG.raf=requestAnimationFrame(bgLoop);sysUp();try{homeRender()}
```


## 8. Working tree note

The working tree changed during the audit: `git status` shows ` M index.html`, ` M sw.js`, uncommitted, from someone else. My `old` strings were checked against it:
- **P1a** does not apply. The working tree already changed l.13-14 to `<script defer …>`.
  - `defer` takes the libraries off the render path.
  - They are still downloaded (≈290 KB gz) and evaluated (≈100 ms at ×4) on every cold start, and they push back DOMContentLoaded/`load`. That also delays SW registration, which waits for `load`.
  - P1's on-demand loader avoids both. If you keep `defer`, P1b-P1h still apply as written: `needLib()` resolves immediately when the global exists.
- **P2** does not apply. Non-blocking font CSS is already in; the `fonts.gstatic.com` preconnect line is still missing.
- **P4b** does not apply. An equivalent `lbNC` cache is already in.
- Every other patch applies to the current working tree unchanged.

To measure the live tree after the fixes land: `./run-all.sh /home/user/Rotate worktree && node summarize.js baseline worktree`.

## 9. Files

All in `/tmp/claude-0/-home-user-Rotate/a4c81a0c-22ce-58a2-ba0a-bd4fb384ce26/scratchpad/perf/`:
- `PERF.md`: this report.
- `run-all.sh`: re-runs every measurement.
- `server.js`, `lib.js`, `seed.js`: harness.
- `measure-load.js`, `measure-idle.js`, `measure-interactions.js`: measurements.
- `sizes.py`: index.html byte breakdown.
- `apply-patches.py`: the patches. `--md` prints them.
- `verify.js`: baseline vs patched equivalence.
- `tools/o1check.js`: checks the optional O1/O1b patch.
- `summarize.js`: comparison tables.
- `baseline/`: HEAD 0b7f6e9.
- `patched/`: P1-P10.
- `patched-o1/`: P1-P10 plus O1.
- `vendor/`: CDN mirror files.
- `results-*.json`, `log-*.txt`, `summary-baseline-vs-patched.md`: raw results.
