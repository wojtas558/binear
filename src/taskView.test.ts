import { describe, expect, it } from 'vitest';
import { hasBugTag, isBug, isFlame, podzielNaTrafienia, tagsForWidth, withoutBugTag } from './taskView';

/** Skrot do czytelnych asercji: „ab[cd]ef" znaczy, ze `cd` jest podswietlone. */
const zapis = (text: string, fraza: string) =>
  podzielNaTrafienia(text, fraza)
    .map((k) => (k.hit ? `[${k.text}]` : k.text))
    .join('');

describe('podzielNaTrafienia', () => {
  it('bez frazy oddaje caly tekst jednym kawalkiem', () => {
    expect(podzielNaTrafienia('Tytuł zadania', '')).toEqual([{ text: 'Tytuł zadania', hit: false }]);
    expect(podzielNaTrafienia('Tytuł zadania', '   ')).toEqual([
      { text: 'Tytuł zadania', hit: false },
    ]);
  });

  it('zaznacza trafienie w srodku', () => {
    expect(zapis('Ikony w grupach atrybutów', 'grupa')).toBe('Ikony w [grupa]ch atrybutów');
  });

  it('nie zwaza na wielkosc liter', () => {
    expect(zapis('Automat generujący PIM', 'pim')).toBe('Automat generujący [PIM]');
    expect(zapis('pim i PIM', 'PIM')).toBe('[pim] i [PIM]');
  });

  it('zaznacza wszystkie wystapienia', () => {
    expect(zapis('aXaXa', 'a')).toBe('[a]X[a]X[a]');
  });

  it('radzi sobie z polskimi znakami', () => {
    expect(zapis('Błędne stany', 'błęd')).toBe('[Błęd]ne stany');
  });

  it('traktuje fraze doslownie, nie jako wyrazenie regularne', () => {
    /* Nawiasy i kropki sa w tytulach codziennoscia — jako regex wysadzilyby
       wyszukiwanie albo dopasowaly cokolwiek. */
    expect(zapis('Wersja 2.207.0 (poprawka)', '.207.')).toBe('Wersja 2[.207.]0 (poprawka)');
    expect(zapis('Wersja 2.207.0 (poprawka)', '(poprawka)')).toBe('Wersja 2.207.0 [(poprawka)]');
    expect(zapis('abc', '.')).toBe('abc');
  });

  it('brak trafienia zostawia tekst w calosci', () => {
    expect(podzielNaTrafienia('Tytuł', 'xyz')).toEqual([{ text: 'Tytuł', hit: false }]);
  });

  it('nie gubi ogona po ostatnim trafieniu', () => {
    expect(zapis('raz dwa raz trzy', 'raz')).toBe('[raz] dwa [raz] trzy');
  });
});

/*
 * Kolejnosc ustepowania w wierszu. Testy pilnuja dwoch rzeczy, na ktore juz raz
 * sie nadzialismy: ze przy ciasnocie zostaje ZERO chipow (dawna dolna granica
 * wynosila 2 i to one zjadaly tytul), oraz ze zero na wejsciu — czyli „jeszcze
 * nie zmierzono" — nie udaje szerokiego wiersza. To drugie maskowalo pomiar,
 * ktorego nigdy nie bylo: `useWidth` oddawal 0, a limit wychodzil sensowny.
 */
describe('tagsForWidth', () => {
  it('szeroki wiersz pokazuje wszystkie chipy', () => {
    expect(tagsForWidth(1850)).toBe(6);
    expect(tagsForWidth(1500)).toBe(6);
  });

  it('kazdy prog schodzi o jeden chip', () => {
    expect(tagsForWidth(1499)).toBe(5);
    expect(tagsForWidth(1250)).toBe(5);
    expect(tagsForWidth(1000)).toBe(4);
    expect(tagsForWidth(820)).toBe(3);
    expect(tagsForWidth(640)).toBe(2);
    expect(tagsForWidth(480)).toBe(1);
  });

  it('przy ciasnocie nie zostaje ani jeden chip — tytul ma pierwszenstwo', () => {
    expect(tagsForWidth(479)).toBe(0);
    expect(tagsForWidth(200)).toBe(0);
  });

  it('brak pomiaru nie udaje szerokiego wiersza', () => {
    expect(tagsForWidth(0)).toBe(0);
  });

  it('nie schodzi ponizej zera przy bzdurnej szerokosci', () => {
    expect(tagsForWidth(-100)).toBe(0);
  });
});

describe('znaki błędu: płomień i BUG', () => {
  const t = (priority: string, tags: string[] = []) => ({ priority, tags });

  it('płomień to wysoki priorytet Bitriksa, nie inne', () => {
    expect(isFlame(t('2'))).toBe(true);
    expect(isFlame(t('1'))).toBe(false);
    expect(isFlame(t('0'))).toBe(false);
  });

  it('tag BUG poznaje bez względu na wielkość liter, a nie podobne nazwy', () => {
    expect(hasBugTag(t('1', ['BUG']))).toBe(true);
    expect(hasBugTag(t('1', ['bug', 'Wysoki']))).toBe(true);
    expect(hasBugTag(t('1', ['BUGFIX', 'debug']))).toBe(false);
  });

  it('błąd to płomień albo BUG — jedno z nich wystarcza, oba też', () => {
    expect(isBug(t('2'))).toBe(true);
    expect(isBug(t('1', ['BUG']))).toBe(true);
    expect(isBug(t('2', ['BUG']))).toBe(true);
    expect(isBug(t('1', ['OSZCZEDNOSC']))).toBe(false);
  });

  it('tag BUG znika z etykiet (zastępuje go robak), reszta zostaje w kolejności', () => {
    expect(withoutBugTag(['BUG', 'Wysoki', 'bug', 'ZWROT-3'])).toEqual(['Wysoki', 'ZWROT-3']);
    expect(withoutBugTag([])).toEqual([]);
  });
});
