import { Decoration } from '@codemirror/view';
import { StateField } from '@codemirror/state';

// ── Markdown, minimal ────────────────────────────────────────────────────────
//  The text stays plain: every marker remains in the draft, dimmed, and what
//  it marks is styled in place — headings, bold, italic, `code`, links, quotes,
//  list markers, rules. Nothing is replaced or hidden; a widget would put the
//  caret and the notes' character offsets out of step with what is typed.
//  Fences and `inline code` are left unparsed. Rebuilt per edit over the whole
//  draft — a regex pass, cheap at prose length.
// ponytail: whole-draft rescan per keystroke, visible-range only if a draft ever outgrows it.
const MD_INLINE = new RegExp([
  '(?<code>`[^`\\n]+`)',
  '\\*\\*\\*(?=\\S)(?<both>.+?)(?<=\\S)\\*\\*\\*',
  '\\*\\*(?=\\S)(?<bold>.+?)(?<=\\S)\\*\\*',
  '(?<![*\\w])\\*(?=[^\\s*])(?<em>.+?)(?<=[^\\s*])\\*(?![*\\w])',
  '(?<![\\w_])_(?=[^\\s_])(?<un>.+?)(?<=[^\\s_])_(?![\\w_])',
  '\\[(?<link>[^\\]\\n]+)\\](?<url>\\([^)\\s]+(?:\\s+"[^"\\n]*")?\\))',
].join('|'), 'g');
const mdMark = Decoration.mark({ class: 'cm-md-mark' });
const mdBold = Decoration.mark({ class: 'cm-md-b' });
const mdItalic = Decoration.mark({ class: 'cm-md-i' });
const mdBoldItalic = Decoration.mark({ class: 'cm-md-b cm-md-i' });
const mdCode = Decoration.mark({ class: 'cm-md-code' });
const mdLink = Decoration.mark({ class: 'cm-md-link' });
const mdHeading = Decoration.line({ class: 'cm-md-h' });
const mdQuote = Decoration.line({ class: 'cm-md-quote' });
const mdRule = Decoration.line({ class: 'cm-md-rule' });
const MD_RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const MD_LIST = /^\s*([-*+]|\d+[.)])(?=\s)/;

function markdownDecorations(doc) {
  const ranges = [];
  let fence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (/^\s*(```|~~~)/.test(text)) { fence = !fence; continue; }
    if (fence) continue;
    if (MD_RULE.test(text)) { ranges.push(mdRule.range(line.from)); continue; }
    const heading = /^(#{1,6})(?=\s)/.exec(text);
    if (heading) {
      ranges.push(mdHeading.range(line.from), mdMark.range(line.from, line.from + heading[1].length));
    } else if (text.startsWith('>')) {
      ranges.push(mdQuote.range(line.from), mdMark.range(line.from, line.from + 1));
    } else {
      const list = MD_LIST.exec(text);
      if (list) ranges.push(mdMark.range(line.from + list[0].length - list[1].length, line.from + list[0].length));
    }
    for (const m of text.matchAll(MD_INLINE)) {
      const g = m.groups;
      const from = line.from + m.index, to = from + m[0].length;
      if (g.link !== undefined) {
        const open = from + 1, close = open + g.link.length;
        ranges.push(mdMark.range(from, open), mdLink.range(open, close), mdMark.range(close, to));
        continue;
      }
      const [width, deco] = g.code !== undefined ? [1, mdCode]
        : g.both !== undefined ? [3, mdBoldItalic]
        : g.bold !== undefined ? [2, mdBold]
        : [1, mdItalic];
      ranges.push(deco.range(from + width, to - width), mdMark.range(from, from + width), mdMark.range(to - width, to));
    }
  }
  return Decoration.set(ranges, true);
}

export const markdownField = StateField.define({
  create: state => markdownDecorations(state.doc),
  update: (decorations, tr) => tr.docChanged ? markdownDecorations(tr.state.doc) : decorations,
});
