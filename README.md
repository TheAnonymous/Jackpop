# Jackpop

Jackpop ist eine Hit-Maschine fürs Handy: ein einarmiger Bandit für
Bubblegum- und Hyperpop-Loops. Man zieht am Hebel, die Walzen stoppen im Takt
und bauen den Song auf, man hält, was gefällt, und stupst den Rest. Alles läuft
im Browser, ohne Konto, Backend, Samples oder externe Requests. Zielgerät ist
Chrome auf Android. Freunde mit iPhone hören es auch bei Lautlos-Schalter:
Beim ersten Antippen meldet Jackpop seinen Ton als Wiedergabe an (Safari 17+:
Audio-Session, ältere: ein stummes Audio-Element). Solange der Münzschlitz das
Mikrofon offen hat, entscheidet Safari wie bisher selbst.

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
  einen Jingle, danach einen Bonus-Drop und eine Runde einen Ganzton höher.
- **Diamanten:** Jeder Jackpot schaltet auf einer Walze (Beat, Bass, Akkorde,
  Hook) einen Diamanten frei, ein dreizehntes Symbol mit eigenem Klang. Er
  zählt als Joker, vier Diamanten sind ein Diamant-Jackpot.
- **Laune:** Ein Gesicht in der Lichterkette zeigt, wie lange die Maschine
  schon keinen Jackpot hatte. Nach fünf Nieten wird sie ungeduldig (orange,
  brummelt), nach zehn kocht sie (rot, wackelt) und gibt immer öfter nach;
  spätestens der vierzehnte Zug ist ein Jackpot („Endlich!“).
- **Loop oder Song:** Song macht aus der Linie ein Stück von gut einer Minute
  (Intro, Strophe mit Aufbau, Refrain, Drop mit zerhackter Hook, Refrain mit
  Rückung, Outro) und endet dann. Ein Jackpot-Zug springt direkt in den Drop.
- **Münzschlitz:** gedrückt halten und singen. Die Aufnahme wird im Takt
  platziert, Ton für Ton auf die Hook-Melodie gezogen (Hard-Tune, TD-PSOLA)
  und mit angehobenen Formanten hell und klein gemacht. Zucker entscheidet, ob
  sie eine Oktave höher singt. Dreht sich die Hook-Walze weiter, singt die
  Stimme die neue Melodie. Aufnahmen bleiben in IndexedDB auf dem Handy.
- **Chor:** Aus derselben Aufnahme stimmt die Maschine zwei weitere Stimmen,
  auf die nächsten Akkordtöne über und unter der Hook (über Durchgangstönen
  eine Terz), links und rechts, leiser, leicht versetzt und mit eigenem
  Formant. Der Chor singt auf den Höhepunkten: ab der Mitte des Refrains, im
  Refrain mit Rückung und in der Rückung nach einem Jackpot. Die Song-Karte
  zeigt pink, wo er einsetzt. Er kommt einen Moment nach der Hauptstimme; die
  Tonhöhenanalyse der Aufnahme wird dafür nur einmal gemacht.
- **Ticket:** druckt die Linie als ganzen Song (mit Stimme und Chor) und
  öffnet das Android-Teilen-Menü mit der Audiodatei. Die Datei ist Ogg-Opus,
  das Format der WhatsApp-Sprachnachrichten, etwa 1 MB pro Minute; wo der
  Browser kein Opus kodiert, WAV. Der Rezept-Link trägt Walzen, Klänge,
  Regler, Tempo und Modus ohne Stimme im Adress-Fragment, das nie beim Server
  ankommt: Freunde bekommen die Linie und singen selbst, und ein Diamant im
  Rezept kommt als Geschenk mit.
- **Bonbon-Regler:** Zucker (heller, süßer, Glocke über der Hook), Glitzer
  (Hall, Delay, Glöckchen-Arpeggios) und Chaos (Verzerrung, Bitcrush,
  Stotterer).
- **Speichern:** Jede Änderung landet sofort im `localStorage`, mit Sicherung
  der vorigen Fassung. Auch ein Hebelzug lässt sich rückgängig machen.
- **Als App:** Jackpop lässt sich auf den Startbildschirm legen (Manifest,
  Symbole, „Als App installieren“ in der Hilfe). Ein Service Worker hält die
  Seite, alle Bundles, Worker und Symbole auf dem Handy: Die Seite kommt
  online frisch vom Server, offline aus dem Speicher; Bundles tragen einen
  Inhalts-Hash und kommen aus dem Speicher. Eine neue Version meldet sich mit
  „Neu laden“, das während der Musik wartet. `sw.js` schreibt ein kleines
  Vite-Plugin aus `sw-template.js` mit der Dateiliste des Builds; der
  Test-Zugang bleibt draußen.

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
Jackpot über einen Test-Zugang, den es nur lokal mit `?audio-test=1` gibt. Als
Mikrofon bekommt Chrome ein künstliches „Aah“ (`e2e/fixtures/voice.wav`,
erzeugt von `scripts/make-voice-fixture.mjs`).
Außerdem rendern sie jedes der 48 Symbole offline und prüfen, dass jedes
hörbar ist und nichts übersteuert, und messen im Song Takt für Takt, wo der
Chor breit links und rechts steht. Ein Test startet die installierte App
offline mit Linie, Stimme, Chor und Laune.

Die App-Symbole zeichnet `node scripts/make-icons.mjs` aus dem Automaten des
Favicons (das maskierbare mit Rand für die Launcher-Maske).

## Lizenz

MIT, siehe [LICENSE](LICENSE) und [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
