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
