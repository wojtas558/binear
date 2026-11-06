import { describe, expect, it } from 'vitest';
import {
  answerState,
  foldersOf,
  hasReconMarker,
  isCompleteByTask,
  isReconByTitle,
  latestValue,
  needsChat,
  parseAmount,
  parseValueMessage,
  isSubstantiveAnswer,
  MIN_ANSWER_CHARS,
  plainBody,
  previousDay,
  readiness,
  recordDay,
  savingsOf,
  type ChatMessage,
  type ChatFacts,
  type TaskValue,
} from './counters';

const zadanie = (o: Partial<Parameters<typeof readiness>[0]> & { id: number }) => ({
  status: '2',
  sprintId: null,
  tags: ['DO-STARTU'],
  storyPoints: null as number | null,
  epicId: 141,
  priority: '1',
  title: 'Zadanie',
  deadline: null as string | null,
  ...o,
});

/** Fakty z czatu jednego zadania: przeczytany czat, opcjonalnie wartosc i dopisek rozpoznania. */
const czat = (id: number, o: { value?: TaskValue; recon?: boolean } = {}): ChatFacts => ({
  recon: new Set(o.recon ? [id] : []),
  value: new Map(o.value ? [[id, o.value]] : []),
  read: new Set([id]),
});
const KWOTA: TaskValue = { kind: 'kwota', zl: 840, wyliczenie: null };
const msg = (id: number, text: string, authorId = 5): ChatMessage => ({ id, authorId, text });

describe('wiadomosc WARTOŚĆ', () => {
  describe('kwota oszczednosci w pierwszej linii', () => {
    it('czyta kwote z pogrubionej pierwszej linii', () => {
      const v = parseValueMessage('[B]WARTOŚĆ: oszczędność 840 zł / mies.[/B]\n\nKategoria: OSZCZEDNOSC');
      expect(v).toEqual({ kind: 'kwota', zl: 840, wyliczenie: null });
    });

    it('spacja, twarda spacja i waska twarda spacja dziela tysiace', () => {
      expect(savingsOf(parseValueMessage('WARTOŚĆ: oszczędność 1 000 zł / mies.'))).toBe(1000);
      expect(savingsOf(parseValueMessage('WARTOŚĆ: oszczędność 12 500 zł / mies.'))).toBe(12500);
      expect(savingsOf(parseValueMessage('WARTOŚĆ: oszczędność 2 400 zł / mies.'))).toBe(2400);
    });

    it('przecinek dziesietny', () => {
      expect(savingsOf(parseValueMessage('WARTOŚĆ: oszczędność 1 050,50 zł / mies.'))).toBe(1050.5);
      expect(parseAmount('3 200,5')).toBe(3200.5);
    });

    it('bez polskich znakow i bez dwukropka tez sie czyta', () => {
      expect(savingsOf(parseValueMessage('WARTOSC oszczednosc 300 zl / mies.'))).toBe(300);
    });

    it('linia „Wyliczenie" trafia do wartosci; kwota z pierwszej linii jest zrodlem prawdy', () => {
      const tekst = [
        '[B]WARTOŚĆ: oszczędność 500 zł / mies.[/B]',
        '',
        'Kategoria: OSZCZEDNOSC',
        'Wyliczenie: 1 os. × 30 min dziennie × 21 dni = 10,5 h × 40 zł = 420 zł + licencja 80 zł = 500 zł',
        'Źródło: szacunek',
      ].join('\n');
      expect(parseValueMessage(tekst)).toEqual({
        kind: 'kwota',
        zl: 500,
        wyliczenie: '1 os. × 30 min dziennie × 21 dni = 10,5 h × 40 zł = 420 zł + licencja 80 zł = 500 zł',
      });
    });
  });

  describe('warianty bez kwoty — tez wartosc', () => {
    it('bez kwoty, wymog i stary okres zwrotu', () => {
      expect(parseValueMessage('[B]WARTOŚĆ: bez kwoty[/B]\n\nUzasadnienie: zdanie.')).toEqual({ kind: 'bez-kwoty' });
      expect(parseValueMessage('[B]WARTOŚĆ: wymóg[/B]\n\nTermin: 2026-12-01')).toEqual({ kind: 'wymog' });
      expect(parseValueMessage('WARTOŚĆ: zwrot 3–6 mies.\nKategoria: OSZCZEDNOSC')).toEqual({ kind: 'zwrot' });
      expect(parseValueMessage('WARTOSC - zwrot do 3 mies.')).toEqual({ kind: 'zwrot' });
    });

    it('inny dawny wariant WARTOŚĆ liczy sie jako wartosc bez kwoty', () => {
      expect(parseValueMessage('[B]WARTOŚĆ: rdzeń[/B]\n\nUzasadnienie: cel.')).toEqual({ kind: 'inna' });
      expect(savingsOf({ kind: 'inna' })).toBeNull();
    });

    it('to nie sa wiadomosci WARTOŚĆ', () => {
      expect(parseValueMessage('WYCENA: 16 h')).toBeNull();
      expect(parseValueMessage('Ta wartość jest niska')).toBeNull();
      expect(parseValueMessage('Wartościowy pomysł')).toBeNull();
    });
  });

  describe('najnowsza wiadomosc wygrywa', () => {
    it('poprawka kwoty nowa wiadomoscia zastepuje stara', () => {
      const m = [msg(10, 'WARTOŚĆ: oszczędność 400 zł / mies.'), msg(20, 'WARTOŚĆ: oszczędność 1 200 zł / mies.')];
      expect(savingsOf(latestValue(m))).toBe(1200);
    });

    it('liczy sie id wiadomosci, nie kolejnosc w tablicy', () => {
      const m = [msg(20, 'WARTOŚĆ: oszczędność 1 200 zł / mies.'), msg(10, 'WARTOŚĆ: oszczędność 400 zł / mies.')];
      expect(savingsOf(latestValue(m))).toBe(1200);
    });

    it('nowsze „bez kwoty" kasuje starsza kwote', () => {
      const m = [msg(1, 'WARTOŚĆ: oszczędność 900 zł / mies.'), msg(2, 'WARTOŚĆ: bez kwoty\nUzasadnienie: zdanie.')];
      expect(latestValue(m)).toEqual({ kind: 'bez-kwoty' });
    });

    it('stary „zwrot" po kwocie nie wygrywa z nowsza kwota', () => {
      const m = [msg(1, 'WARTOŚĆ: zwrot do 3 mies.'), msg(2, 'WARTOŚĆ: oszczędność 250 zł / mies.')];
      expect(savingsOf(latestValue(m))).toBe(250);
    });

    it('wpisy systemowe i zwykle komentarze pomija; bez wiadomosci → null', () => {
      expect(latestValue([msg(1, 'WARTOŚĆ: oszczędność 900 zł / mies.', 0)])).toBeNull();
      expect(latestValue([msg(1, 'WYCENA: 8 h'), msg(2, 'ok')])).toBeNull();
    });
  });
});

describe('komplet DO-STARTU: wycena + wartosc (jak kolejka audytu)', () => {
  const TERMIN = '2026-12-01T00:00:00+01:00';
  const gotowe = (t: ReturnType<typeof zadanie>, c: ChatFacts | null) => readiness(t, c).ready;

  it('wycena + wiadomosc WARTOŚĆ z kwota → gotowe', () => {
    expect(gotowe(zadanie({ id: 1, storyPoints: 8 }), czat(1, { value: KWOTA }))).toBe(true);
  });

  it('kazdy wariant WARTOŚĆ wystarcza, takze stary „zwrot" bez kwoty', () => {
    for (const kind of ['bez-kwoty', 'wymog', 'zwrot', 'inna'] as const) {
      expect(gotowe(zadanie({ id: 1, storyPoints: 8 }), czat(1, { value: { kind } }))).toBe(true);
    }
  });

  it('termin w polu „Termin" wystarcza bez czatu', () => {
    const t = zadanie({ id: 1, storyPoints: 8, deadline: TERMIN });
    expect(isCompleteByTask(t)).toBe(true);
    expect(gotowe(t, null)).toBe(true);
    expect(needsChat(t)).toBe(false);
  });

  it('rozpoznanie do 4 h z tytulu wystarcza bez czatu; powyzej 4 h nie', () => {
    expect(isReconByTitle({ title: 'Rozpoznanie: synchronizacja stanów', storyPoints: 4 })).toBe(true);
    expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 3 })).toBe(true);
    expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 8 })).toBe(false);
    expect(isReconByTitle({ title: 'Nowy ekran', storyPoints: 2 })).toBe(false);
    expect(gotowe(zadanie({ id: 1, storyPoints: 4, title: 'Rozpoznanie importu' }), czat(1))).toBe(true);
  });

  it('rozpoznanie z dopisku w wiadomosci WYCENA — tylko do 4 h', () => {
    expect(gotowe(zadanie({ id: 1, storyPoints: 4 }), czat(1, { recon: true }))).toBe(true);
    expect(gotowe(zadanie({ id: 1, storyPoints: 6 }), czat(1, { recon: true }))).toBe(false);
  });

  it('bez wartosci → niegotowe, w brakach „wartosc"', () => {
    expect(readiness(zadanie({ id: 1, storyPoints: 8 }), czat(1))).toEqual({ ready: false, missing: ['wartosc'] });
  });

  it('bez wyceny → niegotowe nawet z wartoscia albo terminem', () => {
    expect(readiness(zadanie({ id: 1 }), czat(1, { value: KWOTA }))).toEqual({ ready: false, missing: ['sp'] });
    expect(readiness(zadanie({ id: 1, deadline: TERMIN }), null)).toEqual({ ready: false, missing: ['sp'] });
    expect(readiness(zadanie({ id: 1 }), czat(1))).toEqual({ ready: false, missing: ['sp', 'wartosc'] });
  });

  it('pule, kategorie i tagi ZWROT nic juz nie znacza', () => {
    const t = zadanie({ id: 1, storyPoints: 8, tags: ['DO-STARTU', 'RDZEN', 'OSZCZEDNOSC', 'ZWROT-3'] });
    expect(gotowe(t, czat(1))).toBe(false);
    expect(gotowe(t, czat(1, { value: KWOTA }))).toBe(true);
  });

  it('litera A–D do kompletu nie nalezy', () => {
    expect(gotowe(zadanie({ id: 1, storyPoints: 8 }), czat(1, { value: KWOTA }))).toBe(true);
    expect(gotowe(zadanie({ id: 1, storyPoints: 8, tags: ['DO-STARTU', 'A'] }), czat(1))).toBe(false);
  });

  it('nieprzeczytany czat: wynik nieznany (null), a czat innego zadania nie pomaga', () => {
    const t = zadanie({ id: 7, storyPoints: 8 });
    expect(readiness(t, null)).toEqual({ ready: null, missing: [] });
    expect(readiness(t, czat(1, { value: KWOTA }))).toEqual({ ready: null, missing: [] });
    expect(needsChat(t)).toBe(true);
  });

  it('rozpoznaje dopisek rozpoznania w wiadomosci WYCENA, takze starsza postac', () => {
    const wycena = '[B]WYCENA: 4 h[/B]\n\nOpis.\n\n[I]Rozpoznanie — bez okresu zwrotu.[/I]';
    expect(hasReconMarker([msg(1, wycena)])).toBe(true);
    expect(hasReconMarker([msg(1, 'WYCENA: 4 h. rozpoznanie – bez okresu zwrotu')])).toBe(true);
    expect(hasReconMarker([msg(1, '[B]WYCENA: 3 h[/B]\n\n[B]Co obejmuje ta wycena[/B]\nWeryfikacja tematu.')])).toBe(true);
    expect(hasReconMarker([msg(1, 'WYCENA: 4 h')])).toBe(false);
    expect(hasReconMarker([msg(1, wycena, 0)])).toBe(false);
  });
});

describe('foldersOf', () => {
  it('folder to rodzic z OTWARTYM podzadaniem; zamkniete dzieci go nie trzymaja', () => {
    const lista = [
      { id: 1, parentId: null, status: '2' },
      { id: 2, parentId: 1, status: '3' },
      { id: 3, parentId: null, status: '2' },
      { id: 4, parentId: 3, status: '5' },
    ];
    expect([...foldersOf(lista, new Set(['5']))]).toEqual([1]);
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
