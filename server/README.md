# KI-Dokumentenscanner – Aktivierung

Vorbereitet, noch nicht live. GitHub Pages führt keinen Servercode aus. Der frühere Sites-Server ist zugriffsgeschützt und hat keinen OpenAI-Schlüssel; er ist kein verwendbarer öffentlicher API-Endpunkt.

Dieser Worker erkennt Text aus Bildern mit OpenAI und übersetzt anschließend den vollständigen Text bis 5.000 Zeichen. Arabische und gescannte PDF-Seiten werden im Browser gerendert und als Bild erkannt. Eingebetteter Text anderer PDFs wird direkt ausgelesen. Die Oberfläche verlangt Zustimmung vor der Übertragung.

## Erforderliche Einrichtung vor dem Zusammenführen

1. Einen Cloudflare-Worker mit `server/wrangler.jsonc` bereitstellen. Von diesem Ordner aus: `npx wrangler deploy`.
2. Einen neuen OpenAI-Projektschlüssel ausschließlich als Worker-Secret `OPENAI_API_KEY` hinterlegen, z. B. mit `npx wrangler secret put OPENAI_API_KEY`. Keinen Schlüssel im Chat, HTML oder Repository speichern. Einen früher im Chat veröffentlichten Schlüssel nicht wiederverwenden.
3. Modellzugriff und Abrechnung des OpenAI-Projekts prüfen. Standardmodell ist `gpt-4.1-mini`; `OPENAI_MODEL` ist serverseitig konfigurierbar.
4. In `index.html` beim Meta-Feld `document-ai-endpoint` die tatsächliche HTTPS-Worker-Adresse mit `/api/document` eintragen. Der Wert ist absichtlich leer, bis der Server bereitsteht.
5. `node server/worker.test.mjs` ausführen. Anschließend im Browser von der GitHub-Herkunft echte Tests mit unpersönlichem arabischem Text, Bild und Test-PDF durchführen. Zustimmung verweigern, Netzwerkfehler, Vorlesen sowie Deutsch als Ziel ebenfalls prüfen.
6. Erst nach erfolgreichen Live-Tests den Entwurf zusammenführen und GitHub Pages prüfen.

Keine Änderung des privaten Sites-Zugriffs erforderlich. CORS ist auf die GitHub-Herkunft beschränkt; CORS ist keine Benutzeranmeldung. Die IP-basierte Cloudflare-Drosselung begrenzt Anfragen, ist aber kein verbindlicher globaler Kostenrahmen. OpenAI-Projektlimits vor öffentlichem Betrieb konfigurieren.

Der Code protokolliert keine Dokumentinhalte, nutzt keine Dokumentablage und setzt `store: false` sowie `Cache-Control: no-store`. Das ersetzt keine Aussage über Aufbewahrung beim Anbieter. Die neue Zustimmung benennt deshalb ausdrücklich OpenAI.

Referenzen: [OpenAI Bildverarbeitung](https://developers.openai.com/api/docs/guides/images-vision), [Cloudflare Rate Limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
