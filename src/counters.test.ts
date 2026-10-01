import { describe, expect, it } from 'vitest';
import {
  answerState,
  countAll,
  COUNTERS,
  isSubstantiveAnswer,
  MIN_ANSWER_CHARS,
  plainBody,
  previousDay,
  recordDay,
  type ChatMessage,
  type CounterCtx,
} from './counters';

const zadanie = (o: Partial<Parameters<typeof countAll>[0][number]> & { id: number }) => ({
  status: '2',
  sprintId: null,
  tags: [],
  storyPoints: null,
  epicId: 141,
  ...o,
});

const ctx = (o: Partial<CounterCtx> = {}): CounterCtx => ({
  sprintId: 70,
  closed: new Set(['5']),
  answered: new Set(),
  ...o,
});

describe('countAll', () => {
  const lista = [
    zadanie({ id: 1, sprintId: 70, storyPoints: 8 }),
    zadanie({ id: 2, sprintId: 70, storyPoints: 4, status: '5' }),
    zadanie({ id: 3, tags: ['DO-STARTU'] }),
    zadanie({ id: 4, tags: ['do-startu'], storyPoints: 6 }),
    zadanie({ id: 5, tags: ['DO-STARTU'], sprintId: 70 }),
    zadanie({ id: 6, tags: ['OCZEKUJE-NA-ODPOWIEDZ'] }),
    zadanie({ id: 7, tags: ['OCZEKUJE-NA-ODPOWIEDZ'] }),
    zadanie({ id: 8, tags: ['DO-WYWIADU'] }),
    zadanie({ id: 9, status: '5', tags: ['DO-WYWIADU'] }),
    zadanie({ id: 10, sprintId: 69 }),
    zadanie({ id: 11, tags: ['BUG'] }),
    zadanie({ id: 12, status: '6', tags: ['DO-STARTU'], storyPoints: 3 }),
  ];
  const c = ctx({ answered: new Set([7]) });
  const wynik = countAll(lista, c);
  /* Z flagi `inSum`, nie z recznej listy: ta sama flaga ustawia grupe „Rozbicie”
     w `CountersBar`, wiec test pilnuje tez tego, co ekran pokazuje jako sume. */
  const stany = COUNTERS.filter((d) => d.inSum).map((d) => d.key);

  it('do sumy wchodza dokladnie stany rozbicia', () => {
    expect(stany).toEqual(['wywiad', 'czeka', 'odpowiedzi', 'wycena', 'gotowe']);
  });

  it('sprint liczy tez zakonczone i sumuje ich story pointy', () => {
    expect(wynik.sprint).toEqual({ count: 3, points: 12 });
  });

  it('poza sprintem to otwarte, nieodlozone, spoza AKTYWNEGO sprintu (takze z innych sprintow)', () => {
    expect(wynik.poza.count).toBe(7); // id 3, 4, 6, 7, 8, 10, 11
  });

  it('stany rozbijaja „poza sprintem” co do sztuki', () => {
    expect(stany.reduce((s, k) => s + wynik[k].count, 0)).toBe(wynik.poza.count);
    expect(stany.map((k) => wynik[k].count)).toEqual([3, 1, 1, 1, 1]); // wywiad: 8, 10 (bez tagu), 11 (BUG)
  });

  it('kazde zadanie poza sprintem wpada do dokladnie jednego stanu', () => {
    const bezStanu: number[] = [];
    const wieleStanow: number[] = [];
    for (const t of lista) {
      const w = countAll([t], c);
      if (!w.poza.count) continue;
      const n = stany.filter((k) => w[k].count === 1).length;
      if (n === 0) bezStanu.push(t.id);
      if (n > 1) wieleStanow.push(t.id);
    }
    expect([bezStanu, wieleStanow]).toEqual([[], []]);
  });

  it('nowe bez tagu i z tagiem spoza listy (BUG, Wysoki) traktowane sa jak do wywiadu', () => {
    const w = countAll(
      [zadanie({ id: 30 }), zadanie({ id: 31, tags: ['BUG'] }), zadanie({ id: 32, tags: ['Wysoki'] })],
      ctx(),
    );
    expect(w.wywiad.count).toBe(3);
  });

  it('dwa tagi gotowosci licza sie raz: DO-STARTU wygrywa z OCZEKUJE', () => {
    const w = countAll([zadanie({ id: 40, tags: ['DO-STARTU', 'OCZEKUJE-NA-ODPOWIEDZ'] })], ctx());
    expect([w.wycena.count, w.czeka.count, w.odpowiedzi.count, w.wywiad.count]).toEqual([1, 0, 0, 0]);
  });

  it('do wyceny i gotowe dziela DO-STARTU poza sprintem, bez wzgledu na wielkosc liter tagu', () => {
    expect([wynik.wycena.count, wynik.gotowe.count]).toEqual([1, 1]);
  });

  it('czeka i do analizy dziela OCZEKUJE wg tego, czy ktos odpisal', () => {
    expect([wynik.czeka.count, wynik.odpowiedzi.count]).toEqual([1, 1]);
  });

  it('bug: otwarte z tagiem BUG w sprincie i poza nim, bez zamknietych i odlozonych', () => {
    const w = countAll(
      [
        zadanie({ id: 60, tags: ['BUG'] }),
        zadanie({ id: 61, tags: ['bug'], sprintId: 70 }),
        zadanie({ id: 62, tags: ['BUG'], status: '5' }),
        zadanie({ id: 63, tags: ['BUG'], status: '6' }),
        zadanie({ id: 64, tags: ['Wysoki'] }),
      ],
      ctx(),
    );
    expect(w.bug.count).toBe(2);
  });

  it('koncept: nowy tag KONCEPT i starszy KONCEPCJA, w sprincie i poza nim, bez zamknietych i odlozonych', () => {
    const w = countAll(
      [
        zadanie({ id: 70, tags: ['KONCEPT'] }),
        zadanie({ id: 71, tags: ['KONCEPCJA'] }),
        zadanie({ id: 72, tags: ['koncepcja'], sprintId: 70 }),
        zadanie({ id: 73, tags: ['KONCEPT'], status: '5' }),
        zadanie({ id: 74, tags: ['KONCEPT'], status: '6' }),
        zadanie({ id: 75, tags: ['KONCEPTY'] }),
      ],
      ctx(),
    );
    expect(w.koncept.count).toBe(3);
  });

  it('koncept to cecha: nie wchodzi do sumy, a zadanie zostaje w swoim stanie', () => {
    const w = countAll([zadanie({ id: 80, tags: ['KONCEPCJA'] })], ctx());
    expect(w.koncept.count).toBe(1);
    expect(stany.reduce((s, k) => s + w[k].count, 0)).toBe(w.poza.count);
    expect(w.wywiad.count).toBe(1);
  });

  it('bledy stoja same (bez podpisu grupy): liczy zadania i ze sprintu, i spoza niego', () => {
    expect(COUNTERS.filter((d) => d.standalone).map((d) => d.key)).toEqual(['bug']);
    const w = countAll(
      [zadanie({ id: 90, tags: ['BUG'], sprintId: 70 }), zadanie({ id: 91, tags: ['BUG'] })],
      ctx(),
    );
    expect(w.bug.count).toBe(2); // jeden w sprincie, jeden poza nim
  });

  it('bug to cecha: zadanie z BUG jest tez w swoim stanie, wiec suma stanow sie nie zmienia', () => {
    const w = countAll([zadanie({ id: 70, tags: ['BUG', 'DO-STARTU'], storyPoints: 4 })], ctx());
    expect([w.bug.count, w.gotowe.count, w.poza.count]).toEqual([1, 1, 1]);
    expect(stany.reduce((s, k) => s + w[k].count, 0)).toBe(w.poza.count);
  });

  it('odlozone nie wchodza do sumy, tylko do notki', () => {
    expect(wynik.odlozone.count).toBe(1);
    expect(wynik.poza.count).toBe(7); // id 12 (odlozone, DO-STARTU + wycena) nie liczy sie
  });

  it('odlozone w sprincie zostaja w sprincie, a nie w notce', () => {
    const w = countAll([zadanie({ id: 50, status: '6', sprintId: 70 })], ctx());
    expect([w.sprint.count, w.odlozone.count, w.poza.count]).toEqual([1, 0, 0]);
  });

  it('bez aktywnego sprintu wszystko otwarte i nieodlozone jest poza sprintem', () => {
    expect(countAll(lista, ctx({ sprintId: null })).poza.count).toBe(9); // dochodzi id 1 i 5 z „sprintu", ktorego juz nie ma
  });

  it('odpowiedzi jeszcze nieprzeliczone: nikt nie jest „do analizy", wszyscy „czekaja"', () => {
    const w = countAll(lista, ctx({ answered: null }));
    expect([w.odpowiedzi.count, w.czeka.count]).toEqual([0, 2]);
  });
});

describe('answerState', () => {
  const IT = new Set([900, 901]);
  const isIt = (id: number) => IT.has(id);
  const msg = (id: number, authorId: number, text = 'tekst'): ChatMessage => ({ id, authorId, text });
  const PYTANIA = '[B]1. Kto to robi?[/B]\nOpis\n\n[B]2. Jak czesto?[/B]';

  it('bez komentarza z pytaniami nie ma kotwicy', () => {
    expect(answerState([msg(1, 700), msg(2, 900, 'zwykly komentarz')], isIt)).toBe('no-question');
  });

  it('odpowiedz z numerowanymi punktami po pytaniach', () => {
    const odp = '1. Robi to magazyn\n2. Kilka razy w tygodniu';
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 700, odp)], isIt)).toBe('answered');
  });

  it('dluzsza odpowiedz bez numeracji tez sie liczy', () => {
    const odp =
      'Duplikujemy zamowienia glownie przy powtorkach zakupow u stalych klientow, robimy to kilka razy dziennie i brakuje nam skopiowanych pol.';
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 700, odp)], isIt)).toBe('answered');
  });

  it('ping z oznaczeniem i samo oznaczenie kogos nie sa odpowiedzia', () => {
    const czat = [
      msg(1, 800, PYTANIA),
      msg(2, 801, '[USER=101]Jan Kowalski[/USER] i [USER=102]Anna Nowak[/USER] - czy możecie odpowiedzieć na pytania?'),
      msg(3, 102, '[USER=101]Jan Kowalski[/USER]'),
    ];
    expect(answerState(czat, (id) => id === 800)).toBe('waiting');
  });

  it('po pingu prawdziwa odpowiedz nadal jest wykrywana', () => {
    const czat = [
      msg(1, 800, PYTANIA),
      msg(2, 801, '[USER=101]Jan Kowalski[/USER] czy możecie odpowiedzieć?'),
      msg(3, 101, '1. Duplikujemy raz dziennie\n2. Kopiuje sie klient i pozycje'),
    ];
    expect(answerState(czat, (id) => id === 800)).toBe('answered');
  });

  it('wpis systemowy i komentarz z IT to nie odpowiedz', () => {
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 0, 'Zmiana etapu'), msg(3, 901, 'ping')], isIt)).toBe(
      'waiting',
    );
  });

  it('kolejna runda pytan przesuwa kotwice', () => {
    const czat = [msg(1, 900, PYTANIA), msg(2, 700, 'odpowiedz'), msg(3, 900, PYTANIA)];
    expect(answerState(czat, isIt)).toBe('waiting');
  });

  it('pytania zadane przez kogos spoza IT nie sa kotwica', () => {
    expect(answerState([msg(1, 700, PYTANIA), msg(2, 701, 'ok')], isIt)).toBe('no-question');
  });
});

describe('isSubstantiveAnswer', () => {
  it('wzmianki i znaczniki nie wliczaja sie do dlugosci', () => {
    expect(plainBody('[USER=101]Jan Kowalski[/USER] [B]tak[/B]')).toBe('tak');
    expect(isSubstantiveAnswer('[USER=101]Jan Kowalski[/USER]')).toBe(false);
    expect(isSubstantiveAnswer('[USER=16]a[/USER] '.repeat(20))).toBe(false);
  });

  it('numeracja wystarcza nawet w krotkiej wiadomosci, sama liczba w tekscie nie', () => {
    expect(isSubstantiveAnswer('1. tak')).toBe(true);
    expect(isSubstantiveAnswer('2) nie')).toBe(true);
    expect(isSubstantiveAnswer('mamy 3 kolektory')).toBe(false);
  });

  it('prog dlugosci to MIN_ANSWER_CHARS znakow wlasnej tresci', () => {
    expect(isSubstantiveAnswer('a'.repeat(MIN_ANSWER_CHARS - 1))).toBe(false);
    expect(isSubstantiveAnswer('a'.repeat(MIN_ANSWER_CHARS))).toBe(true);
  });
});

describe('historia dzien po dniu', () => {
  it('scala klucze dnia i odcina najstarsze dni', () => {
    let h = recordDay({}, '2026-09-26', { poza: 200 }, 2);
    h = recordDay(h, '2026-09-27', { poza: 210 }, 2);
    h = recordDay(h, '2026-09-28', { poza: 220 }, 2);
    h = recordDay(h, '2026-09-28', { wywiad: 5 }, 2);
    expect(h).toEqual({ '2026-09-27': { poza: 210 }, '2026-09-28': { poza: 220, wywiad: 5 } });
  });

  it('punktem odniesienia jest ostatni zapisany dzien przed dzisiejszym, nawet z przerwa', () => {
    const h = { '2026-09-20': { poza: 190 }, '2026-09-25': { poza: 205 }, '2026-09-28': { poza: 220 } };
    expect(previousDay(h, '2026-09-28')).toEqual({ day: '2026-09-25', snap: { poza: 205 } });
    expect(previousDay(h, '2026-09-20')).toBeNull();
  });
});
