# GeoGuard – GPS & Kompass (.apk)

Eine native Android-App, die **GPS-Position** und **Kompass-Richtung** sicher anzeigt:

| Anzeige | Quelle |
|---|---|
| Breite / Länge (Dezimal + Grad/Minuten/Sekunden) | System-`LocationManager` (GPS-Satellit + Netzwerk) |
| Höhe, Geschwindigkeit, GPS-Kurs | GPS-Fix |
| Genauigkeit / Fix-Qualität (Sicherheitsindikator) | `Location.accuracy` mit Ampel-Bewertung |
| Richtung (Kompassrose + Grad + Himmelsrichtung) | Rotations-Vektor-Sensor (Magnetometer + Gyroskop) |
| Quelle / Zeitstempel | LocationManager-Provider |

Funktionen: Tracking Start/Stopp, Koordinaten kopieren, Standort teilen, Kompass
kalibrieren, „In Karte öffnen". Läuft **offline**, **ohne Google Play Services**,
ohne Tracking/Werbung.

## Die fertige .apk bekommen — ohne lokale Installation

Diese Sandbox kann das Android-SDK nicht laden (Googles Server sind hier blockiert).
Deshalb baut die mitgelieferte **GitHub-Actions-Pipeline** die `.apk` automatisch:

1. Diese Änderungen sind bereits gepusht → der Workflow **„Build GeoGuard APK"**
   läuft automatisch (Tab **Actions** im GitHub-Repo).
2. Workflow-Lauf öffnen → unter **Artifacts** die Datei **`GeoGuard-apk`**
   herunterladen → enthält `GeoGuard.apk`.
3. APK aufs Android-Gerät kopieren, „Installation aus unbekannten Quellen"
   erlauben, installieren.

Alternativ einen Tag setzen, dann wird ein Release mit angehängter APK erstellt:

```bash
git tag v1.0 && git push origin v1.0
```

## Selbst lokal bauen (mit Android-SDK)

```bash
cd android
./gradlew assembleDebug
# Ergebnis: app/build/outputs/apk/debug/app-debug.apk
```

Oder den Ordner `android/` einfach in **Android Studio** öffnen und
**Run ▶** / **Build → Build APK(s)** wählen.

## Aufbau

```
android/
├─ app/src/main/
│  ├─ assets/gps.html              # komplette Oberfläche (offline)
│  ├─ java/com/dhl/gps/MainActivity.kt  # native GPS- + Sensor-Brücke
│  ├─ AndroidManifest.xml          # Standort-/Kompass-Berechtigungen
│  └─ res/                         # Icon, Theme, Strings
└─ ...                             # Gradle-Konfiguration
```

Die Oberfläche (`gps.html`) funktioniert auch eigenständig in jedem Browser
bzw. als installierbare PWA – dann werden die Web-Geolocation- und
Geräteorientierungs-APIs genutzt. Im nativen WebView liefern stattdessen die
robusteren System-Sensoren die Daten.
