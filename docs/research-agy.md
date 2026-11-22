# Исследование Stilura (0.7.4)

Дата: 2026-11-22  
Область: Node-сервер (`index.js`, `live-session.js`, `document-store.js`, `pi.js`, `claude-code.js`, `tasks.js`, `suggestions.js`, `review.js`, `chat-edits.js`), фронтенд (`src/`), Chrome-расширение (`extension/`), `macos-writer/`. Код не изменялся, коммиты не делались.

---

## 1. Запуск тестов и приложения

| Проверка | Команда | Результат | Подробности |
|---|---|---|---|
| Стандартный `npm test` | `npm test` | **FAIL (exit 1)** | `npm error Missing script: "test"` — в `package.json` нет скрипта `test`, используется `npm run check`. |
| Основные проверки | `npm run check` | **PASS (exit 0)** | Прошли `node --check`, `npm run build` (`public/app.js` 1.1 MB), `selfcheck.js` (904 модели Pi) и все 16 Node/HTTP-тестов (`editor-rules`, `suggestions`, `generation`, `passage`, `generation-http`, `tasks-http`, `live`, `work`, `live-http`, `recovery`, `oauth`, `mcp`, `safetycheck`, `storage-migration`, `persistence`, `ui`). |
| Браузерная фикстура | `npm run test:browser` | **HANGS (не тест)** | `tests/browser-fixture.mjs` поднимает интерактивный dev-сервер с фейковым провайдером и не завершается сам, несмотря на префикс `test:`. |
| E2E-тесты редактора | `npm run test:editor` | **FAIL (exit 1)** | `TimeoutError: Timed out after 30000 ms while waiting for the WS endpoint URL to appear in stdout!` в `tests/generation-edit-browser.mjs:33`. Подтягивает `puppeteer-core` из глобального `/Users/vadim/node_modules`, зависимость не указана в `package.json`. |
| E2E-тесты расширения | `npm run test:extension` | **FAIL (exit 1)** | `Error: Cannot find module 'playwright'` в `tests/extension-browser.mjs:10`. `playwright` отсутствует в `devDependencies` (`package.json`). |
| `macos-writer/` | `cd macos-writer && swift test` | **FAIL** | `Could not find Package.swift`. В каталоге лежат `Sources/QuietWriter`, `Tests/QuietWriterTests` и старые артефакты `.build/`, `build/Quiet Writer.app` (выглядит как заброшенный прототип рядом с `src-tauri/`). |
| Запуск приложения | `PORT=3099 DRAFT_FILE=<tmp>/draft.md STILURA_NO_OPEN=1 node index.js` | **PASS** | Сервер стартует, отвечает `200` на `/`, `/api/version`, `/api/agent/status` (**284 KB несжатого JSON**), `/api/agent/oauth/status`, `/draft`, `/files`, `/harper.wasm` (19.8 MB), `PUT /draft` сохраняет с проверкой ревизии, `POST /ask` валидирует пустую инструкцию (`400`). |

---

## 2. Баги и слабые места по основным сценариям

### 2.1. Cmd+K rewrite (`src/features/passage.js`, `src/app.js`, `index.js`, `chat-edits.js`, `extension/content.js`)

- **Небезопасный `response.json()` в `requestPassage`** (`src/features/passage.js:148`): в отличие от `src/api.js:6-9` и `src/features/generate.js:278`, при не-JSON ответе (например, ошибке прокси/сервера) падает сырой `SyntaxError`, из-за чего `modelError()` (`src/notices.js:36`) не распознаёт HTTP-код и предлагает неверное действие.
- **Противоречивый промпт для `POST /ask`** (`index.js:673-675` + `chat-edits.js:6-15`): маршрут `/ask` склеивает строгую инструкцию «заменить ТОЛЬКО выделение» с `CHAT_EDITS_PROMPT`, который прямо говорит модели *"A selection is context, not an automatic rewrite request"* и *"Outside the selection, quote enough context to uniquely identify the passage"*. При этом `index.js:681-683` жёстко отклоняет ответ, если хотя бы один edit вышел за границы `body.from`/`body.selected`, и **не делает ретрая** (в отличие от `tasks.js:85-110` с 3 попытками и `/write` в `index.js:729-764` с 2 попытками).
- **Потеря HTTP-кодов провайдера** (`index.js:686, 863, 891` + `src/notices.js:36, 48`): `/ask` оборачивает любую ошибку в `502`, `/rewrite` и `/suggest` — в `500`. `modelError()` ищет статус только в начале `error.message` (`/^(?:HTTP |Server error )?([45]\d\d)\b/`). Если ошибка Pi не начинается с 3 цифр (например, `Pi model ... is not authenticated`), пользователь получает общее «The model could not answer» с кнопкой `Retry` вместо `Open settings`.
- **Глобальный перехват `Cmd/Ctrl+K`** (`src/app.js:2719-2724`): проверяется только `!settingsDialog.open`. При открытом диалоге истории/поиска файлов или фокусе в поле фильтра сайдбара `Cmd+K` перехватывает событие и открывает тултип поверх/позади модалки.
- **Сброс выделения при открытии `Cmd+K`** (`src/features/passage.js:60`): `openPassage` сразу схлопывает выделение в `{ anchor: range.to }`. При отмене по `Escape` исходное выделение не восстанавливается.
- **Неработающий Retry после закрытия поля** (`src/features/passage.js:173` vs `:131`): callback `() => requestPassage(view, previous)` тихо выходит (`if (!target) return`), если пользователь закрыл поле до нажатия `Try again`.
- **Несогласованность хоткеев в Chrome-расширении** (`extension/content.js:476-486`): расширение не биндит `Cmd/Ctrl+K` (переписывание выделения запускается только по `Cmd/Ctrl+Enter`).

### 2.2. Генерация через `/` (`src/features/generate.js`, `index.js`, `review.js`, `extension/writing-rules.js`, `extension/content.js`)

- **Ложное срабатывание `/` на путях и тексте со слэшем** (`extension/writing-rules.js:35-41`, `src/features/generate.js:52-60, 82-97, 213-224`): если на строке уже есть `/etc/hosts` или `/api/draft` и курсор стоит в конце строки, `slashRequest` (при `typedSlash === null`, например после навигации по документу) воспринимает её как slash-команду: **визуально прячет символ `/`** (`hiddenSlash` на `src/features/generate.js:91, 96`), подсвечивает хвост строки и **перехватывает `Enter`** для запуска LLM вместо переноса строки.
- **Мёртвая кнопка `Try again` при ошибке `/write`** (`src/features/generate.js:295`): в `notifyProblem(..., null, 'Try again', 'write-error')` передаётся `null` вместо функции повтора, поэтому кнопка никогда не рендерится (`src/notices.js:159`).
- **Срыв без ретрая после MCP-вызовов** (`index.js:760`): `if (attempt === 1 || usedTools) throw new Error(problem)` — если модель вызвала MCP-инструмент, но забыла обернуть ответ в `<stilura-text>...</stilura-text>`, сервер сразу рвёт стрим без попытки переформатировать результат.
- **Порча отступов при `.trim()` на каждом чанке** (`src/features/generate.js:286, 290`): `answer.trim()` срезает ведущие пробелы/отступы (например, вложенные пункты списка Markdown) и во время стрима, и при принятии.
- **Молчаливый сброс генерации при внешнем/live-изменении** (`src/features/generate.js:18-26`, `src/app.js:2934`): любое изменение диапазона `[from, to]` обнуляет `generationField` и абортит `generate.job()` без уведомления пользователя.
- **Сброс `armed` при правке опечатки в расширении** (`extension/content.js:178, 440-442`): `slash(now)` требует курсор строго в конце строки. Сдвиг курсора влево для исправления опечатки в `/команде` обнуляет `armed`, после чего `Enter` в конце строки вставляет перевод строки вместо генерации.

### 2.3. Continuations (`src/features/suggest.js`, `src/editor/ghost.js`, `suggestions.js`, `pi.js`, `index.js`, `extension/content.js`)

- **Длинные черновики (>60k символов) полностью ломают `/suggest` с `413`** (`index.js:619` vs `suggestions.js:3-15`): `suggestions.js` специально реализует `cursorWindow()` (8000 символов до / 1500 после), чтобы не переполнять контекст. Но `index.js:619` рубит любой POST с `body.document.length > 60_000` ошибкой `413` ещё до входа в `/suggest`, а клиент (`src/features/suggest.js:112`) шлёт весь документ целиком. Та же проблема затрагивает `/ask` и `/write` на длинных текстах.
- **Двойной `state.doc.toString()` на каждое нажатие клавиши** (`src/features/suggest.js:49` + `:16`): `suggestSchedule()` материализует весь документ в строку для проверки `doc.trim().length < SUGGEST_MIN`, а затем `atParagraphEnd()` вызывает `state.doc.toString()` второй раз. На длинном черновике это лишние аллокации на каждый символ вместо O(log N) операций `state.doc.length` / `state.doc.lineAt()`.
- **Слишком агрессивный debounce `SUGGEST_DELAY = 200` ms** (`extension/writing-rules.js:2`): при обычном наборе паузы 200–350 мс между словами постоянно шлют запросы в LLM (с полным телом документа), расходуя квоту/лимиты подписки ChatGPT и провоцируя `429`.
- **Битый обрыв при `stopReason === 'length'`** (`pi.js:354-355`): при ответе `TEXT: word` (одно слово после метки) `text.search(/\s+\S*$/u)` находит пробел после `TEXT:` и возвращает `"TEXT:"`, что ломает `parseSuggestion` (`suggestions.js:72-73`) и тратит лишний ретрай.
- **Общий `sessionId: 'stilura-suggest'` для всех черновиков и вкладок** (`pi.js:335`): кэш промпта OpenAI-провайдеров делят между собой разные документы.
- **Расширение не блокирует авто-continuations для `claude-code`** (`extension/background.js:119` vs `src/app.js:1013`): в основном редакторе фоновые подсказки отключены для Claude Code (и без объяснения в UI), а в расширении такого запрета нет — каждые 200 мс паузы будет спавниться процесс `claude-agent-acp` + `claude`.

### 2.4. Сохранение черновика (`document-store.js`, `live-session.js`, `src/live.js`, `src/app.js`, `index.js`)

- **Неограниченный рост `.stilura-history/` на диске** (`document-store.js:104-106`, `live-session.js:180`): каждые 10 секунд редактирования пишется полный JSON-снапшот документа. `history()` читает только последние 20 (`document-store.js:80`), но старые файлы никогда не удаляются.
- **Утечка сессий и синхронный `fs.readFileSync` каждые 500 мс на каждый открытый файл** (`live-session.js:78-89, 421`): каждый файл, открытый через сайдбар, создаёт запись в `sessions` и таймер `setInterval(..., 500)` с полным чтением файла и SHA-256. Сессии никогда не закрываются до остановки сервера (кроме rename/delete) и держат `.stilura-session` на диске.
- **`POST /draft/open` не верифицирует чужой `.stilura-session`** (`index.js:586` vs `:124, 158`): вызывает синхронный `sessions.get(file)` вместо `sessions.getVerified(file)`. Если остался осиротевший `.stilura-session` с переиспользованным PID, файл из сайдбара не откроется (`409`).
- **Переподключение SSE с устаревшим `since` в URL** (`src/live.js:134`): `EventSource` подписывается на фиксированный URL с `since=<начальная версия>`. При авто-переподключении после обрыва связи/сна ноутбука сервер получает старый `since` (переигрывает весь лог с начала или отдаёт `reset` после сдвига `baseVersion` > 2000 обновлений).
- **Утечка ключей `wa-working:<tabId>` в `localStorage`** (`src/app.js:170-171, 2996`): каждая вкладка пишет дубликат черновика под уникальным `tabId` и никогда его не очищает (`removeItem` удаляет только базовый ключ). Вместе с 10 полными снапшотами в `localStorage` это быстро исчерпывает лимит 5 MB на средних/больших черновиках.
- **Падение `documentStore` при несуществующей поддиректории `DRAFT_FILE`** (`document-store.js:37`): `fs.realpathSync(path.dirname(resolved))` бросает `ENOENT`, если передать `DRAFT_FILE=./subdir/draft.md`.

### 2.5. Выбор провайдера (`pi.js`, `claude-code.js`, `src/app.js`, `index.js`, `extension/popup.js`)

- **Холодный старт дочерних процессов `claude` + `claude-agent-acp` на каждый запрос** (`claude-code.js:27-38, 49-61, 71-80`): `askClaudeCode` на каждый вызов сначала запускает `claude auth status` (до 5 сек), затем спавнит `claude-agent-acp` и поднимает новую ACP-сессию. То же делает `GET /api/agent/status` (`pi.js:74`) без кэширования.
- **284 KB несжатого JSON на каждый `GET /api/agent/status`** (`pi.js:77-88, 116-117`, `index.js:249-252`): список из ~904 моделей дублируется дважды (в `models[]` и внутри `providers[].models[]`), `sendJson` не применяет gzip.
- **Зависание OAuth-сессии без TTL** (`pi.js:155, 198-200, 208`): если пользователь закрыл вкладку входа ChatGPT и не нажал Cancel, `oauthSession` остаётся в состоянии `url`/`device` бессрочно и блокирует повторный запуск OAuth ошибкой `409 A sign-in is already in progress`.
- **Устаревшая модель в `localStorage` сбрасывает настройки в онбординг** (`src/app.js:495-510, 553-555`): когда сохранённая модель временно недоступна, `currentAgent()` возвращает `null`, и `openSettings()` включает `guided = 'true'` («Connect your writing assistant») вместо показа предупреждения о недоступной выбранной модели.
- **Расширение хардкодит `thinkingLevel: 'off'`** (`extension/popup.js:12`) и **`streamText` не обрабатывает `mandatoryReasoning`** (`pi.js:369-388` vs `completeText` на `pi.js:338-341`): модели с обязательным reasoning падают на `/write` и на `/ask` из расширения.
- **Claude Code молча игнорирует MCP-инструменты и `maxTokens`** (`pi.js:324, 361-364`): при выбранном Claude Code настроенный `~/.config/stilura/mcp.json` не подключается без какого-либо предупреждения.

---

## 3. Приоритизированный список улучшений (P0 / P1 / P2)

### P0 — Критические (поломка основных сценариев, риск потери данных / ресурсов)

1. **Починить лимит 60k для `/suggest` (и окно контекста для `/ask`, `/write`)** — `index.js:619`, `src/features/suggest.js:112`, `suggestions.js:7-15`.  
   Либо вырезать окно на клиенте/исключить `/suggest` из жёсткого `60_000` лимита (используя `cursorWindow`), либо применять оконный контекст и для `/ask`/`/write` на длинных документах.
2. **Устранить ложное срабатывание `/` на существующих строках с путями/слэшами** — `extension/writing-rules.js:35-41`, `src/features/generate.js:52-60, 82-97, 213-224`.  
   Активировать режим команды только когда `/` был реально введён (`typedSlash`) или стоит в начале пустой строки, не прятать `/` и не перехватывать `Enter` на обычном тексте вида `See /etc/hosts`.
3. **Добавить очистку (retention) для `.stilura-history/`** — `document-store.js:103-106`, `live-session.js:180`.  
   Ограничить количество хранимых снапшотов на диске (например, 50–100 последних или по суммарному размеру), удаляя старые после записи нового.
4. **Убрать утечку сессий и синхронный 500ms-поллинг всех открытых файлов** — `live-session.js:78-89, 421`.  
   Закрывать неактивные сессии (без подписчиков SSE и без недавних запросов), перейти на `fs.watch` или проверять `mtimeMs`/`size` через `fs.stat` перед `readFileSync` + SHA-256.
5. **Использовать `sessions.getVerified(file)` в `POST /draft/open`** — `index.js:586`.  
   Привести к поведению `index.js:124, 158`, чтобы осиротевший `.stilura-session` не блокировал открытие файлов из сайдбара.
6. **Заменить `response.json()` в `requestPassage` на безопасный парсинг** — `src/features/passage.js:148`.  
   Читать текст с fallback, как в `src/api.js:6-10`, чтобы не терять HTTP-статус и не падать с `SyntaxError`.
7. **Кэшировать статус `claude auth status` и переиспользовать/оптимизировать `claude-code.js`** — `claude-code.js:27-38, 49-61, 71-80`, `pi.js:74`.  
   Не запускать `claude auth status` на каждый `/api/agent/status` и на каждый запрос; добавить TTL-кэш статуса (сброс по кнопке Recheck) и, по возможности, пул/переиспользование ACP-сессии.
8. **Добавить скрипт `test` и недостающие test-зависимости / исправить E2E-скрипты** — `package.json:58-75`, `tests/extension-browser.mjs:10`, `tests/generation-edit-browser.mjs:33`.  
   Добавить `"test": "npm run check"`, переименовать `test:browser` в `dev:fixture` (или сделать авто-завершаемым), явно задекларировать или опционально проверять `puppeteer-core` / `playwright`.

### P1 — Высокий приоритет (UX-баги, надёжность, производительность)

9. **Привести в порядок промпт и ретрай для `POST /ask`** — `index.js:671-686`, `chat-edits.js:6-21`.  
   Убрать противоречие с `CHAT_EDITS_PROMPT` (выделить строгий промпт для single-span `/ask`), добавить 1 автоматический ретрай при выходе за границы выделения (как в `tasks.js:85-110`), фильтровать валидные варианты вместо отказа на всём ответе.
10. **Пробрасывать структурированный статус/код ошибки провайдера в `modelError`** — `index.js:686, 863, 891`, `src/notices.js:26-54`.  
    Возвращать реальный HTTP-статус или поле `code`/`status`, чтобы `401/403/413/429` и ошибки авторизации Pi всегда вели в `Open settings` или показывали корректный backoff.
11. **Починить кнопку `Try again` для `/write` и `requestPassage`** — `src/features/generate.js:295`, `src/features/passage.js:173`.  
    Передать рабочий callback повтора в `notifyProblem` для `/write`; в `passage.js` переоткрывать/перепроверять target при нажатии Retry.
12. **Исправить переподключение `EventSource` с устаревшим `since`** — `src/live.js:134-137`.  
    Либо пересоздавать `EventSource` с актуальным `getSyncedVersion(c.state)` при `onerror`/переподключении, либо передавать `Last-Event-ID` на сервере (`index.js:431-440`).
13. **Убрать двойной `state.doc.toString()` на каждый keystroke и пересмотреть `SUGGEST_DELAY`** — `src/features/suggest.js:13-17, 49`, `extension/writing-rules.js:2`.  
    Проверять длину и конец абзаца через `state.doc.length` и `state.doc.lineAt(head)`; увеличить дефолтный `SUGGEST_DELAY` (например, 400–600 мс) или сделать настраиваемым.
14. **Ограничить область действия `Cmd/Ctrl+K` и сохранять выделение при `Escape`** — `src/app.js:2719-2724`, `src/features/passage.js:60, 64-69`.  
    Не перехватывать `Cmd+K`, если открыт любой `<dialog>` или фокус не в редакторе; восстанавливать `{ anchor: from, head: to }` при отмене по `Escape`.
15. **Сохранять отступы при генерации `/write` и поддержать ретрай формата после MCP** — `src/features/generate.js:286, 290`, `index.js:750-764`.  
    Не вызывать `.trim()` по обе стороны (достаточно `trimEnd()` или аккуратного снятия только крайних переводов строк тега); разрешить format-only retry после `usedTools`.
16. **Добавить TTL для `oauthSession` и обработать `mandatoryReasoning` в `streamText`** — `pi.js:155, 198-208, 369-388`, `extension/popup.js:12`.  
    Автоматически сбрасывать зависший OAuth по таймауту (например, 10–15 мин); поддержать fallback `mandatoryReasoning` в `streamText`; передавать корректный `thinkingLevel` из расширения.
17. **Сжать и дедуплицировать `GET /api/agent/status`** — `pi.js:77-88, 116-117`, `index.js:249-252`.  
    Не дублировать 904 модели в `providers[].models` и `models[]` (или включить gzip в `sendJson` для ответов >1 KB).
18. **Починить обрезку `stopReason === 'length'` для коротких `TEXT:`/`WORD:`** — `pi.js:354-355`.  
    Не отрезать всё после префикса `TEXT:` / `WORD:`; выполнять обрезку последнего слова только внутри полезного текста после двоеточия.
19. **Не терять `armed` в расширении при правке опечатки в `/команде`** — `extension/content.js:174-181, 440-442`.  
    Отслеживать `armed` пока курсор остаётся на той же строке после `command.from`, а не только на последнем символе строки.

### P2 — Средний приоритет (полировка, консистентность, гигиена)

20. **Очищать старые `wa-working:<tabId>` в `localStorage`** — `src/app.js:168-172, 2996`.  
    Удалять устаревшие табовые копии и ограничивать суммарный размер `snapshots` в `localStorage`.
21. **Изолировать `sessionId` для continuations по документу** — `pi.js:335`, `index.js:883`.  
    Передавать `stilura-suggest:<docId>` вместо глобальной константы `'stilura-suggest'`.
22. **Отображать в Settings причину отключения авто-подсказок для Claude Code и синхронизировать с расширением** — `src/app.js:1013`, `extension/background.js:119`.  
    Добавить запрет фоновых подсказок для `claude-code` в расширении и короткую пометку в UI настроек.
23. **Не сбрасывать Settings в guided-онбординг при временно недоступной модели** — `src/app.js:495-510, 553-559`.  
    Показывать баннер «Saved model X is unavailable» с кнопкой выбора другой модели вместо экрана первого запуска.
24. **Добавить `Cmd/Ctrl+K` в Chrome-расширении и уведомление при сбросе генерации** — `extension/content.js:458-487`, `src/features/generate.js:18-26`.
25. **Создавать родительскую папку для `DRAFT_FILE` или возвращать понятную ошибку** — `document-store.js:37`.
26. **Предупреждать о недоступности MCP при выборе Claude Code** — `pi.js:361-364`.
27. **Убрать или задокументировать статус `macos-writer/`** — `macos-writer/` (нет `Package.swift`, старые артефакты сборки, не связан с `package.json`).

---

### Отложено

Незакрытые замечания reviewer-а (решение оператора: не делать сейчас):

1. Вставка в середину армированной `/команды` не снимает armed (`extension/content.js`; Enter перепроверяет команду).
2. P1 #18: лишний ретрай на prose-слове «Word»/«Text» (`pi.js`, обрезка по `stopReason === 'length'`).
3. Нет теста ретрая `length` после mandatory-reasoning фолбэка (`pi.js`, `tests/pi-length.mjs`).
4. P1 #17: нет теста на гонку `clear`/in-flight для дедупликации `GET /api/agent/status`.

Из финального прохода (low, не блокеры):

- `review.js` / `ai-routes.js` (P1 #15): `preserveIndent` для inline-вставки сохраняет ведущий пробел ответа модели, при `before` с хвостовым пробелом выходит двойной пробел; строка из одних пробелов в начале не снимается.
- `src/features/generate.js`, `src/features/passage.js` (P1 #11): retry при изменённом документе молча делает `return` без уведомления; ветка не покрыта тестом.
- `pi.js` (P1 #16): гонка OAuth success и TTL, `step='done'` может перезаписать `'error'` (`session.timedOut` не проверяется).
- `extension/background.js` (P2 #26): `notice` от `/write` в расширении игнорируется, при нём уходит пустой `send({text:''})`.
- `tests/generation.mjs`: неиспользуемый импорт `appSource`.

**Переиспользовать процесс `claude-agent-acp`** (идея оператора, статус: не начато).

Сейчас `askClaudeCode` (`claude-code.js`) на каждый запрос запускает новый процесс адаптера через `connectAcp`, делает `initialize` + `session/new` + `prompt` и закрывает его в `finally`. Поэтому автоподсказки при паузе отключены для claude-code (`src/app.js` `backgroundAllowed`, `extension/background.js:118`). У `antigravity.js` процесс переиспользуется (`IDLE_TTL` 5 мин, `session/new` + `session/close` на запрос).

Что проверить:
1. Умеет ли `claude-agent-acp` несколько `session/new` в одном процессе и принимает ли `systemPrompt`/`_meta.claudeCode.options` на каждую сессию отдельно.
2. Замерить задержку запроса сейчас (холодный старт) и с тёплым процессом.
3. Что происходит с настройками (`model`, `tools: []`, `maxTurns: 1`, `persistSession: false`) при переиспользовании, нет ли утечки контекста между запросами.

Что сделать при успехе: вынести общий пул процесса из `antigravity.js` в `acp-client.js` (idle TTL, закрытие по abort), перевести `claude-code.js` на него; после замера решить, разрешать ли автоподсказки для Claude (отдельный переключатель в Settings, по умолчанию выключен). Для agy автоподсказки остаются выключены из-за ~19k токенов контекста на запрос.

Также: `settled()` в `tests/files-browser.mjs` ждёт 300 мс тишины, на медленном CI может флакать; нужно ждать конкретного условия.

---

## 4. Почему Claude Code не подключается в standalone-режиме Stilura (`npx stilura` / desktop)

### Воспроизведение

Проверка выполнялась на машине с установленными `/opt/homebrew/bin/claude` (авторизован через `claude.ai`, `subscriptionType: "pro"`) и `/Users/vadim/.nvm/versions/node/v25.5.0/bin/claude-agent-acp`:

1. **В обычном интерактивном shell** (`PATH` включает `/opt/homebrew/bin` и `~/.nvm/versions/node/v25.5.0/bin`):
   - `claudeCodeStatus()` → `{ installed: true, plan: 'pro' }`
   - `askClaudeCode({ systemPrompt: 'Reply with OK only.', userPrompt: 'Say OK' })` → `"OK"`
2. **В окружении macOS GUI / Desktop `.app` (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`)**:
   - `claudeCodeStatus()` → **`{ installed: false, plan: null }`**
3. **В окружении macOS GUI `PATH`, даже с явными `STILURA_CLAUDE_CODE` и `STILURA_CLAUDE_ACP`**:
   - `claudeCodeStatus()` → `{ installed: true, plan: 'pro' }`
   - `askClaudeCode(...)` → **ПАДАЕТ с ошибкой: `Claude Code closed the connection.`**

### Корневые причины

1. **[P0] Desktop sidecar запускается с урезанным системным `PATH` (`src-tauri/src/main.rs:98-118`, `claude-code.js:14-25`)**  
   При запуске `.app` из Finder/Dock/Spotlight `launchd` отдаёт процессу только `/usr/bin:/bin:/usr/sbin:/sbin`. `start_server()` в `src-tauri/src/main.rs:98-118` не подтягивает `PATH` из login shell пользователя, а `executables()` в `claude-code.js:14-25` сканирует **исключительно** `process.env.PATH` — без fallback-каталогов (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.claude/local`, `~/.nvm/versions/node/*/bin`, `~/.volta/bin`, `~/.fnm/...`). В результате ни `claude`, ни `claude-agent-acp` не находятся.
2. **[P0] Шебанг `#!/usr/bin/env node` в `claude-agent-acp` падает под GUI `PATH`, а `stderr` полностью проглочен (`claude-code.js:77-80, 101`)**  
   `claude-agent-acp` — это ESM-скрипт с первой строкой `#!/usr/bin/env node`. В desktop-сборке Stilura использует собственный встроенный sidecar-бинарь `stilura-server`, а `node` отсутствует в `/usr/bin:/bin:/usr/sbin:/sbin`. При `spawn(adapter, [], { env: { ...authEnv(), CLAUDE_CODE_EXECUTABLE: claude }, stdio: ['pipe', 'pipe', 'ignore'] })` `/usr/bin/env node` сразу завершается с кодом 127 (`env: node: No such file or directory`). Из-за `stdio: [..., 'ignore']` ошибка теряется, и пользователь видит только `Claude Code closed the connection.` (`claude-code.js:101`).
3. **[P1] В `npx stilura` (CLI standalone) проблемы с поиском глобального адаптера и диагностикой** (`claude-code.js:27-38`, `public/index.html:260`):
   - `@agentclientprotocol/claude-agent-acp` не входит в `dependencies` пакета `stilura`; при запуске `npx stilura` через другую версию Node (например, Homebrew Node vs `nvm`), `claude-agent-acp`, установленный глобально в другом `nvm`-префиксе, не попадает в `PATH`.
   - В UI (`public/index.html:260`) ссылка `Claude ACP adapter` ведёт на страницу Zed (`https://zed.dev/acp/agent/claude-agent`), а не показывает команду установки `npm i -g @agentclientprotocol/claude-agent-acp` (из `README.md:37`), и `commands()` (`claude-code.js:28-37`) не различает, чего именно не хватает — `claude` или `claude-agent-acp`.
4. **[P1] Хрупкая проверка `claude auth status`** (`claude-code.js:49-61`):
   - Таймаут всего `5000` мс (`claude-code.js:51`): при холодном старте или медленном ответе `claude auth status` `catch` возвращает `undefined`, и статус деградирует в `{ installed: true, plan: null }`.
   - Жёсткая проверка `['pro', 'max'].includes(status.subscriptionType)` и `authMethod === 'claude.ai'` (`claude-code.js:53`) отклоняет аккаунты Team/Enterprise и другие способы входа.
5. **[P1] При ошибке `getAgentStatus()` карточка Claude Code блокируется навсегда** (`pi.js:121-123`, `src/app.js:262, 339`):  
   В `catch` `getAgentStatus()` не возвращает поле `claudeCode`, из-за чего `providerChoices()` не добавляет `claude-code`, и `card.disabled = true`.

### Что нужно для починки (без правки кода сейчас)

- Обогащать `PATH` в `src-tauri/src/main.rs` (login shell) и/или добавить стандартные пути поиска бинарей в `claude-code.js:14-25` (включая `path.dirname(process.execPath)`).
- При запуске JS-адаптера `claude-agent-acp` вызывать его через `process.execPath` (или добавлять `path.dirname(process.execPath)` и `path.dirname(adapter)` в `env.PATH`), а `stderr` собирать в буфер для показа реальной причины падения.
- Разделить в `claudeCodeStatus()` флаги `claudeInstalled` / `adapterInstalled` и показывать точную инструкцию в Settings (`public/index.html:257-262`).

---

## 5. Как подключить Antigravity (`agy`) как ещё одного провайдера в Stilura

### Протокол `agy` (проверено на установленном `/Users/vadim/.local/bin/agy`, v1.5.14)

`agy` **из коробки поддерживает Agent Client Protocol (ACP) v1 по stdio** — тот же самый JSON-RPC 2.0 протокол, что уже реализован в `claude-code.js`, но **без отдельного npm-адаптера** (сервер встроен прямо в бинарь `agy`).

Проверенный вживую обмен с `agy acp --stdio`:
- **`initialize`** (`{ protocolVersion: 1 }`) → возвращает:
  - `protocolVersion: 1`
  - `agentInfo: { name: "Antigravity ACP Server", version: "1.5.14" }`
  - `agentCapabilities._meta.antigravity`: `{ tier: true, systemPrompt: { append: true } }`
  - `authMethods`: `[{ id: "oauth-personal", name: "Log in with Google", ... }]` (интерактивный вход в терминале: `agy acp --login`).
- **`session/new`** (`{ cwd: tmpdir(), mcpServers: [] }`) → возвращает:
  - `sessionId`
  - `models.availableModels`: динамический список моделей `{ modelId, name }` (`gemini-4-neon-medium`, `gemini-4-argon-medium`, `gemini-3.8-flash-low`, `claude-opus-5-5-medium`, `claude-sonnet-5-5-medium`, `gpt-oss-120b-medium` и др.)
  - `configOptions` (включая `id: "model"`), `modes`
  - `_meta.antigravity.tier`: `{ name: "Google AI Pro", id: "g1-pro-tier", ... }` (аналог `plan` в `claude-code.js`).
- **`session/set_model`** (`{ sessionId, modelId }`) → переключает модель на лету (`{}`).
- **`session/prompt`** (`{ sessionId, prompt: [{ type: "text", text }] }`) → стримит `session/update` с `update.sessionUpdate === "agent_message_chunk"` и `update.content.type === "text"` (`update.content.text`), завершается `{"stopReason": "end_turn", "usage": {...}}`.
- *(Альтернатива — non-interactive CLI `agy -p --output-format stream-json --model <id> --effort <level> --disable-slash-commands`, но ACP предпочтительнее: единый транспорт с `claude-code.js`, нативная отмена `session/cancel`, динамический список моделей и статус подписки `tier` прямо в ответе `session/new`.)*

### Важные отличия от `claude-code.js` и ограничения

1. **Системный промпт и инструменты**: в `claude-code.js:128-132` передаётся `_meta.claudeCode.options: { systemPrompt, tools: [], maxTurns: 1 }`. В `agy acp` `agentCapabilities._meta.antigravity.systemPrompt` поддерживает только `append: true` (агентский системный промпт остаётся, ~19k input tokens даже с `--include-default-customizations=false`). Поэтому:
   - нужно передавать `systemPrompt` Stilura с явной инструкцией отвечать только текстом без вызова инструментов;
   - на любые `session/request_permission` от сервера отвечать `{ outcome: { outcome: 'cancelled' } }` (как в `claude-code.js:106-107`);
   - использовать `--include-default-customizations=false`, чтобы не подмешивать пользовательские скиллы/правила в писательские промпты;
   - **переиспользовать один долгоживущий процесс `agy acp --stdio`** (вызывая `session/new` + `session/close` на запрос), а не спавнить процесс каждый раз;
   - отключить фоновые auto-continuations для `antigravity` (по аналогии с `claude-code` в `src/app.js:1013` и `extension/background.js:119`), оставив ручной `Cmd/Ctrl+Enter`, иначе пауза 200 мс будет гонять ~19k input tokens на каждый запрос.
2. **Поиск бинаря в standalone/desktop**: `agy` обычно ставится в `~/.local/bin/agy`, которого нет в GUI `PATH` macOS — поиск бинаря должен проверять `STILURA_AGY` / `PATH` / `~/.local/bin/agy` / `/opt/homebrew/bin/agy` / `/usr/local/bin/agy`.

### Что нужно поменять в Stilura (по аналогии с `claude-code.js`)

| Файл | Изменения |
|---|---|
| `acp-client.js` *(новый, опционально)* | Вынести общий JSON-RPC stdio-транспорт (`initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/update`, обработка `stderr`, обогащённый поиск бинарей) из `claude-code.js:77-155`, чтобы `claude-code.js` и `antigravity.js` не дублировали протокол. |
| `antigravity.js` *(новый)* | Экспортировать `ANTIGRAVITY = 'antigravity'`, `antigravityStatus()` (проверка бинаря `agy` + кэшированный `initialize`/`session/new` для получения `tier` и `availableModels`), `askAntigravity({ systemPrompt, userPrompt, messages, model, signal, onText })` через `agy acp --stdio --include-default-customizations=false` + `session/set_model`. |
| `pi.js` | Импортировать `antigravity.js` (по аналогии со строкой `pi.js:4`): добавить `antigravityStatus()` в `getAgentStatus()` (`pi.js:74, 107-120`), добавить `providers` и `models` (с `thinkingLevels: ['off']`, т.к. effort уже зашит в `modelId`), и роутить `selection?.provider === ANTIGRAVITY` в `completeText()` (`pi.js:324`) и `streamText()` (`pi.js:361`). |
| `package.json` | Добавить `antigravity.js` (и `acp-client.js`) в массив `files` (`package.json:29-57`). |
| `public/index.html` | Добавить карточку `#service-antigravity` в `.model-services` (`public/index.html:202-214`) и блок `#connect-antigravity` с командой `agy acp --login` и кнопкой `#antigravity-recheck` (`public/index.html:257-262`). |
| `src/app.js` | Добавить `antigravityProvider = 'antigravity'` рядом с `claudeProvider`: включить в `providerChoices()` (`src/app.js:262`), `renderModelSettings()` (`src/app.js:312-358`), `renderConnection()` (`src/app.js:375-410`), обработчики клика/recheck (`src/app.js:581-597, 927-931`), и отключить фоновые подсказки в `backgroundAllowed` (`src/app.js:1013`). |
| `extension/background.js` | Отключить авто-continuations при `config.agent?.provider === 'antigravity'` (вместе с `'claude-code'`) в `extension/background.js:119`. |
| `tests/` | Добавить unit-тест с mock-ACP-процессом (по аналогии с `tests/oauth.mjs` / `tests/tasks-http.mjs`) на `initialize`, `session/new`, `session/set_model`, стриминг `agent_message_chunk`, отказ на `session/request_permission` и обработку отмены `AbortSignal`. |
