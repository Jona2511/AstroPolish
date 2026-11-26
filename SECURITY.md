# Beveiliging

## Een kwetsbaarheid melden

Meld beveiligingsproblemen **niet** in een openbaar issue. Gebruik op GitHub *Security → Report a vulnerability* (private vulnerability reporting) in deze repository. Beschrijf het probleem, hoe het te reproduceren is en welke versie je gebruikt.

## Beveiligingsmodel van de desktop-app

- De interface draait in een Chromium-renderer met `contextIsolation`, `sandbox` en zonder `nodeIntegration`; er is geen preload-script en geen IPC.
- Alleen bestanden uit de app-map worden geladen (`app://`), met een Content-Security-Policy zonder inline scripts of externe bronnen.
- Navigatie naar andere adressen wordt geblokkeerd; alleen `https:`- en `mailto:`-links worden aan de standaardbrowser doorgegeven.
- Alle browserrechten worden geweigerd behalve het schrijven van een bestand dat je zelf in het opslagvenster kiest en het kopiëren van foutdetails naar het klembord.
- Foto's worden nooit geüpload; alles wordt lokaal verwerkt.

## Ondersteunde versies

Alleen de nieuwste release krijgt beveiligingsupdates.
