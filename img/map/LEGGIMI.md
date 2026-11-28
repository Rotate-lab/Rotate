# Mappa della rotta (briefing)

Base cartografica in stile Google, senza strade, usata dalla mappa della rotta nel briefing del volo.

- `terrain.webp`: proiezione di Mercatore, latitudini ±80°. È costruita da:
  - colori della superficie dalla NASA Blue Marble;
  - rilievo leggero dalla topografia NASA (texture del pacchetto npm `three-globe`);
  - terre ritagliate sui confini Natural Earth.

  Pubblico dominio.
- `world.json`: confini dei paesi Natural Earth 1:50m (pacchetto npm `world-atlas`), semplificati, con codice ISO e punto per il nome. Pubblico dominio.

Fonti: [Natural Earth](https://www.naturalearthdata.com/) · [NASA Visible Earth](https://visibleearth.nasa.gov/).
