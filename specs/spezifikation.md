# GCode-Simulator für irische Holzflöten

## 1. Überblick

Ein browserbasierter 4-Achsen-GCode-Simulator zur visuellen Verifikation von Fräsbahnen auf zylindrischen/konischen Werkstücken. Primärer Anwendungsfall ist der Bau irischer Holzflöten (Rudall & Rose Typ), aber der Simulator soll generell für 4-Achsen-Werkstücke einsetzbar sein.

### Zweck

- Visuelle Kontrolle, ob Löcher, Sockelbohrungen und Konturen an plausiblen Positionen liegen
- Aufwändige Tests mit Fräse und Material vermeiden
- Optional: Flötenkontur aus YAML-Datei als halbtransparentes Overlay einblenden

### Technologie-Stack

- **Frontend:** TypeScript, Three.js (WebGL)
- **Build:** Vite
- **GCode-Parser:** Eigenentwicklung (kein externes Framework)
- **YAML-Parser:** js-yaml
- **Keine Backend-Abhängigkeit** — läuft vollständig im Browser

## 2. Koordinatensystem und Achsen

### Maschinenkoordinaten (wie im GCode)

| Achse | Bedeutung |
|-------|-----------|
| X | Querachse |
| Y | Längsachse des Werkstücks |
| Z | Werkzeughöhe über Werkstück |
| A | Rotation des Werkstücks um seine Längsachse (Y) |

Der Simulator interpretiert den GCode direkt so, wie er aus dem Perl-Script kommt. Etwaige Achsentausch-Logik in der Toolchain ist für den Simulator transparent — er zeigt an, was im GCode steht.

## 3. GCode-Unterstützung

### Unterstützte Befehle

| Befehl | Beschreibung |
|--------|--------------|
| G00 | Eilgang (Rapid Move) mit optionalem A-Parameter |
| G01 | Linearinterpolation (Vorschub) mit optionalem A-Parameter |
| G02 | Kreisinterpolation im Uhrzeigersinn (I, J Parameter) |
| G03 | Kreisinterpolation gegen Uhrzeigersinn (I, J Parameter) |
| G21 | Metrisches System (mm) |
| G90 | Absolutkoordinaten |
| G92 | Koordinatensystem-Nullpunkt setzen (X, Y, Z, A) |
| F | Vorschubrate (mm/min) |
| S | Spindeldrehzahl (rpm) |
| M03 | Spindel ein (Rechtslauf) |
| M05 | Spindel aus |
| M30 | Programmende |

### A-Achse (4. Achse)

- Die A-Achse rotiert das Werkstück um seine Längsachse
- Angabe in Grad (0°–360°, auch >360° möglich für kontinuierliche Rotation)
- Kann in G00 und G01 kombiniert mit X/Y/Z auftreten
- Kommentare im Format `(Alpha: 80.00° (abs))` und `(Alpha: 80.00° (rel))` kommen vor — der Simulator wertet ausschließlich den absoluten Wert aus. Der relative Wert ist ein Hilfskommentar aus dem Perl-Script und wird ignoriert.

### Parser-Anforderungen

- Kommentare in Klammern `(...)` erkennen und als Metadaten verfügbar machen
- `MARK`-Kommentare im Format `(MARK Hole: <name> -> Alpha: <grad>°)` auswerten
- Leerzeilen und reine Kommentarzeilen überspringen
- Groß-/Kleinschreibung der Achsbuchstaben tolerieren

## 4. 3D-Visualisierung

### Werkstück-Darstellung

- Konisches Werkstück, linearer Konus entlang der Längsachse (Y-Achse)
- Standardmäßig als Drahtgitter oder halbtransparenter Körper darstellbar
- Dimensionen aus der YAML-Datei: `tubeDiamAtBoreZero`, `tubeDiamAtBoreLowerEnd`, `boreLen`
- Ohne YAML: konfigurierbarer Konus mit Länge, oberem Durchmesser und unterem Durchmesser (kein Zylinder als Vereinfachung)

### Werkzeug-Darstellung

- Zylindrischer Fräser, Durchmesser aus GCode-Kommentar `(tool diameter <n>)` oder manuell einstellbar
- Position wird in Echtzeit während der Simulation angezeigt
- Farblich hervorgehoben (z.B. rot bei Vorschub, grau bei Eilgang)

### Fräsbahn-Darstellung

- Eilgang (G00): gestrichelte Linie, grau
- Vorschub (G01/G02/G03): durchgezogene Linie, farbig
- A-Achsen-Rotation: Das Werkstück dreht sich physisch in der Ansicht (wie in der Maschine). Die Fräsbahn wird zusätzlich als 3D-Linienzug im Raum dargestellt — beim Drehen des Werkstücks bewegt sich die bereits gefräste Bahn mit.
- Optionale Einfärbung nach Z-Tiefe (Heatmap)

### Kamerasteuerung (Trackpad-orientiert, à la ncviewer)

| Geste / Eingabe | Aktion |
|-----------------|--------|
| 2-Finger-Scroll (Trackpad) | Zoom (rein/raus) |
| 2-Finger bei gedrücktem Trackpad-Klick | Orbit-Rotation um Fokuspunkt |
| 3-Finger-Drag | Pan (Verschieben der Ansicht) |
| Mausrad (externe Maus) | Zoom |
| Rechte Maustaste + Drag | Orbit-Rotation |
| Mittlere Maustaste + Drag | Pan |
| Taste `←` / `→` | A-Achsen-Rotation des Werkstücks manuell drehen (±5°) |

- Voreingestellte Ansichten per Tastenkürzel: Draufsicht (T), Seitenansicht (S), Stirnansicht (F), Isometrisch (I)
- Doppelklick auf Werkstück setzt Orbit-Fokuspunkt
- **Referenzgitter:** Optionales mm-Raster in der Y-Z-Ebene (Längs-/Tiefenachse) als visuelle Orientierungshilfe; Dichte anpassbar oder abschaltbar, falls zu viel Clutter

## 5. Simulation

### Steuerung

- Play / Pause / Stop
- Geschwindigkeitsregler (1x, 5x, 10x, 50x, Max)
- Einzelschritt (nächster GCode-Befehl)
- Slider/Scrubber für Position im Programm
- Sprung zu MARK-Kommentar (Loch-Auswahl)
- **Hover-to-seek im GCode-Listing:** Bewegt man den Cursor über eine Zeile im GCode-Listing, springt das Werkzeug in der 3D-Ansicht sofort auf die entsprechende Position (wie bei ncviewer). Klick auf eine Zeile setzt die Simulation auf diese Position.

### Fortschrittsanzeige

- Aktuelle Zeile im GCode
- Aktuelle Maschinenkoordinaten (X, Y, Z, A)
- Geschätzte Restzeit (basierend auf Vorschubrate)
- Aktuelles Loch (aus MARK-Kommentar)

## 6. YAML-Overlay (Optional, per Schalter)

### Funktion

Wenn eine YAML-Datei geladen wird, zeigt der Simulator die Kontur des Flötenteils halbtransparent an, sodass die Fräsbahnen im Kontext des fertigen Teils sichtbar sind.

### Geometrie-Vereinfachung

Die YAML-Datei enthält `tubeDiamAtHole` an jedem Loch, da die Teile handgedrechselt sind. Für die Darstellung genügt eine Vereinfachung:

- **Hauptkörper:** Linearer Konus von `tubeDiamAtBoreZero` (oberes Ende) bis `tubeDiamAtBoreLowerEnd` (unteres Ende) über `boreLen`
- **Zapfen (Tenons):** Zylindrisch, mit `diam` und `length` aus der YAML-Datei
  - Der untere Zapfen (`tenonAtLowerEnd`) eines Teils steckt oben im nächsten Teil (LH → RH → Footer)

### Dargestellte Elemente

| Element | Darstellung |
|---------|-------------|
| Rohr-Außenkontur | Halbtransparenter Konus (linear, Bore-Zero → Lower-End) |
| Zapfen oben (`tenonAtZero`) | Zylindrischer Absatz am oberen Ende (Richtung +Y) |
| Zapfen unten (`tenonAtLowerEnd`) | Zylindrischer Absatz am unteren Ende (Richtung −Y) |
| Bohrung (Bore) | Innerer Zylinder (optional, zur Wandstärken-Kontrolle) |
| Tonlöcher (finger/vulcan/level) | Kreisförmige Markierungen auf der Oberfläche |
| Vulkan-Erhebungen | Erhabene Bereiche um Klappenlöcher |
| Sockelbohrungen (keyPostHoles) | Zylindrische Vertiefungen |

### YAML-Datenstruktur (relevante Felder)

```yaml
parts:
  - name: "lh-part"
    maxBoreDiam: 19.00
    minBoreDiam: 15.14
    boreLen: 208.18
    tubeDiamAtBoreZero: 28.90
    tubeDiamAtBoreLowerEnd: 26.53
    tenonAtZero:
      length: 27.40
      diam: 23.63
    tenonAtLowerEnd:
      length: 19.95
      diam: 20.24
    holes:
      - name: "c-sharp-2"
        diamX: 8.47
        centerX: -49.85
        tubeDiamAtHole: 28.48
        alpha: 0
        mode: "finger"
      - name: "c-2"
        diamX: 7.25
        centerX: -69.83
        tubeDiamAtHole: 28.32
        alpha: 80
        mode: "vulcan"
        keyHoles:
          keyAngleFromFluteAxis: 180
          distanceFromToneHoleToKeyAxis: 45.40
          keyPostHoleDiam: 4.90
          keyPostHoleDepth: 4.2
```

### Achsenzuordnung YAML → Simulator

Die YAML-Datei beschreibt Positionen entlang der Flöte als `centerX`. Im GCode (nach dem Achsentausch im Perl-Script) ist Y die Längsachse. Die Fräse bleibt in X immer auf 0 — es gibt keine Y-Koordinaten in der YAML-Datei.

- YAML `centerX` → Simulator **Y-Achse** (Längsachse des Werkstücks)
- YAML `alpha` → Simulator **A-Achse** (Rotation um die Längsachse)
- YAML `tubeDiamAtHole / 2` → für die Kontur-Darstellung ignoriert (linearer Konus)
- X-Achse des Simulators ist für das YAML-Overlay irrelevant (Fräse steht auf X=0)

### Maschinenursprung und Koordinatenrichtung

Das Werkstück ist parallel zur Y-Achse eingespannt wie in einer kleinen Drehbank. Das **obere Ende** (Korkende / `tenonAtZero`) zeigt in Richtung **+Y**. Der Fräser wird zur Ausrichtung auf der oberen Konuskante aufgesetzt und dort auf X=0, Y=0, Z=0 genullt. Die Bearbeitung erfolgt in Richtung **negativer Y** — daher sind alle `centerX`-Werte im YAML negativ.

Y=0 ist also die Referenzkante am oberen Ende des Teils. Das YAML-Overlay wird entsprechend positioniert: `tenonAtZero` beginnt bei Y=0 und erstreckt sich in −Y-Richtung.

## 7. Benutzeroberfläche

### Layout

```
┌──────────────────────────────────────────────────────┐
│  Toolbar: Datei laden | Ansichten | Einstellungen    │
├────────────────────────────────┬─────────────────────┤
│                                │  GCode-Listing      │
│                                │  (mit Highlighting  │
│    3D-Viewport                 │   der aktuellen     │
│    (Three.js Canvas)           │   Zeile)            │
│                                │                     │
│                                │                     │
├────────────────────────────────┼─────────────────────┤
│  Transport: ⏮ ▶ ⏸ ⏭ | Speed  │  Koordinaten-Panel  │
│  Scrubber: ═══════●══════════  │  X: Y: Z: A:       │
└────────────────────────────────┴─────────────────────┘
```

### Datei-Eingabe

- GCode-Datei (.nc) per Drag & Drop oder Dateidialog laden
- YAML-Datei (.yaml) optional dazuladen
- Beispiel-Dateien vorinstalliert (Demo-Modus)

### Einstellungen

- Werkstück-Länge, oberer Durchmesser, unterer Durchmesser (wenn kein YAML geladen)
- Werkzeug-Durchmesser (Fallback, wenn kein Kommentar im GCode)
- Farbschema (dunkel/hell)
- YAML-Overlay ein/aus
- Transparenz des Overlays (Slider)
- Gitter/Achsen ein/aus

## 8. Nicht-funktionale Anforderungen

- **Performance:** Flüssige Darstellung (>30 FPS) bei GCode-Dateien bis 100.000 Zeilen
- **Kompatibilität:** Aktuelle Versionen von Chrome, Firefox, Safari
- **Responsivität:** Bedienbar auf Desktop (min. 1280×720), Tablet-Optimierung optional
- **Offline-fähig:** Kein Server erforderlich, kann lokal als statische Dateien geöffnet werden
- **Modularität:** GCode-Parser, YAML-Parser und 3D-Renderer als separate Module

## 9. Abgrenzung (Out of Scope)

- Materialabtrag-Simulation (Boolesche Subtraktion vom Werkstück) —
  **teilweise umgesetzt:** Für Blowhole-YAMLs gibt es eine „Endansicht" (Voxel-
  Abtrag + Surface-Nets), die den fertig gefrästen Rohr-Stutzen zeigt
  (`src/renderer/MaterialSim.ts`). Nicht als mitlaufende Verlaufssimulation,
  sondern als einmalige Endteil-Berechnung. Konus-/Flötenteile noch offen.
- CAM-Funktionalität (GCode-Erzeugung)
- Maschinensteuerung / Senden von GCode an eine CNC
- Kollisionserkennung
- Multi-Tool-Support
- Bearbeitung/Editieren des GCodes im Simulator

## 10. Meilensteine

1. **M1 — GCode-Parser + Basis-3D:** GCode laden, parsen, Werkzeugbahnen als 3D-Linien darstellen (ohne A-Achse)
2. **M2 — 4. Achse:** A-Achsen-Rotation implementieren, Werkstück als Zylinder darstellen
3. **M3 — Simulation:** Zeitbasierte Wiedergabe mit Play/Pause/Speed-Kontrolle
4. **M4 — YAML-Overlay:** YAML-Parser, halbtransparente Flötenkontur, Lochpositionen
5. **M5 — Polish:** UI-Feinschliff, Voreinstellungen, Demo-Dateien, Performance-Optimierung
