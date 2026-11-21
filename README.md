# Moodle AI Assistant

Chrome extension (Manifest V3) that adds **AI Answer** and **Set Context** buttons to Moodle quiz questions. It sends the question, options and media to an OpenAI-compatible `/chat/completions` API and can auto-fill the answer.

## Installation

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open the extension popup and set the API URL, model and (optional) API key.

## Settings

- **API URL**: base URL (`https://host/v1`), `/models` URL or full `/chat/completions` URL.
- **API key**: stored locally in `chrome.storage.local` (not synced across devices), sent as `Authorization: Bearer`.
- **Model**: can be loaded from the endpoint via **Load Models from Endpoint**.
- **Auto-fill**: fills the detected answer into the Moodle form.

## Auto-answer all pages

On a quiz attempt page, click **Auto-answer all pages** in the bottom-right panel. The extension answers every question on the page, fills in the answers and clicks **Next page**. On the last page (no Next page button) it stops and never clicks **Finish attempt**, so you review and submit yourself. Click **Stop auto-answer** at any time. The run survives page navigation and stops on an error or after 100 pages. Answers are filled without confirmation, regardless of the Auto-fill setting.

The extension only runs on URLs containing `mod/quiz/`.

## Editing context and adding transcripts

Audio/video attachments have a **Download audio / video** panel with **Save to PC** (Chrome's save dialog) and **Copy link**. You can also select and copy the read-only URL field manually. The extension requires the `downloads` permission. Moodle URLs may require authentication: if a transcription service cannot access the URL, upload the downloaded file instead. Blob URLs, embedded third-party players and streaming playlists are not supported by this download feature. Nothing is automatically sent to a transcription service.

Click **Edit Context** next to a question to edit the pinned context or the question's shared passage. Paste an audio/video transcript into **Audio / video transcript** and click **Save**. The transcript is appended to the context text and is available for later editing in that text field. Transcription itself is not automatic.

Uncheck **Keep context images** to use only text instead of the context's images. This does not remove media attached directly to the question. **Cancel** or Escape discards edits; **Clear Context** removes the pinned context and restores automatic shared-context selection. Saved context is stored locally and sent to your configured API when requesting an answer.

## Privacy

Question text, options and attached media are sent to the endpoint you configure. Use only endpoints you trust. Plain `http://` endpoints transmit the API key unencrypted.

## Development

```bash
npm install
npm test          # DOM tests (jsdom) and service worker tests
npm run icons     # regenerate PNG icons (requires canvas)
```

## Layout

- `background/service-worker.js`: API calls, prompt building, session history.
- `content/content.js`: question detection, buttons, auto-fill.
- `popup/`: settings UI.
- `tests/`: `content-dom.test.js` (DOM behaviour), `service-worker.test.js` (API helpers and prompts).

Context audio and video are never automatically inherited, decoded, or uploaded. Paste their transcript into Edit Context manually. Media directly attached to a question is handled separately.
