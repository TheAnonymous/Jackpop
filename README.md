# Jackpop

Jackpop ist eine Hit-Maschine fürs Handy: ein einarmiger Bandit für
Bubblegum- und Hyperpop-Loops. Man zieht am Hebel, die Walzen stoppen im Takt
und bauen den Song auf, man hält, was gefällt, und stupst den Rest. Alles läuft
im Browser, ohne Konto, Backend, Samples oder externe Requests. Zielgerät ist
Chrome auf Android.

Das Konzept, gemeinsam mit Jodie entwickelt, steht in [docs/KONZEPT.md](docs/KONZEPT.md).

## So spielt es sich

- **Vier Walzen:** Beat, Akkorde, Hook und Bass. Jede Walze trägt zwölf
  Symbole, je zwei aus sechs Klangfamilien: Herz (süß), Stern (glitzernd),
  Blitz (wild), Mond (verträumt), Flamme (Club) und Krone (Hymne).
- **Hebel:** Die Walzen stoppen als Achtel-Fill vor dem nächsten Taktanfang,
  jede mit ihrem Klang. Dann fällt der Loop von vorn herein. Ein voller Zug
  dreht einen Takt länger.
- **Halten und Stupsen:** Halten friert eine Walze für den nächsten Zug ein,
  ▲▼ gehen ein Symbol weiter.
- **Symbol öffnen:** anderer Klang, höher oder tiefer (beim Beat: leichter
  oder voller), solo hören, nur diese Walze drehen.
- **Jackpot:** drei oder vier Symbole einer Familie auf der Linie. Ohne Halten
  passiert das etwa bei jedem zehnten Zug. Dann gibt es Lichtshow, Konfetti und
  einen Jingle.
- **Bonbon-Regler:** Zucker (heller, süßer, Glocke über der Hook), Glitzer
  (Hall, Delay, Glöckchen-Arpeggios) und Chaos (Verzerrung, Bitcrush,
  Stotterer).
- **Speichern:** Jede Änderung landet sofort im `localStorage`, mit Sicherung
  der vorigen Fassung. Auch ein Hebelzug lässt sich rückgängig machen.

## Klang

Die Musik ist so gebaut, dass jede Kombination passt: Alles ist diatonisch
in einer Dur-Tonart, und Hooks und Basslinien sind relativ zum Akkord ihres
Takts notiert. Die Klänge entstehen direkt aus Web-Audio-Knoten
(`src/audio/synth.ts`): Pop-Drums, Zupfer, FM-Glocken, Supersaw, E-Piano,
Orgel, Chip-Lead, 808. Dazu kommen Kick-Pumping, Hall, Delay und ein Master,
der nie übersteuert. Der Taktgeber läuft in einem Worker und plant die
Sechzehntel auf der Audio-Uhr voraus. Die Walzen auf dem Bildschirm folgen
dieser Uhr, damit sie genau auf dem Schlag landen, den man hört.

## Entwickeln

Voraussetzungen sind exakt Node.js 24.15.0 und npm 12.0.0; beides legt
[`mise.toml`](mise.toml) fest.

```bash
npm ci
npm run dev
```

Die vollständige lokale Abnahme besteht aus Lint, Typecheck, Unit-Tests,
Build und Playwright in Pixel-7-Emulation gegen den Build unter der
Produktions-CSP:

```bash
npm run verify
```

Die E2E-Tests ziehen den Hebel mit echten Touch-Gesten und erzwingen einen
Jackpot über einen Test-Zugang, den es nur lokal mit `?audio-test=1` gibt.
Außerdem rendern sie jedes der 48 Symbole offline und prüfen, dass jedes
hörbar ist und nichts übersteuert.

## Lizenz

MIT, siehe [LICENSE](LICENSE) und [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
