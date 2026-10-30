# Leaklab Live WebSocket Audit

This Chrome extension uses a persistent Chrome Side Panel for a local, manually started WebSocket audit.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Reload the unpacked extension, or remove the old copy and load `leaklab/kahoot-extension` from the new ZIP.
4. Click the Leaklab toolbar icon. The dashboard opens in Chrome's side panel and remains open while you click elsewhere in the browser.

## Capture

1. Open the authorized test tab at `kahoot.com` or `kahoot.it`.
2. Open Leaklab and click **Démarrer la capture**.
3. Stop the capture when complete and export the JSON report.

The extension keeps a local event timeline and flags correction/submission field names. It does not retain raw frame contents or values. The side panel remains open until closed through Chrome's side-panel controls.