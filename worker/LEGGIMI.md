# Rotate · cassetta postale CrewLink (Cloudflare Worker)

Il Worker `rotate-box` permette a duty plan ed equipaggio di arrivare in Rotate **da soli**, senza Incolla:

1. Rotate apre CrewLink con la richiesta cifrata nell'indirizzo (periodo del duty plan e voli di cui serve l'equipaggio) e ne lascia una copia sul Worker.
2. Su CrewLink il segnalibro **Rotate** (o Userscripts) scarica duty plan e liste equipaggio nella sessione del pilota, li cifra e li consegna al Worker con un invio di modulo, che porta alla pagina "✓ Fatto".
3. Rotate li ritira e li importa appena torna in primo piano. Se le notifiche sono attive, arriva anche un avviso sull'iPhone.

CrewLink ha una regola di sicurezza (CSP) che permette gli script del segnalibro e le richieste verso CrewLink stesso, ma non script o richieste verso altri siti. Per questo il segnalibro contiene tutto il codice e i dati partono con un invio di modulo: nessun blocco di sicurezza viene attivato su CrewLink.

La chiave per decifrare resta solo sul telefono (app e segnalibro): il Worker e Cloudflare vedono solo dati illeggibili, cancellati dopo l'import o al massimo dopo 24 ore. La password di CrewLink non passa mai da qui.

È un Worker **separato** da quello del meteo (`rotate-wx`), che non va toccato.

## Configurazione (una volta, circa 10 minuti)

1. **Crea il Worker**
   - Apri [dash.cloudflare.com](https://dash.cloudflare.com) › **Workers & Pages** › **Create** › **Create Worker**.
   - Nome: `rotate-box` › **Deploy** (va bene il codice di esempio, lo sostituiamo subito).
2. **Incolla il codice**
   - Nel Worker appena creato: **Edit code**.
   - Cancella tutto e incolla il contenuto di [`worker/rotate-box.js`](rotate-box.js) (su GitHub: apri il file › *Raw* › seleziona tutto › copia).
   - **Deploy**.
3. **Crea lo spazio dati (KV)**
   - **Storage & Databases** › **KV** › **Create namespace** › nome `rotate-box` › **Add**.
4. **Collega lo spazio dati al Worker**
   - Torna al Worker `rotate-box` › **Settings** › **Bindings** › **Add binding** › **KV namespace**.
   - *Variable name*: `BOX` (maiuscolo) · *KV namespace*: `rotate-box` › **Save** / **Deploy**.
5. **Verifica**
   - Apri `https://rotate-box.locaoneshot.workers.dev/health`: deve comparire `{"ok":true}`.
   - Se il Worker ha un indirizzo diverso, in Rotate scrivilo nel campo *Server* prima di collegare.

## Aggiornare il codice del Worker

Quando questo file cambia: Worker `rotate-box` › **Edit code** › cancella tutto › incolla il nuovo [`rotate-box.js`](rotate-box.js) › **Deploy**. Spazio dati e collegamento restano.

## In Rotate

1. **Duty plan › Individuale › Collegamento CrewLink › Collega**.
2. **Copia segnalibro**: in Safari aggiungi un segnalibro a una pagina qualsiasi, poi modificalo con nome `Rotate` e come indirizzo il testo copiato. Il segnalibro contiene tutto il codice: quando Rotate avvisa che è vecchio, ricopialo. I vecchi segnalibri *Rotate Roster* e *Rotate Crew* si possono cancellare.
3. **Attiva le notifiche** (Rotate deve essere installato sulla schermata Home, iOS 16.4 o successivo).
4. Facoltativo: **Userscripts** (app gratuita dall'App Store) per non toccare nemmeno il segnalibro: *Copia script* e incollalo in un nuovo JavaScript di Userscripts.

## Uso

- **Roster › rotella**: duty plan del mese visualizzato + equipaggio dei suoi voli.
- **Duty plan › Individuale › Scarica e importa**: periodo scelto + equipaggio dei suoi voli.
- **Roster › giorno › Mostra equipaggio**: equipaggio di quel volo.

Rotate apre CrewLink: tocca il segnalibro **Rotate**. Quando compare la pagina *✓ Fatto*, torna a Rotate (◀ Rotate in alto a sinistra) o tocca la notifica: i dati sono già importati.
Se CrewLink chiede il login, l'indirizzo con la richiesta si perde: dopo il login tocca il segnalibro, Rotate recupera la richiesta dal Worker e ricarica CrewLink; poi tocca di nuovo il segnalibro.
Se il duty plan contiene voli nuovi, Rotate lascia pronta la richiesta del loro equipaggio per il giro successivo (con Userscripts parte da sola alla prossima apertura di CrewLink).

## Costi e limiti

Il piano gratuito di Cloudflare (KV: circa 1.000 scritture e 100.000 letture al giorno) basta per qualche centinaio di aggiornamenti al giorno. Ogni aggiornamento usa 2–3 scritture. Oltre, il piano Workers a pagamento costa 5 $ al mese.

## Interfaccia (per sviluppatori)

| Metodo e percorso | Codice | Uso |
|---|---|---|
| `POST /box` | — | crea la cassetta `{id, rt, wt}` (il Worker salva solo l'impronta SHA-256 dei codici) |
| `PUT /box/:id/req` · `POST` con `{t, iv, ct}` | `rt` | richiesta cifrata dell'app (il `POST` serve a `navigator.sendBeacon`) |
| `GET` / `DELETE /box/:id/req` | `rt` o `wt` | lettura e cancellazione della richiesta (API) |
| `POST /box/:id/hop` (modulo) | `wt` | richiesta persa con il login: pagina che torna su CrewLink con `#rotate-req=…` |
| `POST /box/:id/drop` (modulo o JSON) | `wt` | consegna cifrata `{iv, ct, note}`; manda la notifica; dal modulo risponde con la pagina "Fatto" |
| `GET` / `DELETE /box/:id/drop?n=` | `rt` | l'app ritira e cancella le consegne |
| `PUT` / `POST` / `DELETE /box/:id/push` | `rt` | iscrizione alle notifiche, notifica di prova |
| `DELETE /box/:id` | `rt` | scollega e cancella tutto |
| `GET /vapid` | — | chiave pubblica per le notifiche (creata la prima volta) |

Origini permesse: `https://rotate-lab.github.io` e `https://crewlink.ita-airways.com` (altre con la variabile `ORIGINS`).
