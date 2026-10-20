# Stilura for Chrome

Three writing actions backed by the local Stilura app:

- Select text → **Rewrite** → type a request into the single input. **Enter** sends, **Shift + Enter** adds a line, **Esc** closes. Replacements use the same `/ask` endpoint as the app; explanations leave the field unchanged.
- Type `/instructions` → **Enter** → streamed preview inside the field. The slash disappears visually as you type; the request and result use a blue highlight. **⌘/Ctrl + Enter** also works. The underlying field stays unchanged until **Tab** accepts or you click/type to edit the result; **Esc** restores the command.
- Pause at a paragraph end → gray continuation at the cursor. No popover interrupts typing. Matching typed characters consume the suggestion and keep its remainder.

**Tab** accepts a replacement or continuation. Clicking a completed replacement or typing into it accepts it and opens normal editing at the caret. **R** or **Alt + Enter** regenerates a replacement. **↑/↓** switches available variants. **Esc** dismisses. Failed or cancelled regeneration restores the previous candidate. Focus returns to the field after a response.

**⌘/Ctrl + Enter** requests a continuation when there is no selection or slash command, including when automatic suggestions are off.

## Install

1. Start this checkout with `npm start`. Set up a model in the app if needed.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this `extension` folder.
3. Open the Stilura extension from Chrome's toolbar. Enter the local app address printed at startup, then choose **Connect**. A temporary local tab opens and closes during connection.
4. Reload pages that were already open before installation. Select a model in extension settings, or keep **App default**.

For the configured local Qwen, select **Qwen 3.5 4B (Rapid-MLX local) · local-qwen**. Keep its local model server running in Rapid-MLX Desktop. The model choice survives reconnecting to Stilura; an unavailable selection is reported instead of silently switching providers.

Keep the local app running. Reconnect after restarting it: connection credentials expire with the server process. Desktop builds use a dynamic port; use the URL printed by that process. The extension does not start or upgrade the app.

## Supported fields

Text/search/URL/telephone inputs, textareas and basic contenteditable fields, including permitted frames. Native Chrome undo restores accepted edits. The extension checks that the field still contains the original text before applying a result.

Complex editors (CodeMirror, Monaco, ProseMirror, Slate, Lexical, Google Docs and similar products) need dedicated adapters and are not supported in this version. Recognized rich editor roots and embedded non-text content are skipped. Browser-protected pages are unavailable. Fields over 60,000 characters are skipped.

Plain Enter launches generation only after a slash was typed in the current field. Pasted commands use ⌘/Ctrl + Enter; Escape exits command mode. Tab is intercepted only while a completed suggestion is ready; Shift+Tab retains normal navigation.

Generation and replacement previews cover the original range inside the field, without action buttons. The preview follows field typography, wrapping and scrolling; long results can be scrolled before acceptance. Ordinary contenteditable markup is preserved when applying a selection. App and extension share command parsing, paragraph eligibility, the 200 ms / 15-character suggestion threshold, type-through rules and replacement deduplication. The server supplies the same author style; document-specific app briefs and notes are not copied into browser fields.

## Privacy and controls

Use **Enable Stilura** to pause all actions, or disable automatic continuations separately. Password fields, payment autocomplete fields and one-time codes are excluded. A request sends the active field's text to the local app and its selected model provider. It does not send the whole page or save browser text into a workspace draft.

The connection token stays in trusted extension storage, outside content scripts. Extension access is restricted to model status and the writing AI routes. It cannot read workspace files or change provider credentials.

## Checks

`npm run check` includes server authentication and route-isolation checks. `npm run test:extension` loads the real extension in a disposable Google Chrome profile against the existing local fake-model fixture. It requires Playwright available to Node; set `PLAYWRIGHT_MODULE` to an installed Playwright package path if it lives outside this repo. `CHROME_PATH` can select a Chrome binary; the default is the macOS Google Chrome installation. No real provider credentials are used in this test.

Run `EXTENSION_QWEN=1 npm run test:extension` to repeat the three core flows with the configured local Qwen instead of the fixture. This uses synthetic Russian text, a disposable Chrome profile and a temporary draft path, and verifies that browser text is not saved there.

## Shared editor code

Both frontends import `extension/writing-rules.js` for command parsing, continuation eligibility, review keys, variant validation and regeneration instructions. `extension/editor-ui.js` owns the rewrite input, pixel loader and their CSS, including skeletons and reduced motion. Change these modules to update both editors.

`src/app.js` adapts these controls to CodeMirror; `extension/content.js` adapts them to native fields and contenteditable. Positioning, selection, applying edits, undo and cancellation stay with their editor APIs. Requests and model prompts are shared by the server in `index.js` and `tasks.js`.
