import { describe, expect, it } from 'vitest';
import {
  answerState,
  countAll,
  COUNTERS,
  foldersOf,
  hasReconMarker,
  hasValueMessage,
  pula,
  isCompleteByTags,
  isReconByTitle,
  needsChat,
  paybackBand,
  paybackRank,
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
  priority: '1',
  title: 'Zadanie',
  deadline: null as string | null,
  ...o,
});

const ctx = (o: Partial<CounterCtx> = {}): CounterCtx => ({
  sprintId: 70,
  closed: new Set(['5']),
  answered: new Set(),
  chat: { recon: new Set<number>(), value: new Set<number>() } as CounterCtx['chat'],
  folders: new Set<number>(),
  ...o,
});

describe('countAll', () => {
  const lista = [
    zadanie({ id: 1, sprintId: 70, storyPoints: 8 }),
    zadanie({ id: 2, sprintId: 70, storyPoints: 4, status: '5' }),
    zadanie({ id: 3, tags: ['DO-STARTU'] }),
    zadanie({ id: 4, tags: ['do-startu', 'DZIAL', 'OSZCZEDNOSC', 'zwrot-3'], storyPoints: 6 }),
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

  describe('komplet do startu: pula, wycena, kategoria i tag okresu zwrotu', () => {
    const TERMIN = '2026-11-01T00:00:00+02:00';
    const start = (o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 100, tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-6'], storyPoints: 6, ...o });
    const stan = (t: ReturnType<typeof zadanie>, o: Partial<CounterCtx> = {}) => {
      const w = countAll([t], ctx(o));
      return [w.wycena.count, w.gotowe.count];
    };

    it('wycena + kategoria + tag zwrotu → gotowe do startu', () => {
      expect(stan(start())).toEqual([0, 1]);
    });

    it('bez story pointow → do wyceny', () => {
      expect(stan(start({ storyPoints: null }))).toEqual([1, 0]);
    });

    it('bez kategorii → do wyceny, choc ma wycene i tag zwrotu', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'ZWROT-6'] }))).toEqual([1, 0]);
    });

    it('bez tagu zwrotu → do wyceny', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC'] }))).toEqual([1, 0]);
    });

    it('kazdy z czterech tagow zwrotu wystarcza, takze bez wzgledu na wielkosc liter', () => {
      for (const tag of ['ZWROT-3', 'zwrot-6', 'Zwrot-12', 'ZWROT-12+']) {
        expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'RYZYKO', tag] }))).toEqual([0, 1]);
      }
    });

    it('tag zwrotu spoza listy (ZWROT-24) zwrotu nie daje', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'RYZYKO', 'ZWROT-24'] }))).toEqual([1, 0]);
    });

    it('WYMOG nie potrzebuje okresu zwrotu, ale MUSI miec termin', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: TERMIN }))).toEqual([0, 1]);
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: null }))).toEqual([1, 0]);
    });

    it('WYMOG z terminem, ale bez wyceny → do wyceny', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], storyPoints: null, deadline: TERMIN }))).toEqual([1, 0]);
    });

    it('termin nie zastepuje tagu zwrotu zwyklego zadania', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC'], deadline: TERMIN }))).toEqual([1, 0]);
    });

    it('kazda kategoria z listy liczy sie, takze BUG (bug tez ma okres zwrotu)', () => {
      for (const kat of ['bug', 'Oszczednosc', 'PRZYCHOD', 'ryzyko', 'ANALITYKA', 'UTRZYMANIE']) {
        expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', kat, 'ZWROT-3'] }))).toEqual([0, 1]);
      }
    });

    it('tag spoza listy kategorii (Wysoki) kategorii nie zastepuje', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'Wysoki', 'ZWROT-6'] }))).toEqual([1, 0]);
    });

    it('suma stanow dalej zgadza sie z „poza sprintem"', () => {
      const lista = [
        start({ id: 1 }),
        start({ id: 2, storyPoints: null }),
        start({ id: 3, tags: ['DO-STARTU'] }),
        start({ id: 4, tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: TERMIN }),
      ];
      const w = countAll(lista, ctx());
      expect(w.wycena.count + w.gotowe.count).toBe(4);
      expect([w.wycena.count, w.gotowe.count]).toEqual([2, 2]);
    });
  });

  describe('rozpoznanie: gotowe do startu bez kategorii i zwrotu', () => {
    const rozp = (o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 200, tags: ['DO-STARTU', 'DZIAL'], storyPoints: 4, ...o });
    const stan = (t: ReturnType<typeof zadanie>, recon: Set<number> | null) => {
      const w = countAll([t], ctx({ chat: recon ? { recon, value: new Set() } : null }));
      return [w.wycena.count, w.gotowe.count];
    };

    it('zadanie oznaczone jako rozpoznanie jest gotowe bez kategorii i zwrotu', () => {
      expect(stan(rozp(), new Set([200]))).toEqual([0, 1]);
    });

    it('takze analiza bledu (BUG) bez tagu zwrotu, jesli oznaczona jako rozpoznanie', () => {
      expect(stan(rozp({ tags: ['DO-STARTU', 'DZIAL', 'BUG'] }), new Set([200]))).toEqual([0, 1]);
    });

    it('bez oznaczenia to zwykle niekompletne zadanie → do wyceny', () => {
      expect(stan(rozp(), new Set())).toEqual([1, 0]);
    });

    it('rozpoznanie wciaz potrzebuje wyceny', () => {
      expect(stan(rozp({ storyPoints: null }), new Set([200]))).toEqual([1, 0]);
    });

    it('do 4 h — tylko takie zadania czyta sie z czatu, powyzej to nie rozpoznanie', () => {
      expect(needsChat(rozp({ storyPoints: 4 }))).toBe(true);
      expect(needsChat(rozp({ storyPoints: 6 }))).toBe(false);
      expect(needsChat(rozp({ storyPoints: null }))).toBe(false);
    });

    it('zadanie z kompletem w tagach nie jest kandydatem — jego czatu nie czytamy', () => {
      expect(needsChat(rozp({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-3'] }))).toBe(false);
      expect(isCompleteByTags(rozp({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-3'] }))).toBe(true);
    });

    it('dopoki czaty sie czytaja (recon = null), zadanie z do 4 h nie jest jeszcze gotowe', () => {
      expect(stan(rozp(), null)).toEqual([1, 0]);
    });

    it('kafelki zalezne od rozpoznan sa oznaczone, zeby ekran pokazal „liczę” zamiast zera', () => {
      expect(COUNTERS.filter((d) => d.needsChatFacts).map((d) => d.key)).toEqual(['wycena', 'gotowe']);
    });

    it('rozpoznaje dopisek w wiadomosci WYCENA, takze z kursywa i roznymi myslnikami', () => {
      const m = (text: string, authorId = 5): ChatMessage => ({ id: 1, authorId, text });
      const wycena = '[B]WYCENA: 4 h[/B]\n\nOpis.\n\n[I]Rozpoznanie — bez okresu zwrotu.[/I]';
      expect(hasReconMarker([m(wycena)])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h. Rozpoznanie - bez okresu zwrotu')])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h. rozpoznanie – bez okresu zwrotu')])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h')])).toBe(false);
      expect(hasReconMarker([m(wycena, 0)])).toBe(false);
    });

    it('rozpoznaje tez starsza postac: uzasadnienie zaczynajace sie od Rozpoznanie / Weryfikacja', () => {
      const m = (text: string): ChatMessage => ({ id: 1, authorId: 5, text });
      for (const slowo of ['Rozpoznanie', 'Weryfikacja', 'Przegląd kodu', 'Sprawdzenie']) {
        expect(hasReconMarker([m(`[B]WYCENA: 3 h[/B]\n\n[B]Co obejmuje ta wycena[/B]\n${slowo} tematu.`)])).toBe(true);
      }
      expect(hasReconMarker([m('[B]Co obejmuje ta wycena[/B]\nNowy ekran listy.')])).toBe(false);
    });

    it('do 4 h z „rozpoznanie” albo „weryfikacja” w tytule to rozpoznanie bez czytania czatu', () => {
      expect(isReconByTitle({ title: 'Rozpoznanie: sync stanów', storyPoints: 4, tags: ['DZIAL'] })).toBe(true);
      expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 3, tags: ['RDZEN'] })).toBe(true);
      expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 8, tags: ['DZIAL'] })).toBe(false);
      expect(isReconByTitle({ title: 'Nowy ekran', storyPoints: 2, tags: ['DZIAL'] })).toBe(false);
      expect(needsChat(rozp({ title: 'Rozpoznanie: sync stanów' }))).toBe(false);
      expect(stan(rozp({ title: 'Rozpoznanie: sync stanów' }), new Set())).toEqual([0, 1]);
    });
  });

  describe('pula: obowiazkowa, a RDZEN ma wartosc w wiadomosci WARTOSC zamiast kategorii i zwrotu', () => {
    const TERMIN = '2026-11-01T00:00:00+02:00';
    const z = (tags: string[], o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 300, tags: ['DO-STARTU', ...tags], storyPoints: 16, ...o });
    const stan = (t: ReturnType<typeof zadanie>, value: Set<number> | null = new Set(), recon: Set<number> = new Set()) => {
      const w = countAll([t], ctx({ chat: value ? { recon, value } : null }));
      return [w.wycena.count, w.gotowe.count];
    };

    it('pula to jeden z trzech tagow; przy dwoch liczy sie pierwszy z listy', () => {
      expect(pula({ tags: ['dzial'] })).toBe('DZIAL');
      expect(pula({ tags: ['Wysoki'] })).toBeNull();
      expect(pula({ tags: ['DZIAL', 'CIAGLOSC', 'RDZEN'] })).toBe('CIAGLOSC');
      expect(pula({ tags: ['DZIAL', 'RDZEN'] })).toBe('RDZEN');
    });

    it('bez puli komplet nie istnieje: kategoria + zwrot → do wyceny', () => {
      expect(stan(z(['OSZCZEDNOSC', 'ZWROT-3']))).toEqual([1, 0]);
      expect(isCompleteByTags(z(['OSZCZEDNOSC', 'ZWROT-3']))).toBe(false);
    });

    it('RDZEN + story pointy + wiadomosc WARTOSC, bez kategorii i zwrotu → gotowe', () => {
      expect(stan(z(['RDZEN']), new Set([300]))).toEqual([0, 1]);
    });

    it('RDZEN bez wiadomosci WARTOSC → do wyceny', () => {
      expect(stan(z(['RDZEN']), new Set())).toEqual([1, 0]);
      expect(isCompleteByTags(z(['RDZEN', 'OSZCZEDNOSC', 'ZWROT-3']))).toBe(false);
    });

    it('RDZEN z WARTOSC, ale bez wyceny → do wyceny', () => {
      expect(stan(z(['RDZEN'], { storyPoints: null }), new Set([300]))).toEqual([1, 0]);
    });

    it('CIAGLOSC z kategoria, ale bez ZWROT → do wyceny; ze ZWROT → gotowe', () => {
      expect(stan(z(['CIAGLOSC', 'UTRZYMANIE']))).toEqual([1, 0]);
      expect(stan(z(['CIAGLOSC', 'UTRZYMANIE', 'ZWROT-6']))).toEqual([0, 1]);
    });

    it('CIAGLOSC i DZIAL: sama wiadomosc WARTOSC kategorii nie zastepuje', () => {
      expect(stan(z(['CIAGLOSC']), new Set([300]))).toEqual([1, 0]);
      expect(stan(z(['DZIAL']), new Set([300]))).toEqual([1, 0]);
    });

    it('DZIAL z WYMOG i terminem → gotowe; bez terminu → do wyceny', () => {
      expect(stan(z(['DZIAL', 'WYMOG'], { deadline: TERMIN }))).toEqual([0, 1]);
      expect(stan(z(['DZIAL', 'WYMOG']))).toEqual([1, 0]);
    });

    it('rozpoznanie do 4 h: bez puli → do wyceny, z pula → gotowe (takze RDZEN)', () => {
      const r = (tags: string[]) => z(tags, { storyPoints: 4, title: 'Rozpoznanie: sync stanów' });
      expect(stan(r([]))).toEqual([1, 0]);
      expect(stan(r(['DZIAL']))).toEqual([0, 1]);
      expect(stan(r(['RDZEN']))).toEqual([0, 1]);
      // rozpoznane z czatu (dopisek w WYCENIE), nie z tytulu
      const bezTytulu = (tags: string[]) => z(tags, { storyPoints: 4 });
      expect(stan(bezTytulu([]), new Set(), new Set([300]))).toEqual([1, 0]);
      expect(stan(bezTytulu(['CIAGLOSC']), new Set(), new Set([300]))).toEqual([0, 1]);
    });

    it('tag STRATEGIA nie daje kompletu ani nie jest kategoria', () => {
      expect(stan(z(['STRATEGIA']), new Set([300]))).toEqual([1, 0]);
      expect(stan(z(['DZIAL', 'STRATEGIA', 'ZWROT-3']))).toEqual([1, 0]);
      expect(stan(z(['RDZEN', 'STRATEGIA']), new Set())).toEqual([1, 0]);
    });

    it('czat czytamy dla RDZEN bez kompletu (takze powyzej 4 h), nie dla zadan bez puli', () => {
      expect(needsChat(z(['RDZEN'], { storyPoints: 40 }))).toBe(true);
      expect(needsChat(z(['DZIAL'], { storyPoints: 40 }))).toBe(false);
      expect(needsChat(z(['DZIAL'], { storyPoints: 4 }))).toBe(true);
      expect(needsChat(z([], { storyPoints: 4 }))).toBe(false);
      expect(needsChat(z(['STRATEGIA'], { storyPoints: 4 }))).toBe(false);
    });

    it('dopoki czaty sie czytaja, RDZEN nie jest jeszcze gotowy', () => {
      expect(stan(z(['RDZEN']), null)).toEqual([1, 0]);
    });

    it('czyta wiadomosc WARTOSC: z pogrubieniem, bez polskich znakow; nie myli z wyceną; system pomija', () => {
      const m = (text: string, authorId = 5): ChatMessage => ({ id: 1, authorId, text });
      expect(hasValueMessage([m('[B]WARTOŚĆ: rdzeń[/B]\n\nUzasadnienie: cel.')])).toBe(true);
      expect(hasValueMessage([m('WARTOSC - zwrot 4 mies.')])).toBe(true);
      expect(hasValueMessage([m('WARTOŚĆ: wymóg')])).toBe(true);
      expect(hasValueMessage([m('WYCENA: 16 h'), m('Ta wartość jest niska')])).toBe(false);
      expect(hasValueMessage([m('WARTOŚĆ: rdzeń', 0)])).toBe(false);
    });
  });

  describe('okres zwrotu z tagow', () => {
    const tags = (...t: string[]) => ({ tags: t });

    it('czyta przedzial z tagu, bez wzgledu na wielkosc liter', () => {
      expect(paybackBand(tags('ZWROT-3'))).toBe('do3');
      expect(paybackBand(tags('zwrot-6'))).toBe('3-6');
      expect(paybackBand(tags('Zwrot-12'))).toBe('6-12');
      expect(paybackBand(tags('ZWROT-12+'))).toBe('ponad12');
    });

    it('brak tagu albo obcy tag → brak okresu zwrotu', () => {
      expect(paybackBand(tags('OSZCZEDNOSC', 'Wysoki'))).toBeNull();
      expect(paybackBand(tags('ZWROT-24', 'ZWROT'))).toBeNull();
      expect(paybackBand(tags())).toBeNull();
    });

    it('dwa tagi zwrotu: liczy sie najgorszy', () => {
      expect(paybackBand(tags('ZWROT-3', 'ZWROT-12'))).toBe('6-12');
    });

    it('wymog przed wszystkim, potem przedzialy, na koncu brak', () => {
      expect(paybackRank(tags('WYMOG'))).toBe(0);
      expect(paybackRank(tags('OSZCZEDNOSC', 'ZWROT-3'))).toBe(1);
      expect(paybackRank(tags('ZWROT-6'))).toBe(2);
      expect(paybackRank(tags('ZWROT-12'))).toBe(3);
      expect(paybackRank(tags('ZWROT-12+'))).toBe(4);
      expect(paybackRank(tags('OSZCZEDNOSC'))).toBe(5);
      expect(paybackRank(tags('STRATEGIA'))).toBe(5); // zwykly tag, nie ma juz wlasnej rangi
    });
  });

  it('czeka i do analizy dziela OCZEKUJE wg tego, czy ktos odpisal', () => {
    expect([wynik.czeka.count, wynik.odpowiedzi.count]).toEqual([1, 1]);
  });

  it('wazne: otwarte z tagiem BUG w sprincie i poza nim, bez zamknietych i odlozonych', () => {
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
    expect(w.wazne.count).toBe(2);
  });

  it('wazne: plomien („Ważne" w Bitriksie) i tag BUG liczone razem, kazde zadanie raz', () => {
    const w = countAll(
      [
        zadanie({ id: 80, priority: '2' }),
        zadanie({ id: 81, tags: ['BUG'] }),
        zadanie({ id: 82, priority: '2', tags: ['bug'] }), // oba zrodla, a liczy sie raz
        zadanie({ id: 83, priority: '1', tags: ['Wysoki'] }),
        zadanie({ id: 84, priority: '2', status: '5' }), // zamkniete
        zadanie({ id: 85, priority: '2', status: '6' }), // odlozone
        zadanie({ id: 86, priority: '2', sprintId: 70 }), // w sprincie tez
      ],
      ctx(),
    );
    expect(w.wazne.count).toBe(4);
  });

  it('koncept: tag KONCEPCJA, w sprincie i poza nim, bez zamknietych i odlozonych', () => {
    const w = countAll(
      [
        zadanie({ id: 70, tags: ['KONCEPCJA'] }),
        zadanie({ id: 71, tags: ['koncepcja'] }),
        zadanie({ id: 72, tags: ['KONCEPCJA'], sprintId: 70 }),
        zadanie({ id: 73, tags: ['KONCEPCJA'], status: '5' }),
        zadanie({ id: 74, tags: ['KONCEPCJA'], status: '6' }),
        zadanie({ id: 75, tags: ['KONCEPCJE'] }),
        zadanie({ id: 76, tags: ['KONCEPT'] }), // takiego tagu nie ma — nie jest koncepcja
      ],
      ctx(),
    );
    expect(w.koncept.count).toBe(3);
  });

  it('koncepcja jest poza rejestrem: nie liczy sie ani do „poza sprintem", ani do wywiadu', () => {
    const w = countAll(
      [
        zadanie({ id: 80, tags: ['KONCEPCJA'] }),
        zadanie({ id: 81, tags: ['KONCEPCJA', 'DO-WYWIADU'] }),
        zadanie({ id: 82, tags: ['koncepcja', 'OCZEKUJE-NA-ODPOWIEDZ'] }),
        zadanie({ id: 83, tags: ['KONCEPCJA', 'DO-STARTU'], storyPoints: 4 }),
        zadanie({ id: 84 }), // zwykle nowe zadanie — to ono jest w wywiadzie
      ],
      ctx(),
    );
    expect(w.koncept.count).toBe(4);
    expect(w.poza.count).toBe(1);
    expect(w.wywiad.count).toBe(1);
    expect([w.czeka.count, w.odpowiedzi.count, w.wycena.count, w.gotowe.count]).toEqual([0, 0, 0, 0]);
    expect(stany.reduce((s, k) => s + w[k].count, 0)).toBe(w.poza.count);
  });

  describe('foldery: zadanie z otwartym podzadaniem to kontener, nie praca', () => {
    const wiersz = (id: number, parentId: number | null, o: Record<string, unknown> = {}) => ({
      ...zadanie({ id }),
      parentId,
      ...o,
    });
    const rejestr = (lista: ReturnType<typeof wiersz>[]) =>
      countAll(lista, ctx({ folders: foldersOf(lista, new Set(['5'])) }));

    it('rodzic z otwartym dzieckiem nie liczy sie ani do poza sprintem, ani do wywiadu', () => {
      const w = rejestr([wiersz(1, null), wiersz(2, 1), wiersz(3, 1), wiersz(4, null)]);
      expect(w.poza.count).toBe(3); // dzieci 2, 3 i zwykle 4 — bez folderu 1
      expect(w.wywiad.count).toBe(3);
      expect(w.foldery.count).toBe(1);
      expect(stany.reduce((s2, k) => s2 + w[k].count, 0)).toBe(w.poza.count);
    });

    it('folder, ktorego wszystkie podzadania sa zamkniete, wraca do zwyklego rejestru', () => {
      const w = rejestr([wiersz(1, null), wiersz(2, 1, { status: '5' }), wiersz(3, 1, { status: '5' })]);
      expect(w.foldery.count).toBe(0);
      expect(w.poza.count).toBe(1); // sam rodzic, dzieci zamkniete
    });

    it('wystarczy jedno otwarte dziecko; odlozone dziecko tez jest otwarte', () => {
      expect(rejestr([wiersz(1, null), wiersz(2, 1, { status: '5' }), wiersz(3, 1)]).foldery.count).toBe(1);
      expect(rejestr([wiersz(1, null), wiersz(2, 1, { status: '6' })]).foldery.count).toBe(1);
    });

    it('dziecko moze lezec w innym sprincie niz rodzic — i tak robi z rodzica folder', () => {
      const w = rejestr([wiersz(1, null), wiersz(2, 1, { sprintId: 70 })]);
      expect(w.foldery.count).toBe(1);
      expect(w.poza.count).toBe(0);
    });

    it('folder w aktywnym sprincie zostaje w W sprincie, a w kafelku Foldery go nie ma', () => {
      const w = rejestr([wiersz(1, null, { sprintId: 70 }), wiersz(2, 1, { sprintId: 70 })]);
      expect(w.sprint.count).toBe(2);
      expect(w.foldery.count).toBe(0);
    });

    it('odlozony folder nie jest liczony w rejestrze, tylko w notce o odlozonych', () => {
      const w = rejestr([wiersz(1, null, { status: '6' }), wiersz(2, 1)]);
      expect(w.foldery.count).toBe(0);
      expect(w.odlozone.count).toBe(1);
    });

    it('koncepcja-folder liczy sie tylko jako koncepcja', () => {
      const w = rejestr([wiersz(1, null, { tags: ['KONCEPCJA'] }), wiersz(2, 1)]);
      expect(w.koncept.count).toBe(1);
      expect(w.foldery.count).toBe(0);
    });

    it('foldersOf: tylko rodzice otwartych dzieci', () => {
      const lista = [wiersz(1, null), wiersz(2, 1), wiersz(3, 9, { status: '5' }), wiersz(4, null)];
      expect([...foldersOf(lista, new Set(['5']))]).toEqual([1]);
    });
  });

  it('koncepcja w aktywnym sprincie zostaje w „W sprincie" i w „Koncept"', () => {
    const w = countAll([zadanie({ id: 85, tags: ['KONCEPCJA'], sprintId: 70, storyPoints: 3 })], ctx());
    expect(w.sprint.count).toBe(1);
    expect(w.koncept.count).toBe(1);
    expect(w.poza.count).toBe(0);
  });

  it('wazne stoja same (bez podpisu grupy): liczy zadania i ze sprintu, i spoza niego', () => {
    expect(COUNTERS.filter((d) => d.standalone).map((d) => d.key)).toEqual(['wazne']);
    const w = countAll(
      [zadanie({ id: 90, tags: ['BUG'], sprintId: 70 }), zadanie({ id: 91, tags: ['BUG'] })],
      ctx(),
    );
    expect(w.wazne.count).toBe(2); // jeden w sprincie, jeden poza nim
  });

  it('bug to cecha: zadanie z BUG jest tez w swoim stanie, wiec suma stanow sie nie zmienia', () => {
    const w = countAll(
      [zadanie({ id: 70, tags: ['BUG', 'DO-STARTU', 'DZIAL', 'ZWROT-6'], storyPoints: 4 })],
      ctx(),
    );
    expect([w.wazne.count, w.gotowe.count, w.poza.count]).toEqual([1, 1, 1]);
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
