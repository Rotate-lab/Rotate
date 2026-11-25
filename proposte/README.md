# Proposte e report della revisione (25/11/2026)

Materiale di lavoro, non usato dall'app.

- `REVIEW.md`: revisione del codice (bug, sicurezza) con patch. Le correzioni HIGH/MEDIUM principali sono già applicate in v1.2.8; restano aperte M2 (conflitto backup Drive tra due dispositivi), M5 (data di creazione del PDF), L6–L10.
- `PERF.md`: misure di prestazioni e patch (P1–P10 applicate in v1.2.8; O1, congelare gli aeroplanini fuori dalla Home, non applicata).
- `design/`: critica grafica, tre direzioni, mockup "Ops Sheet" (`mockup.html`, screenshot PNG) e `tokens.css` da incollare in fondo allo `<style>`.
- `integrazioni/`: NOTAM (Worker Cloudflare + sezione briefing), aggiornamento duty plan da CrewLink (bookmarklet + appunti), lista equipaggio, altre idee. Codice non ancora provato con CrewLink reale né con l'API FAA.
