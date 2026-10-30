# Leaklab Live WebSocket Audit

Chrome Manifest V3 extension for a manually started, local WebSocket capture on a supervised Kahoot test session.

## Features

- Starts and stops capture from the extension popup.
- Attaches only to the active tab on `kahoot.com` or `kahoot.it`.
- Observes WebSocket open/close events and sent/received frames through Chrome DevTools Protocol.
- Parses JSON text frames locally.
- Displays values found under recognized correction-field names such as `correctChoices`, `correctAnswer`, `correctOption`, or `solution`.
- Shows separate boolean feedback flags such as `isCorrect` as status metadata, not as the answer itself.
- Compares timestamps for inbound correction fields and outbound submission fields.
- Exports a JSON report containing detected correction fields and event metadata. It does not export raw WebSocket frames.

## Install / update

1. Download and unzip this branch.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Remove the previous Leaklab copy or reload the unpacked extension after replacing its files.
5. Select **Load unpacked** and choose `leaklab/kahoot-extension`.
6. Accept Chrome's debugger permission prompt.

## Use

1. Open the Kahoot session specifically designated for the TP.
2. Click the Leaklab toolbar icon.
3. Click **Démarrer la capture**.
4. Start capture before joining/reloading the session if you need the earliest frames.
5. Watch the **Valeurs de correction détectées** panel and the event timeline.
6. Stop capture and export the report when finished.

Chrome may display a debugger-attached banner while capture is active. This is expected; stop capture to detach.

## Limitations

- Only frames received after capture starts can be observed.
- Only JSON text frames are parsed. Binary and non-JSON frames are counted but not decoded.
- The extension only displays values under recognized key names. Different API schemas may use other names or encode answers differently.
- Values under fields such as `correctChoices` may be option indexes or IDs, not human-readable answer text. The extension does not infer a textual answer where the frame does not provide one.
- A detected correction field may arrive only after the player submits. Use the timestamp comparison to establish ordering for the specific test.
- Keep this extension restricted to the session explicitly designated for the TP.
