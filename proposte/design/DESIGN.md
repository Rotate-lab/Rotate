# Rotate: design review and visual direction

Reviewed build: v1.2.7 (`index.html`, "BOARDING PASS THEME (Beta 76)" layer on top of an iOS-Settings base).
Method: served the repo locally and captured every page with Playwright (iPhone 13; light and dark; EN and IT). The clock was frozen at Wed 25 Nov 2026 08:40 Europe/Rome. I seeded synthetic CrewLink data in `turni_v1` / `turni_meta_v1`: A350/A330 long-haul rotations JFK, BOS and HND with layovers, medium-haul ATH and CDG doubles, HSBY/ASBY standby, a SIB sim, RPM/GLS days off and FEN leave.
Screenshots of the current app: `shots/app/{light|dark}-{en|it}-{page}.png` (14 pages × 4).

---

## 1. Critique: what reads as "AI-generated"

The app is useful and dense where it matters. The roster grid and the rest calculator are real tools. The surface around them, though, is assembled from the default 2024–25 "modern app" kit. A pilot will not recognise their own world in it. Concretely:

**Typography**
- **Inter + Space Grotesk.** This is the most recognisable AI and startup pairing there is. Space Grotesk's display "1" has a flag and a foot, so it reads oddly inside times: in `12:05` and `74:10` the 1 looks like a different glyph from its neighbours (Home "Report 12:05", Roster summary). Its geometric quirks fight tabular data.
- Headline sizes run large (H1 26–30px, hero numbers 44–46px), while the information pilots scan most is small: times in calendar cells are 10px.
- There are no consistent typographic roles. The same weight and size mean a title in one place, a value in another and a button label in a third.

**Colour**
- **Too many hues.** The calendar uses green, light green, blue, light blue, orange, yellow, purple, indigo and pink (`dotOf`, `pill`). Stats adds an 8-colour iOS palette for the fleet bar and 8 coloured tiles for career totals. The payslip uses another 4. None of these colours carry a meaning the user learns once and reuses.
- **Generic accent.** The accent is `#1F5BD6` / `#7FA8FF` on navy `#0B2545`. That is the default fintech or SaaS blue. The iOS base (`#007aff`, `#34c759` …) still leaks through in places (`.sem.off #ff3b30`, `.brz`, `.mc i` gradient, `.av` gradient).
- **Red used for non-alarms.** The "System status" chip shows a red dot by default. In a cockpit, red means warning. Here it just means "not checked".

**Shape and elevation**
- Everything is a rounded white card with a soft shadow: radius 18–22px plus `--sh`. Home alone stacks **five card idioms**: the ticket card, the week chips, the CrewLink icon grid, the 2×2 stat tiles and the pill buttons. Uniform card grids are the clearest tell of a template.
- Floating circular icon buttons with shadows (`.hqb`, `.rbb`, `.mb`) are the "dribbble header".
- Gradient hero blocks (`.sh`, `.bph`, `.rsh`, `.clhero`; legacy `linear-gradient(135deg,#0a84ff,#5e5ce6,#bf5af2)`) and the radial "space" gradient behind the globe.
- Glassmorphism on the toast (`backdrop-filter: blur(18px) saturate(1.6)`) and on the globe buttons.

**Iconography**
- **iOS-Settings rounded-square gradient icons.** Inline `style="background:linear-gradient(180deg,#4da3ff,#1a73e8)"` appears on `.ic` in Settings, Backup and Duty plan. The theme then repaints some of them as pale-blue squircles. Two systems are visible at once.
- **Mixed styles.** There are filled glyphs in the calendar (bed, house, phone, palm tree, red cross), 2px stroke icons in the UI, a coloured letter badge (`IN`, `OUT`, `H`, `BR`, `SIM`, `✈︎`) in the day detail, the full-colour Google Drive logo, and a rainbow app icon.
- Emoji and dingbats stand in for icons: `✈︎`, `✓` (toast), `♥` (donate), `›` as a chevron, the palm tree for leave.

**Decoration**
- **Flying planes in the background** (`#bgsky`, on by default) behind every page. They read as decoration, not information, and the moving dotted routes compete with the real data.
- **The boarding-pass gimmick.** The next-flight card has perforation notches (`.nxp:before/:after`), a dashed tear line and a "NEXT FLIGHT" tab. Crew do not use boarding passes. A boarding pass is the *passenger's* artefact, so the metaphor points the wrong way. It is also not carried through: the logbook, rest calculator and payslip use unrelated navy hero blocks.
- The 3D globe is impressive and earned on Stats. Its "night sky" glow styling makes it look like a demo rather than a chart.

**Layout and copy**
- A centred hero on Logbook ("TOTAL FLIGHT TIME 66:00" on navy, then two big icon tiles and ~40% empty page) and on Backup (big Drive logo, centred).
- The greeting "Good morning, Marco" is consumer-app copy. A pilot opening the app at 04:30 wants the date, UTC and the report time.
- The chips "Online" and "System status" are given the same visual weight as the next duty.
- Copy mixes registers. "Not current" is OK. "Recency to restore" plus an orange paragraph that lists 13 flights is a wall. Labels use "Report" rather than **RPT**, and "Return" rather than **C/O**, which is the convention crew already read in CrewLink.
- **i18n gaps found on the IT screens**: calendar cell labels stay English ("Layover", "Rest", "Sim", "Sby", "Return"). "Stats", "Recency" and "Logbook" stay English on Home. CrewLink duty codes (RPM, GLS, HSBY, FEN) are language-neutral and would avoid this entirely.
- Dark mode is a navy-tinted copy of light mode (`#0E1626` / `#182338`), not a true night mode. Brightness at night is a real problem on the flight deck and in hotel rooms.

**What works and should be kept**
- **Information density of the roster grid.** Destination, flight number and report time in every cell is the right density for pilots. Keep it and make it calmer.
- The **in-flight rest calculator**: the timeline bar, hatched non-rest margins and the shift table are a genuine tool. It needs restyling only.
- Tabular numerals are already applied in many places (`font-variant-numeric:tabular-nums`). Local-time disclaimers in the footers are good.
- The day-detail drawer that opens inline under the week row is a good pattern.
- The payslip breakdown is clear: big net figure, stacked bar, itemised table.
- Correct domain content is used throughout (EASA 28d / 365d limits, PF/PM, FDP, layover nights, METAR/TAF briefing). The data is professional. Only the skin is not.

---

## 2. Three directions

Each direction keeps the existing structure and variable names, so it can be applied incrementally.

### A. "Ops Sheet": EFB / LIDO briefing package (RECOMMENDED)
The look of a printed OFP, a LIDO route manual page or a crew roster printout, combined with the restraint of an EFB app. It is paper-and-ink in daylight and a true black night mode. A single **magenta** signal colour, borrowed from the FMS/ND convention where magenta marks the *active* leg, highlights only "now / next / today".

| | Light | Dark |
|---|---|---|
| bg (paper) | `#F3F1EA` | `#0A0C0F` |
| card | `#FBFAF6` | `#121519` |
| empty / layover | `#EEEBE2` | `#0F1215` |
| sel | `#E9E5D9` | `#1B1F25` |
| sep (hairline) | `#D8D3C6` | `#262B32` |
| ink (tx) | `#15191E` | `#E7E5DF` |
| tx2 | `#5D6168` | `#8B9098` |
| **signal (magenta)** | `#B0127A` | `#FF5CC6` |
| normal (green) | `#2E7A4A` | `#4FD18B` |
| caution (amber) | `#A85F00` | `#F5A623` |
| warning (red) | `#B8322A` | `#FF5A4F` |
| info / sim (cyan) | `#0B7285` | `#3CC8DC` |

- **Type.**
  - **Barlow** (body). **Barlow Semi Condensed** (labels in tracked caps, headings, and all times with `font-variant-numeric: tabular-nums`, which Barlow supports).
  - **B612 Mono** for codes: IATA/ICAO, flight numbers, duty codes, phone numbers. B612 is the typeface Airbus commissioned for cockpit displays (open source, SIL OFL), so it is authentic rather than "techy".
  - Google Fonts: `family=B612+Mono:wght@400;700&family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700`. All three are SIL OFL and can be self-hosted.
  - Note: do **not** set times in a monospace font. Mono colons take a full cell (`12: 05`); I tested this and it looks broken. Use the condensed sans with tnum for times and mono for codes.
- **Spacing.** 4-pt scale: 4/8/12/16/24/32. 16px page gutter. Rows 44px minimum.
- **Radius.** 2px (chips and code boxes), 4px (cards, buttons), 8px (sheets only). Nothing above 8.
- **Elevation.** None. Use 1px hairlines (`--sep`) and a 1px ink rule above tables. A strong 1px `--tx` border marks the focused or open element. Remove `--sh`.
- **Iconography.** A single 1.6px stroke set with square caps, 20px, monochrome `--tx2` (Lucide or Tabler, restyled). No filled glyphs, no icon backgrounds, no emoji. In the calendar, **text codes replace icons**: `RPM`, `GLS`, `HSBY`, `L/O`, `C/O`, `SIB`, `FEN`.
- **Components.**
  - *Calendar cell.* A hairline grid with no gaps and no rounding. The date sits top-left in mono. Flight cells show the destination in 15px B612 Mono bold, the flight number and the report time `0855`, plus a 3px ink rule on the left. Layover cells use the `--empty` fill with the station in regular weight and `L/O`. Off days show only a muted code. Standby gets an amber rule with an amber code. Sim gets a dashed cyan rule. Leave gets the hatch fill. Today gets a 2px magenta inset outline and a magenta date, not a filled navy block.
  - *Duty card (day detail).* An OFP-style leg table. The left column is a 3-letter key (`RPT`, `FLT`, `HTL`, `C/O`). The middle shows the description with a mono sub-line. The right shows the time with UTC beneath (`12:05` / `11:05Z`). The footer reads `FDP 14:55 · FT 11:45 · EXT —`.
  - *Next-flight card.* A "flight strip": a magenta 4px left rule, `FCO → HND` in 38px mono with the block time on the arrow, then a 4-column time row `RPT | STD | STA | IN` (local over Z). The countdown is the only magenta value. A text action bar sits under it: `BRIEFING | WX · METAR/TAF | REST`. No notches, no perforation, no plane glyph.
  - *Lists.* Timetable rows: day in caps over the date number, description, and a right-aligned time with its key (`RPT`). A 1px ink rule sits on top of each table and hairlines between rows.
  - *Tabs.* A bottom bar with 4 tabs (Today / Roster / Logbook / Tools) and condensed caps labels. The active tab gets a 2px magenta bar on top. The segmented `LT | UTC` control is ink-inverted.
  - *Buttons.* Primary: ink fill, 4px radius, 600 condensed caps, letter-spacing .12em. Secondary: a 1px `--sep` outline. Text links: ink with a 1px underline, not blue.
- **Motion.** Functional only. Durations 120–160ms with `cubic-bezier(.2,0,0,1)`. No overshoot, scale-pop or bouncing toasts. Drawers slide, panels expand by height, and that is all. Disable the background planes.
- **Copy tone.** Ops voice: terse, codes first, no exclamation marks, no greetings. Examples: "Report in 3 h 25 min", "Recency LAPSED · 0/3 T/O · 0/3 LDG in 90 days", "13 entries missing PF/PM", "Local times as published in CrewLink". IT: "Presentazione tra 3 h 25 min", "Recency SCADUTA". Use ICAO/crew abbreviations (RPT, STD, STA, BLK, FDP, L/O, C/O, DH). Write dates as `WED 25 NOV` and times as `13:35` / `12:35Z`.

### B. "Glass Cockpit": PFD/ECAM night-first
Built dark-first like an ECAM/ND page, with a light mode that is a "daylight DU" variant. Colour follows Airbus display semantics strictly: **green** = normal / actual, **cyan** = selectable / editable (inputs, links), **amber** = caution, **red** = warning, **magenta** = managed / active, **white** = labels.

| | Light (daylight) | Dark (night) |
|---|---|---|
| bg | `#E8EAEC` | `#000000` |
| card | `#F7F8F9` | `#0D0F12` |
| sep | `#C9CDD2` | `#2A2F36` |
| tx / tx2 | `#0E1114` / `#5B636C` | `#F2F2F2` / `#8A929B` |
| green | `#13804A` | `#3BE37F` |
| cyan (ac) | `#007C99` | `#2FD9F5` |
| amber | `#B26B00` | `#FFAA00` |
| red | `#C12A1F` | `#FF3B30` |
| magenta | `#A3157D` | `#FF4FD8` |

- **Type.** **B612** for UI and **B612 Mono** for data (`family=B612:wght@400;700&family=B612+Mono:wght@400;700`). Labels are in all caps, 11px, tracked .08em. B612 has no tnum feature, so use B612 Mono for codes only and B612 regular for times (its digits are near-uniform), or accept the wide mono colon as part of the cockpit look.
- **Spacing and radius.** 4-pt scale. Radius 0–2px. Elevation: none. Boxes use 1px `--sep` "bezel" outlines.
- **Iconography.** Minimal symbology (triangles, chevrons, aircraft symbol as on the ND), 1.5px stroke, coloured only by state.
- **Components.** Calendar cells use black boxes with green actual times and cyan editable fields. Today is a magenta box. The duty card reads like an ECAM memo, for example `RPT ......... 12:05`. The next flight is laid out like an FMS F-PLN page (`FROM / TO / UTC / DIST`). Tabs look like soft-key labels. Buttons are outlined cyan, uppercase.
- **Motion.** None beyond instant state changes. A 2-second green-to-white "flash" on changed values (as the ECAM does) can confirm a save.
- **Copy.** Imperative and ECAM-like: "RECENCY ...... LAPSED", "LOGBOOK 13 ENTRIES TO COMPLETE".
- **Risk.** Very strong character, but a daytime app full of all-caps cockpit pastiche can tire users, and the colour semantics are strict to apply across payslip and stats.

### C. "Timetable": departure board and railway timetable
Warmth from Italian and Swiss timetable print and airport FIDS. It uses an off-white sheet, black rules, and a single **signal yellow** used as the highlighted-row marker, as on departure boards. It offers a split-flap treatment *only* for the next-flight time.

| | Light | Dark |
|---|---|---|
| bg | `#FFFFFF` | `#111111` |
| card | `#FAFAF7` | `#1A1A1A` |
| sep | `#DADADA` | `#2E2E2E` |
| tx / tx2 | `#111111` / `#666666` | `#F2F2F2` / `#9A9A9A` |
| signal (yellow) | `#FFD400` (fill, with ink text) | `#FFD400` |
| caution | `#C25E00` | `#FF9F1C` |
| warning | `#C62828` | `#FF5A4F` |

- **Type.** **IBM Plex Sans Condensed** (labels, headings), **IBM Plex Sans** (body), **IBM Plex Mono** (codes). Times use Plex Sans Condensed with tnum. Google Fonts: `family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500`.
- **Spacing and radius.** 4-pt scale, generous 12px row padding. Radius 0. Elevation: none. Heavy 2px top rules for tables.
- **Iconography.** Pictograms in the style of airport wayfinding (Otl Aicher-like), solid, monochrome.
- **Components.** The calendar is a month timetable *list* (one row per day) with an optional grid toggle. Today is a yellow row. The next flight looks like a FIDS row: `13:35  AZ 784  TOKYO HANEDA  GATE —  RPT 12:05`. Tabs are underlined text. Buttons are black slabs with white text.
- **Motion.** A split-flap roll only when the countdown or next flight changes (≤300ms, honour reduced motion). Nothing else moves.
- **Copy.** Timetable terse: "Partenza 13:35", "Presentazione 12:05".
- **Risk.** The split-flap motif becomes the next gimmick if it spreads. Yellow-on-white fails contrast unless it is only used as a fill behind ink.

### Recommendation: **A. Ops Sheet**
- It is the closest to the material pilots already read daily: CrewLink PDFs, OFPs and LIDO charts. Codes and UTC/LT pairs become first-class instead of being decorated away.
- One signal colour (magenta for "now / next / today") ends the 9-hue calendar while still meaning something to a pilot.
- B612 is a real piece of aviation heritage, not a trend font. Paired with Barlow it stays readable at body sizes. Option B would be B612-only and harder to read.
- It is the cheapest to adopt. It is almost entirely a token swap plus de-decoration of existing selectors, with no layout rewrite needed for the first two phases.
- It gives a real night mode (true black) without the full cockpit pastiche of option B.

Mockup: `mockup.html` (Home and Roster, 390px, light and dark via `prefers-color-scheme`).
Screenshots: `shots/mockup-{home|roster}-{light|dark}.png`.
A token-only preview applied to the live app is in `shots/tokens-only-{home|roster}-{light|dark}.png`. It shows the token swap alone already removes the blue/navy look without breaking anything.

---

## 3. Drop-in token block (maps to existing variable names)

This is the file `tokens.css`. Paste it at the **end** of `<style>`, after the BOARDING PASS block, because that block redefines `:root` later in the file. It covers the same `.gd` override selectors the app uses.

```css
:root,:root[data-theme="light"] .gd{
 --bg:#F3F1EA;--card:#FBFAF6;--empty:#EEEBE2;--sel:#E9E5D9;--sep:#D8D3C6;--tx:#15191E;--tx2:#5D6168;
 --ac:#B0127A;--sig:#B0127A;
 --grn:#2E7A4A;--lgrn:#2E7A4A;--org:#A85F00;--yel:#A85F00;--red:#B8322A;--pink:#B8322A;
 --lb:#0B7285;--mint:#0B7285;--ind:#0B7285;--blue:#15191E;--pur:#5D6168;
 --pri:#15191E;--prit:#FBFAF6;--hero:#15191E;--sh:none;--tint:10%;
 --hatch:repeating-linear-gradient(135deg,color-mix(in srgb,var(--tx2) 22%,transparent) 0 1px,transparent 1px 6px);
 --fb:Barlow,-apple-system,"SF Pro Text",system-ui,sans-serif;
 --ff:"Barlow Semi Condensed",Barlow,-apple-system,system-ui,sans-serif;
 --fm:"B612 Mono",ui-monospace,Menlo,monospace;
 --r1:2px;--r2:4px;--r3:8px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;
 --dur:140ms;--ease:cubic-bezier(.2,0,0,1);
}
@media (prefers-color-scheme:dark){
 :root:not([data-theme="light"]),:root:not([data-theme="light"]) .gd{
  --bg:#0A0C0F;--card:#121519;--empty:#0F1215;--sel:#1B1F25;--sep:#262B32;--tx:#E7E5DF;--tx2:#8B9098;
  --ac:#FF5CC6;--sig:#FF5CC6;--grn:#4FD18B;--lgrn:#4FD18B;--org:#F5A623;--yel:#F5A623;--red:#FF5A4F;--pink:#FF5A4F;
  --lb:#3CC8DC;--mint:#3CC8DC;--ind:#3CC8DC;--blue:#E7E5DF;--pur:#8B9098;
  --pri:#E7E5DF;--prit:#0A0C0F;--hero:#121519;--sh:none;--tint:14%;color-scheme:dark}}
:root[data-theme="dark"],:root[data-theme="dark"] .gd{
 --bg:#0A0C0F;--card:#121519;--empty:#0F1215;--sel:#1B1F25;--sep:#262B32;--tx:#E7E5DF;--tx2:#8B9098;
 --ac:#FF5CC6;--sig:#FF5CC6;--grn:#4FD18B;--lgrn:#4FD18B;--org:#F5A623;--yel:#F5A623;--red:#FF5A4F;--pink:#FF5A4F;
 --lb:#3CC8DC;--mint:#3CC8DC;--ind:#3CC8DC;--blue:#E7E5DF;--pur:#8B9098;
 --pri:#E7E5DF;--prit:#0A0C0F;--hero:#121519;--sh:none;--tint:14%;color-scheme:dark}
```

New variables are `--sig`, `--fm`, `--hatch`, `--r1..3`, `--s1..6`, `--dur` and `--ease`. Existing ones keep their names. `--blue` deliberately becomes ink, so that flights are "black on paper" and not blue. `--pur` and `--ind` are collapsed into grey and cyan.

Also update `<meta name="theme-color">` to `#F3F1EA`, with a second `media="(prefers-color-scheme: dark)"` tag set to `#0A0C0F`.

---

## 4. Prioritized CSS changes (incremental, existing class names)

Each step ships on its own. P0 is a token and font swap. P1 removes decoration. P2 restyles components. P3 needs small JS or markup changes.

### P0: tokens and type (≈30 min, zero layout risk)
1. **Fonts.** Replace the `<link>` for `Inter` + `Space Grotesk` with B612 Mono + Barlow + Barlow Semi Condensed (URL above). Paste the `tokens.css` block at the end of `<style>`.
2. **Times use the condensed tabular sans; codes use mono.**
   ```css
   .c .n,.wd b,.nxt b,.nxb em,.rsr .tm,.lbt,.rcn,.bpv,.bpga,.rst input,.rse input,.rsg b,.rsm2 b,.rsm3 b,.stt b,.sh>b,.bpn,.hc b,.lld b,.rsv,.rsw b,.rtx b,.bphm{font-family:var(--ff);font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
   .nxa,.lap b,.c i b,.brmet code,.brtx,.brraw code,.ctn a,.c i u.fn{font-family:var(--fm);letter-spacing:0}
   ```
3. **Keep the signal colour for state only.** Chrome goes back to ink:
   ```css
   .mb,.rbb,.hqb,.mh button,.ed,.rsrst,.clxh button,.hch button svg,.hc>span:first-child svg,.tile .ti svg,.stabs button.on svg{color:var(--tx)}
   .tile .ti svg{stroke:var(--tx)}
   ```

### P1: remove decoration (≈1 h)
4. **Background planes off.** Add `#bgsky{display:none}` and default `rot_bg` to `"0"` in `bgOn()`. Optionally drop the setting.
5. **Shadows and floating circles.**
   ```css
   .grp,.acc,.bpg,.rsm2 div,.rsm3 div,.tile,.rbt,.stt,.bpgo,.rcs,.bpset,.rtl,.rsg div,.cts,.pnl,.lbk,.dpc,.hc,.wd,.clx,.brl,.brd,.brw>div,.rtw,.rc2>div,.rsbp,.nx{box-shadow:none;border:1px solid var(--sep);border-radius:var(--r2)}
   .mb,.rbb,.hqb,.brh button{border-radius:var(--r2);box-shadow:none;background:none;border:1px solid var(--sep)}
   ```
6. **Gradient and hero blocks become flat.** Remove the navy fill on light, and add an ink rule:
   ```css
   .sh,.bph,.rsh,.clhero{background:var(--card);color:var(--tx);box-shadow:none;border:1px solid var(--sep);border-top:2px solid var(--tx);border-radius:var(--r2)}
   .bph .l,.bplg,.bpnote,.bp3 span,.rsk .l,.rst label span,.clht span,.clhq small{color:var(--tx2)}
   .bp3 div,.rst label,.rsp,.rsst button,.clhq a{background:var(--sel);color:var(--tx)}
   .rst input,.bp3 b,.clhq b,a.clht{color:var(--tx)}
   .mapc{background:#05070A;box-shadow:none;border-radius:var(--r2)}
   .av{background:var(--tx);color:var(--bg);border-radius:var(--r2)}
   ```
7. **Glass and bounce.**
   ```css
   .toast{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tx);color:var(--bg);border-radius:var(--r2);box-shadow:none;transition:transform var(--dur) var(--ease),opacity var(--dur) var(--ease)}
   .toast small{color:color-mix(in srgb,var(--bg) 70%,transparent)}.toast i{background:none;color:var(--grn)}
   .upd{border-radius:var(--r2);transition:transform var(--dur) var(--ease),opacity var(--dur) var(--ease)}
   .glb .gbt button{backdrop-filter:none;-webkit-backdrop-filter:none;background:#000;border-radius:var(--r2)}
   .pnl,.dd{animation-duration:var(--dur)}
   ```
8. **Settings icons: drop the iOS gradient squircles.**
   ```css
   .grp .ic,.dgrp .ic,.sgrp .ic,#p-dati .ic,#p-dp .ic,#p-cl .ic,.bpgi,.sti,.ri,.clxb i,.tile .ti{background:none!important;color:var(--tx2);border-radius:0;width:24px;height:24px}
   .grp .ic svg,.grp .ic svg *,.dgrp .ic svg *,.bpgi svg *,.sti svg *{stroke:currentColor}
   .grp .ic svg [fill="#fff"]{fill:currentColor}
   .row+.row::before{left:52px}
   ```
   Also delete the inline `style="background:linear-gradient(...)"` attributes in the Settings, Backup and Duty-plan markup.
9. **Radii everywhere.** Use 4px. Chips and pills move from 999px to 2px.
   ```css
   .hch button,.ych button,.brs button,.lchip,.ctn a,.dpp,.nxbr,.rck,.hp .netc,.brk,.brz{border-radius:var(--r1)}
   .seg,.stabs,.sg button,.lbsv,.lbgo2,.dpb,.bpgo,.lsgn,.lsadd,.rsp,.ui,.lfi,.lf input,.lf select{border-radius:var(--r2)}
   ```

### P2: component restyles (≈half a day)
10. **Calendar grid as a hairline table** (`.wk`, `.gd`, `.c`):
    ```css
    .wk,.gd{gap:0;padding:0 8px}
    .gd{border-top:1px solid var(--sep);border-left:1px solid var(--sep);padding-bottom:0;margin:0 8px}
    .c,.c.k,.c.lw,.c:not(.k):not(.lw){border-radius:0;box-shadow:none;background:var(--card);border-right:1px solid var(--sep);border-bottom:1px solid var(--sep);height:74px}
    .gd>span:not(.c),.gd>.gf{border-right:1px solid var(--sep);border-bottom:1px solid var(--sep)}
    .c.k::before{top:0;bottom:0;left:0;right:auto;width:3px;height:auto;background:var(--pc)}
    .c.lw{background:var(--empty)}
    .c .n{font-family:var(--fm);font-size:11px;color:var(--tx2)}
    .c.k .n{color:var(--tx)}
    .c i b{font-family:var(--fm);font-size:14px;letter-spacing:-.02em;color:var(--tx)}
    .c.k i b{color:color-mix(in srgb,var(--pc) 85%,var(--tx))}
    .c i u{font-family:var(--fm);font-size:10px}
    .c.td{background:var(--card)!important;box-shadow:inset 0 0 0 2px var(--sig)}
    .c.td .n{color:var(--sig)!important;background:none}
    .c.td i b,.c.td i u,.c.td i u.fn,.c.td .ico,.c.td .pl{color:inherit!important}
    .c.on{outline:0;background:var(--sel)}
    .c .pl,.c .lc{color:var(--tx2)}
    .pnl{border:1px solid var(--tx);border-radius:var(--r2);background:var(--card)}
    .mh b{font-family:var(--ff);text-transform:uppercase;letter-spacing:.02em}
    .wk{font-family:var(--ff);letter-spacing:.14em}
    ```
    With `--blue` = ink, flights become black and the remaining hues are amber (standby), cyan (sim/training), red (sick/med) and green (off, but muted; see step 15).
11. **Next-flight card as a flight strip, not a boarding pass** (`.nx*`):
    ```css
    .nx{border:1px solid var(--sep);border-radius:var(--r2);box-shadow:none;position:relative}
    .nx::before{content:"";position:absolute;left:-1px;top:-1px;bottom:-1px;width:4px;background:var(--sig)}
    .nxh{background:none;color:var(--tx2);padding:10px 16px 0 18px}
    .nxh span{font-family:var(--ff);letter-spacing:.12em}
    .nxh b{font-family:var(--fm);color:var(--sig)}
    .nxa{font-family:var(--fm);font-size:38px}
    .nxm svg{display:none}
    .nxm i{background:var(--tx2);height:1px}
    .nxp{height:0;border-top:1px solid var(--sep);margin-top:8px}
    .nxp:before,.nxp:after,.nxp i{display:none}
    .nxs{gap:0;padding:0}
    .nxt{padding:9px 12px;border-left:1px solid var(--sep)}
    .nxt:first-child{border-left:0;padding-left:18px}
    .nxt b.ac{color:var(--sig)}
    .nxbr{background:none;color:var(--tx);border:1px solid var(--sep);border-radius:var(--r1);text-transform:uppercase;font-family:var(--ff);letter-spacing:.1em}
    ```
12. **Home status chips become one status line** (`.hp`, `.netc`, `.sem`):
    ```css
    .hp{gap:16px;border-bottom:1px solid var(--sep);padding:0 0 8px;margin:0 0 12px}
    .hp .netc{background:none;box-shadow:none;padding:0;font-family:var(--ff);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--tx2)}
    .sem,.sem.on,.sem.off,.sem.mid{border-radius:0;width:6px;height:6px;box-shadow:none!important}
    .sem.off{background:var(--tx2)}
    ```
    "Unknown" status is grey, not red. Red is reserved for real warnings.
13. **Home 2×2 tiles become a status table** (`.hcs`, `.hc`):
    ```css
    .hcs{display:block;border-top:1px solid var(--tx)}
    .hc{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;border:0;border-bottom:1px solid var(--sep);border-radius:0;background:none;padding:10px 0;min-height:0}
    .hc>span:first-child{font-family:var(--ff);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--tx2)}
    .hc>span:first-child svg{display:none}
    .hc b{grid-column:2;grid-row:1/3;align-self:center;font-size:18px}
    .hc small{grid-column:1}
    ```
14. **Week strip** (`.wks`, `.wd`): flatten it, or replace it with the 7-day timetable in the mockup (P3).
    ```css
    .wd{border-radius:0;box-shadow:none;background:none;border-bottom:2px solid transparent}
    .wd.td{background:none;color:var(--sig);border-bottom-color:var(--sig)}
    .wd.td span{color:var(--sig)}
    .wd i{border-radius:0;width:8px;height:2px}
    ```
15. **Off days are quiet.** In the calendar, `Rest`/`Off` text is green on every second cell and that green dominates the month. Set it muted:
    ```css
    .c.k[style*="--grn"] i b,.c.k[style*="--lgrn"] i b{color:var(--tx2)}
    .c.k[style*="--grn"]::before{display:none}
    ```
    Better: change `pill()` so it outputs the CrewLink code (`RPM`, `GLS`) instead of an icon plus "Rest" (P3).
16. **Day-detail rows as an OFP leg table** (`#dt .row .ic`). The coloured letter badges become plain mono keys:
    ```css
    #dt .ic{background:none!important;color:var(--tx2);font-family:var(--fm);font-size:11px;width:34px;justify-content:start}
    #dt .v{font-family:var(--ff);font-weight:600;color:var(--tx);font-variant-numeric:tabular-nums}
    ```
    In JS, replace `"✈︎"`, `"IN"`, `"OUT"` and `"H"` with `FLT`, `RPT`, `C/O` and `HTL`.
17. **Section headers and labels.**
    ```css
    .hd,.pt,.lab,.brg h4,.brdt,.llh{font-family:var(--ff);font-weight:600;font-size:11px;letter-spacing:.12em}
    h1,.tt{font-family:var(--ff);text-transform:uppercase;letter-spacing:.02em;font-size:24px}
    .hhi h2{font-family:var(--ff);text-transform:uppercase;font-size:28px}
    ```
18. **Buttons.**
    ```css
    .lbsv,.lbgo2,.dpb{background:var(--pri);color:var(--prit);font-family:var(--ff);text-transform:uppercase;letter-spacing:.12em;font-size:15px;padding:14px}
    .lbgo2{background:var(--pri)}
    .tg{border-radius:2px;width:44px;height:24px}
    .tg::after{border-radius:1px;width:20px;height:20px;box-shadow:none}
    .on>.tg,.tg.tgon{background:var(--grn)}
    ```
19. **Stats.** Use one series colour and let only the current value carry the signal:
    ```css
    .mc i,.bar i{background:var(--tx);border-radius:0}
    .stk{border-radius:0}
    ```
    In JS, change the fleet `pal` to greys (`#15191E`, `#5D6168`, `#9A9EA5`, `#C9C5BA`) and the PF bar to `var(--tx)` / `var(--tx2)`.
20. **Rest calculator.** Keep the timeline:
    ```css
    .rtb{border-radius:0}
    .rtb i{font-family:var(--fm)}
    .rsr .rsn{border-radius:var(--r1);font-family:var(--fm)}
    ```
    Use fixed shift fills by role: `PF` ink, `PM` grey, `P3/P4` hatch. That replaces the current blue/green/orange.

### P3: small JS and markup (copy, i18n, structure)
21. **Home header.** Replace the greeting with `WED 25 NOV` plus a UTC/LT clock (`07:40Z · 08:40 FCO`). Add a subline: "Flight day · report in 3 h 25 min".
22. **Next-duty time row.** Add `STD/STA`, plus `Z` sub-values from `AIR[ap][3]` (the time zone is already in `AIRT`).
23. **Calendar labels.** Use CrewLink codes (`RPM`, `GLS`, `HSBY`, `ASBY`, `SIB`, `FEN`, `L/O`, `C/O`). Drop the bed, house, phone and palm glyphs. This also fixes the untranslated "Layover / Rest / Sim / Sby / Return" in Italian.
24. **Roster LT/UTC toggle.** Add it to the header. The rest calculator and FTL maths already think in UTC.
25. **Navigation.** Add a 4-tab bottom bar (Today / Roster / Logbook / Tools) to replace the hub-and-back pattern and the 3 floating header buttons. The CrewLink grid becomes a 4-cell toolbar.
26. **Copy pass.** Example strings:

    | Before | After (EN) | After (IT) |
    |---|---|---|
    | "Recency to restore" + orange list | "Recency LAPSED · 0/3 T/O · 0/3 LDG" | "Recency SCADUTA · 0/3 T/O · 0/3 LDG" |
    | "13 to do / missing flight data" | "13 entries missing PF/PM" | "13 voli senza PF/PM" |
    | "Good morning, Marco" | (remove) | (remove) |

    Also remove `✓` and `♥` glyphs, and make "Stats", "Recency" and "Logbook" consistent in IT.
27. **Theme colour meta and app icon.** Replace the rainbow app icon with a monochrome mark: a ring plus a magenta square, as in the mockup wordmark.

---

## 5. Files

- Mockup (recommended direction, Home and Roster, light and dark): `/tmp/claude-0/-home-user-Rotate/a4c81a0c-22ce-58a2-ba0a-bd4fb384ce26/scratchpad/design/mockup.html`
- Mockup screenshots: `.../design/shots/mockup-home-light.png`, `mockup-home-dark.png`, `mockup-roster-light.png`, `mockup-roster-dark.png`
- Token drop-in: `.../design/tokens.css`. Preview on the live app: `.../design/shots/tokens-only-{home,roster}-{light,dark}.png`
- Current-app screenshots (56): `.../design/shots/app/`
- Scripts: `data.js` (synthetic roster), `shoot.js` (app capture), `shootmock.js`, `shoottok.js`
