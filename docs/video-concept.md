# Stilura — Основной сценарий демо-видео («Анти-слоп на живом тексте»)

**Формат:** 28 секунд, 1920 × 1080 (горизонтальный мастер для X / LinkedIn / Product Hunt / README) + 1080 × 1350 (4:5 кроп для ленты). Читается без звука, работает как бесконечный луп.

## Ключевая идея

Никаких вступительных логотипов и абстрактных слоганов. Видео открывается прямо на фразе, перегруженной типичными штампами ChatGPT (*«fast-paced AI landscape», «serves as a testament», «delving»*), и за 25 секунд автор прямо внутри Stilura вычищает из текста весь AI-пафос, собирая честный трёхстрочный питч самого продукта и оставляя за собой последнее слово (`npx stilura`).

---

## Посекундный сценарий (28 с)

| Тайминг | Действие в кадре (крупный план редактора) | Звук / Ритм | Что считывает зритель |
| --- | --- | --- | --- |
| **0.0 – 2.5 с**<br>*(Хук)* | Сразу крупно текст в редакторе (светлая тема Stilura):<br>`In today’s fast-paced AI landscape, Stilura serves as a groundbreaking testament to seamless writing—delving into your workflow.`<br>Курсор резко выделяет всю фразу целиком. | Короткая тишина, затем резкий шорох выделения. | *«Опять этот ChatGPT-слоп… стоп, он сейчас его снесёт?»* |
| **2.5 – 7.5 с**<br>*(Анти-слоп на месте)* | Нажатие `⌘K` → ввод: `kill the AI slop. say what it actually is.` (`Enter`).<br>Поверх выделенной фразы появляется превью:<br>`Stilura is a local Markdown editor where AI suggests and you decide.`<br>Пауза 0.6 с на чтение → `Tab` (принятие). | Быстрый механический набор, мягкий щелчок `Tab`. | Правка прямо на месте без копипаста в чат-бот. Встроенный анти-слоп (`style.md`). |
| **7.5 – 14.0 с**<br>*(Выбор из 3 вариантов)* | Автор выделяет только хвост фразы: `where AI suggests and you decide.` → `⌘K`: `sharper`.<br>Клавишей `↓` быстро листает 3 варианта прямо внутри предложения:<br>1) `that stays out of your way.`<br>2) `that never rewrites your voice.`<br>3) `where you keep the last word.`<br>Нажимает `Tab` на третьем варианте. | Три сухих щелчка `↓` `↓` `Tab`. | Меняется ровно выделенный кусок, а не весь абзац. Варианты перебираются с клавиатуры. |
| **14.0 – 21.0 с**<br>*(Слеш-запрос и `R`)* | На новой строке ввод: `/one line on pricing and models` (`Enter`).<br>Короткий скелетон в геометрии строки → появляется превью:<br>`Bring your own ChatGPT Plus, Claude Code, or API key.`<br>Нажатие `R` (перегенерация) → новый вариант:<br>`No new subscription. Uses your ChatGPT, Claude, or API key.` → `Tab`. | Ритмичный набор, `R`, `Tab`. | Слеш-генерация прямо в документе + работа с уже оплаченными подписками ChatGPT / Claude. |
| **21.0 – 25.0 с**<br>*(Последнее слово за автором)* | На третьей строке после короткой паузы появляется бледный ghost-текст автодополнения:<br>`Try it in your browser.`<br>Автор нажимает `Esc` (отклоняет подсказку ИИ!) и сам вручную печатает:<br>`npx stilura` | `Esc` + 11 чётких ударов по клавишам. | ИИ предлагает, но решает автор — даже когда отвергает подсказку. |
| **25.0 – 28.0 с**<br>*(Финальный кадр / луп)* | Камера плавно отъезжает, открывая спокойное окно Stilura целиком. На листе остаётся готовый текст из трёх строк:<br><br>`Stilura is a local Markdown editor where you keep the last word.`<br>`No new subscription. Uses your ChatGPT, Claude, or API key.`<br>`npx stilura` | Один низкий тёплый аккорд и пауза 2 с для чтения. | Весь питч продукта собран на глазах зрителя и остаётся на экране как готовый документ. |

---

## Текст на финальном экране (итог в редакторе)

```markdown
Stilura is a local Markdown editor where you keep the last word.

No new subscription. Uses your ChatGPT, Claude, or API key.

npx stilura
```

---

## Требования к записи и подаче

1. **Никаких вступительных титров:** первый кадр (`0.0 с`) — уже набранная «слоп-фраза» крупным планом (`iA Writer Duo`, светлая бумажная тема `#f7f5f0`), чтобы текст легко читался с телефона без разворачивания на весь экран.
2. **Честная механика интерфейса:** показывать реальные состояния Stilura — синюю полупрозрачную заливку активного выделения (`--attached-tint`), инлайн-запрос после `/`, скелетон по форме слов (`.cm-passage-busy`), бледный ghost-текст (`.cm-suggest`) и бейджи клавиш (`⌘K`, `↓`, `R`, `Tab`, `Esc`).
3. **Паузы на чтение:** перед каждым нажатием `Tab` оставлять `0.5–0.7 с` статики, чтобы зритель успевал прочитать новую формулировку.
4. **Подпись к посту (X / LinkedIn):**
   - *Вариант 1:* `Every AI tool wants to rewrite your whole document into corporate slop. So I built a local Markdown editor where AI only touches the exact words you select—and uses the ChatGPT or Claude subscription you already pay for.`
   - *Вариант 2:* `We made the launch video edit its own AI slop out in 28 seconds.`
