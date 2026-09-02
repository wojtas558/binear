import type { ReactNode } from 'react';
import { CheckIcon } from './icons';

/**
 * Adres portalu do linkow we wzmiankach. Ustawiany raz po wczytaniu konfiguracji —
 * renderer jest czysta funkcja, a domeny nie chcemy zaszywac w kodzie.
 */
let portalBase = '';
export function setPortalBase(url: string | null) {
  portalBase = url ?? '';
}

/**
 * Renderer opisow i komentarzy z Bitriksa.
 *
 * Tresc to mieszanka: encje HTML (`&#91;`), resztki BBCode (`[url=…]`) i markdown
 * przeniesiony z poprzedniego narzedzia (naglowki, listy, tabele, bloki kodu,
 * checkboxy) — zadania byly do Bitriksa zaimportowane, nie pisane od zera.
 * Najpierw normalizujemy dwa pierwsze, potem parsujemy markdown.
 *
 * Budujemy elementy Reacta, NIE wstawiamy HTML-a przez dangerouslySetInnerHTML —
 * opis zadania jest trescia od uzytkownikow i nie ma powodu jej ufac.
 */

const ENTITIES: Record<string, string> = {
  '&#91;': '[',
  '&#93;': ']',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#9[13];|&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * BBCode i markdown wystepuja OBOK siebie — czesc opisow przyszla z importu
 * (markdown), czesc pisano wprost w Bitriksie (BBCode), a bywa i jedno, i drugie
 * w tym samym tekscie. Znaczniki blokowe zamieniamy na markdown, inline zostaja
 * i sa rozpoznawane przez tokenizer nizej. Nic nie jest tracone po drodze.
 */
function bbToMarkdown(s: string): string {
  return (
    s
      .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, href, label) => `[${label || href}](${href})`)
      .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href) => `[${href}](${href})`)
      // listy: [list] … [*]pozycja … [/list]. Bitrix bywa, ze zwraca cala liste
      // w jednej linii ([*]a[*]b[*]c) — kazdy [*] zaczyna nowa pozycje, wiec
      // rozbijamy PO znaczniku, nie po znaku nowej linii. Wczesniejsze `^…[*]`
      // lapalo tylko pierwszy marker; reszta przeciekala do tokenizera i `*]b[*`
      // szlo jako kursywa (patrz zadanie #804).
      .replace(/\[\/?list[^\]]*\]/gi, '\n')
      .replace(/\s*\[\*\][ \t]*/gi, '\n- ')
      // cytaty blokowe
      .replace(/\[quote[^\]]*\]([\s\S]*?)\[\/quote\]/gi, (_m, body: string) =>
        `\n${body.trim().split('\n').map((l) => `> ${l}`).join('\n')}\n`,
      )
      // bloki kodu
      .replace(/\[code[^\]]*\]([\s\S]*?)\[\/code\]/gi, (_m, body) => `\n\`\`\`\n${String(body).trim()}\n\`\`\`\n`)
      // znaczniki bez odpowiednika w markdown — zdejmujemy sam znacznik, tresc zostaje
      .replace(/\[\/?(img|color[^\]]*|size[^\]]*|table|tr|td|th|font[^\]]*|center|left|right)\]/gi, '')
  );
}

function normalize(raw: string): string {
  return (
    bbToMarkdown(decodeEntities(raw))
      .replace(/\r\n?/g, '\n')
      /*
       * Naprawa tabeli sklejonej w jedna linie: bywa, ze linia separatora ma doklejony
       * PIERWSZY wiersz danych, np. `|---|---| | a | b |`. Wtedy separator nie pasuje do
       * `RE.sep`, tabela w ogole nie jest rozpoznawana i caly blok ladowal jako akapity.
       * Rozcinamy takie linie z powrotem na dwie. Leniwy `*?` gwarantuje, ze separator
       * konczy sie na OSTATNIEJ kresce przed spacja i kolejnym `|`.
       */
      .replace(/^([ \t]*\|[-:| \t]*?\|)[ \t]+(\|.*)$/gm, '$1\n$2')
  );
}

// ─── Inline ──────────────────────────────────────────────────────────────────

/*
 * Kolejnosc ma znaczenie: kod przed reszta (w kodzie nic nie formatujemy),
 * `**bold**` przed `*italic*`, inaczej gwiazdki rozjada sie nawzajem.
 *
 * BBCode `[b] [i] [u] [s]` lapiemy jako POJEDYNCZE znaczniki (osobno otwarcie i
 * zamkniecie), a nie gotowe pary — parowanie robi stos w `inline()`. Realne opisy
 * z Bitriksa bywaja zagniezdzone i polamane (`[b][i]…[/i][/b]`, `[i]a[/b]`, sierota
 * `[/i]`), a dopasowanie "para na raz" przeciekalo wtedy surowym `[i]`/`[/i]` na
 * ekran (patrz zadanie #114681).
 */
const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)', // `kod`
    '(\\*\\*[^*\\n]+\\*\\*)', // **pogrubienie**
    '(~~[^~\\n]+~~)', // ~~przekreslenie~~
    '(\\*[^*\\n]+\\*)', // *kursywa*
    '(\\[[^\\]\\n]*\\]\\([^)\\s]+\\))', // [tekst](url)
    '(\\[USER=\\d+\\][\\s\\S]*?\\[/USER\\])', // wzmianka o uzytkowniku (Bitrix)
    '(\\[/?(?:b|i|u|s)\\])', // pojedynczy znacznik BBCode — parowanie robi stos
    '(<https?://[^>\\s]+>)', // <adres> — w tej postaci wyszly adresy z importu
    '(https?://[^\\s<>()]+)', // goly adres
  ].join('|'),
  'gi',
);

const BB_TAG: Record<string, 'strong' | 'em' | 'u' | 'del'> = {
  b: 'strong',
  i: 'em',
  u: 'u',
  s: 'del',
};

/** Otwarta ramka BBCode: znacznik i tresc uzbierana do jego zamkniecia. */
type BbFrame = { tag: 'strong' | 'em' | 'u' | 'del'; nodes: ReactNode[] };

/*
 * Znaczniki `[b] [i] [u] [s]` parujemy STOSEM. Otwarcie odklada ramke, zamkniecie
 * domyka najblizsza pasujaca (auto-domykajac wnetrze, np. `[b][i]…[/b]`), a
 * zamkniecie bez pary — sierote `[/i]` — po prostu pomijamy. Niedomkniete ramki
 * zamykamy na koncu. Dzieki temu uzytkownik NIGDY nie widzi golego znacznika,
 * choćby zrodlo bylo polamane (patrz #114681). Reszta (kod, `**`, linki, wzmianki)
 * dziala jak wczesniej — trafia do biezaco otwartej ramki albo do korzenia.
 */
function inline(text: string, key: () => number): ReactNode[] {
  const root: ReactNode[] = [];
  const stack: BbFrame[] = [];
  const lower = text.toLowerCase();
  const top = () => (stack.length ? stack[stack.length - 1].nodes : root);
  const closeTop = () => {
    const frame = stack.pop()!;
    const Tag = frame.tag;
    top().push(<Tag key={key()}>{frame.nodes}</Tag>);
  };

  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) top().push(text.slice(last, at));
    const tok = m[0];
    last = at + tok.length;

    // Znacznik BBCode steruje wylacznie stosem — nic z niego nie idzie do tekstu.
    const bb = tok.match(/^\[(\/?)(b|i|u|s)\]$/i);
    if (bb) {
      const letter = bb[2].toLowerCase();
      const tag = BB_TAG[letter];
      if (!bb[1]) {
        // Otwarcie liczymy jako format TYLKO gdy dalej jest jego zamkniecie —
        // inaczej samotne `[i]` (np. indeks `arr[i]` w opisie) zamienialoby
        // reszte akapitu w kursywe. Bez pary znacznik zostaje golym tekstem.
        if (lower.indexOf(`[/${letter}]`, last) >= 0) stack.push({ tag, nodes: [] });
        else top().push(tok);
      } else {
        let idx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) {
            idx = i;
            break;
          }
        }
        // Zamkniecie domyka pasujaca ramke i wszystko nad nia; sierote pomijamy.
        if (idx >= 0) while (stack.length > idx) closeTop();
      }
      continue;
    }

    // [USER=251]Klaudiusz Koder[/USER] — wzmianka; linkujemy do profilu w portalu.
    const mention = tok.match(/^\[USER=(\d+)\]([\s\S]*?)\[\/USER\]$/i);
    if (mention) {
      const [, id, name] = mention;
      const label = `@${name.trim() || `#${id}`}`;
      top().push(
        portalBase ? (
          <a
            key={key()}
            className="mention"
            href={`${portalBase}/company/personal/user/${id}/`}
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        ) : (
          <span key={key()} className="mention">
            {label}
          </span>
        ),
      );
      continue;
    }

    if (tok.startsWith('`')) {
      top().push(<code key={key()}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      top().push(<strong key={key()}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('~~')) {
      top().push(<del key={key()}>{tok.slice(2, -2)}</del>);
    } else if (tok.startsWith('*')) {
      top().push(<em key={key()}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('[')) {
      const cut = tok.indexOf('](');
      const label = tok.slice(1, cut);
      // Zaimportowane opisy maja adres w nawiasach ostrych: [tekst](<https://…>).
      // To NIE jest standardowy markdown, wiec wyglada tu na zbedny przypadek —
      // ale bez zdjecia nawiasow href konczy sie znakiem ">" i link nie dziala.
      const href = tok.slice(cut + 2, -1).replace(/^<|>$/g, '');
      top().push(
        <a key={key()} href={href} target="_blank" rel="noreferrer">
          {label || href}
        </a>,
      );
    } else {
      const href = tok.replace(/^<|>$/g, '');
      top().push(
        <a key={key()} href={href} target="_blank" rel="noreferrer">
          {href}
        </a>,
      );
    }
  }
  if (last < text.length) top().push(text.slice(last));

  // Niedomkniete znaczniki domykamy — tresc zostaje sformatowana, bez golego [i].
  while (stack.length) closeTop();

  return root;
}

// ─── Bloki ───────────────────────────────────────────────────────────────────

const RE = {
  fence: /^\s*```/,
  heading: /^\s*(#{1,6})\s+(.*)$/,
  hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
  check: /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/,
  ul: /^\s*[-*+]\s+(.*)$/,
  ol: /^\s*\d+[.)]\s+(.*)$/,
  quote: /^\s*>\s?(.*)$/,
  row: /^\s*\|(.+)\|\s*$/,
  sep: /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/,
};

const cells = (line: string) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

export function renderDescription(raw: string): ReactNode[] {
  const lines = normalize(raw).split('\n');
  const out: ReactNode[] = [];
  let k = 0;
  const key = () => k++;

  /*
   * Bezpiecznik: `i` posuwa sie recznie w kazdej galezi, wiec jeden przeoczony krok
   * zawiesza CALA karte (tak sie stalo przy tabeli sklejonej w jedna linie). Kazdy
   * obrot petli musi zjesc co najmniej jedna linie, wiec wiecej obrotow niz linii
   * (z zapasem) znaczy, ze stoimy w miejscu — wtedy przerywamy i pokazujemy reszte
   * jako zwykly tekst, zamiast wieszac przegladarke.
   */
  const maxSteps = lines.length + 1000;
  let steps = 0;

  for (let i = 0; i < lines.length; ) {
    if (++steps > maxSteps) {
      out.push(<pre key={key()}>{lines.slice(i).join('\n')}</pre>);
      break;
    }
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Blok kodu ``` … ```
    if (RE.fence.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) body.push(lines[i++]);
      i++; // zamykajaca linia
      out.push(
        <pre key={key()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const h = line.match(RE.heading);
    if (h) {
      // Naglowki markdown mapujemy na h3/h4 — h1 nalezy do tytulu zadania.
      const Tag = (h[1].length <= 2 ? 'h3' : 'h4') as 'h3' | 'h4';
      out.push(<Tag key={key()}>{inline(h[2], key)}</Tag>);
      i++;
      continue;
    }

    if (RE.hr.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }

    // Tabela: wiersz z `|`, a pod nim linia separatora.
    if (RE.row.test(line) && i + 1 < lines.length && RE.sep.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && RE.row.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        <div className="md-table-wrap" key={key()}>
          <table>
            <thead>
              <tr>
                {head.map((c) => (
                  <th key={key()}>{inline(c, key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r) => (
                <tr key={key()}>
                  {r.map((c) => (
                    <td key={key()}>{inline(c, key)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Lista zadan `- [ ]` / `- [x]` — w tych opisach to "Definition of Done".
    if (RE.check.test(line)) {
      const items: { done: boolean; text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(RE.check);
        if (!m) break;
        items.push({ done: m[1].toLowerCase() === 'x', text: m[2] });
        i++;
      }
      out.push(
        <ul className="md-checks" key={key()}>
          {items.map((it) => (
            <li key={key()} className={it.done ? 'md-check-done' : undefined}>
              <span className="check-box">{it.done ? <CheckIcon /> : null}</span>
              <span>{inline(it.text, key)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (RE.ul.test(line) || RE.ol.test(line)) {
      const ordered = RE.ol.test(line) && !RE.ul.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? RE.ol : RE.ul);
        if (!m || RE.check.test(lines[i])) break;
        items.push(m[1]);
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={key()}>
          {items.map((it) => (
            <li key={key()}>{inline(it, key)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    if (RE.quote.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(RE.quote);
        if (!m) break;
        body.push(m[1]);
        i++;
      }
      out.push(<blockquote key={key()}>{inline(body.join(' '), key)}</blockquote>);
      continue;
    }

    // Akapit — laczymy kolejne linie az do pustej albo poczatku innego bloku.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l)) break;
      if (RE.check.test(l) || RE.ul.test(l) || RE.ol.test(l) || RE.row.test(l)) break;
      para.push(l);
      i++;
    }
    if (para.length) out.push(<p key={key()}>{inline(para.join(' '), key)}</p>);
    else {
      /*
       * Linia WYGLADA na poczatek bloku, ale zaden blok jej nie przyjal — w praktyce
       * wiersz `|…|` bez poprawnej linii separatora pod spodem (tabela sklejona w jedna
       * linie). Petla akapitu zrywa sie wtedy od razu, `para` zostaje puste i `i` NIE
       * rusza sie z miejsca: `for` kreci sie w kolko i zawiesza cala karte.
       * Dlatego zawsze robimy krok naprzod i pokazujemy taka linie jako zwykly akapit.
       */
      out.push(<p key={key()}>{inline(line, key)}</p>);
      i++;
    }
  }

  return out;
}
