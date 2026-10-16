/**
 * Zrzut widoku do pliku. Kopiujemy wezel widoku do osobnego dokumentu HTML (z wlasnymi, wbudowanymi
 * stylami, jasnym motywem i rozwinietymi sekcjami `<details>`) i prosimy serwer o PDF (przegladarka
 * headless, `/api/pdf`). Gdy serwer nie ma przegladarki, zapisujemy ten sam dokument jako plik HTML —
 * da sie go otworzyc i wydrukowac z dowolnej przegladarki. Widok na ekranie zostaje nietkniety.
 */

/** Wszystkie reguly CSS strony jako jeden tekst — dzieki temu zrzut nie zalezy od adresu serwera. */
function pageCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      out.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'));
    } catch {
      /* arkusz z innego pochodzenia — pomijamy */
    }
  }
  return out.join('\n');
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function snapshotHtml(source: HTMLElement, title: string): string {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  clone.querySelectorAll('[data-no-print]').forEach((n) => n.remove());
  /*
   * Tabela dzialow (naglowek + wiersze + przypis) w jednym bloku, ktory zawsze zaczyna nowa strone.
   * Same reguly `break-*` na elementach kolumny flex nie trzymaja naglowka razem z wierszami.
   */
  const head = clone.querySelector('.sum-table-head');
  if (head?.parentElement) {
    const wrap = document.createElement('div');
    wrap.className = 'sum-table-wrap';
    head.parentElement.insertBefore(wrap, head);
    let node: Element | null = head;
    while (node) {
      const next: Element | null = node.nextElementSibling;
      wrap.appendChild(node);
      node = next;
    }
  }
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><base href="${location.origin}/"><title>${esc(title)}</title>
<style>${pageCss()}</style>
<style>
  @page { margin: 12mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { height: auto !important; overflow: visible !important; background: #fff; }
  .sum-scroll { overflow: visible !important; height: auto !important; }
  .sum-dept, .sum-tile, .sum-row { break-inside: avoid; }
  .sum-chart { break-inside: avoid; }
  /* Tabela dzialow zawsze zaczyna nowa strone, razem ze swoim naglowkiem. */
  .sum-table-wrap { display: block; break-before: page; }
  .sum-table-wrap > * { margin-bottom: var(--s2); }
</style></head><body>${clone.outerHTML}</body></html>`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Pobiera PDF; przy braku przegladarki po stronie serwera pobiera HTML. Zwraca, co zapisano. */
export async function downloadSnapshot(source: HTMLElement, title: string): Promise<'pdf' | 'html'> {
  const html = snapshotHtml(source, title);
  const safe = title.replace(/[\\/:*?"<>|]/g, '-');
  try {
    const res = await fetch('/api/pdf', { method: 'POST', body: html });
    if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
      download(await res.blob(), `${safe}.pdf`);
      return 'pdf';
    }
  } catch {
    /* serwer nieosiagalny — spadamy do HTML */
  }
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safe}.html`);
  return 'html';
}
