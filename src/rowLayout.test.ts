import { describe, expect, it } from 'vitest';
import {
  addLine,
  DEFAULT_ROW_LAYOUT,
  hiddenElements,
  MAX_LINES,
  moveElement,
  normalizeRowLayout,
  removeLine,
  ROW_ELEMENTS,
} from './rowLayout';

describe('normalizeRowLayout', () => {
  it('brak zapisu albo smieci daje uklad domyslny', () => {
    expect(normalizeRowLayout(undefined)).toEqual(DEFAULT_ROW_LAYOUT);
    expect(normalizeRowLayout({ lines: [] })).toEqual(DEFAULT_ROW_LAYOUT);
    expect(normalizeRowLayout('x')).toEqual(DEFAULT_ROW_LAYOUT);
  });

  it('odrzuca nieznane i powtorzone elementy', () => {
    const l = normalizeRowLayout({ lines: [{ left: ['title', 'xyz', 'status', 'title'], right: ['avatar', 'title'] }] });
    expect(l.lines[0]).toEqual({ left: ['title'], right: ['avatar'] });
  });

  it('tytul, ktorego zabraklo, wraca na koniec lewej strony pierwszej linii', () => {
    const l = normalizeRowLayout({ lines: [{ left: ['avatar'], right: [] }, { left: ['tags'], right: [] }] });
    expect(l.lines[0].left).toEqual(['avatar', 'title']);
  });

  it('przycina liczbe linii', () => {
    const lines = Array.from({ length: MAX_LINES + 2 }, () => ({ left: [], right: [] }));
    expect(normalizeRowLayout({ lines }).lines).toHaveLength(MAX_LINES);
  });
});

describe('moveElement', () => {
  it('przenosi awatar na lewo, na sam poczatek', () => {
    const l = moveElement(DEFAULT_ROW_LAYOUT, 'avatar', { line: 0, zone: 'left', index: 0 });
    expect(l.lines[0].left[0]).toBe('avatar');
    expect(l.lines[0].right).not.toContain('avatar');
  });

  it('do drugiej linii i do ukrytych', () => {
    let l = addLine(DEFAULT_ROW_LAYOUT);
    l = moveElement(l, 'tags', { line: 1, zone: 'left' });
    l = moveElement(l, 'more', { line: null, zone: 'left' });
    expect(l.lines[1].left).toEqual(['tags']);
    expect(hiddenElements(l)).toEqual(['more']);
  });

  it('tytulu nie da sie ukryc', () => {
    expect(moveElement(DEFAULT_ROW_LAYOUT, 'title', { line: null, zone: 'left' })).toBe(DEFAULT_ROW_LAYOUT);
  });

  it('domyslny uklad ma wszystkie elementy, nic nie jest ukryte', () => {
    expect(hiddenElements(DEFAULT_ROW_LAYOUT)).toEqual([]);
    expect(DEFAULT_ROW_LAYOUT.lines.flatMap((x) => [...x.left, ...x.right])).toHaveLength(ROW_ELEMENTS.length);
  });
});

describe('linie', () => {
  it('usuniecie linii chowa jej elementy, a tytul wraca do pierwszej', () => {
    let l = addLine(DEFAULT_ROW_LAYOUT);
    l = moveElement(l, 'title', { line: 1, zone: 'left' });
    l = moveElement(l, 'epic', { line: 1, zone: 'right' });
    l = removeLine(l, 1);
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0].left).toContain('title');
    expect(hiddenElements(l)).toEqual(['epic']);
  });

  it('nie usuwa ostatniej linii i nie dodaje ponad limit', () => {
    expect(removeLine(DEFAULT_ROW_LAYOUT, 0)).toBe(DEFAULT_ROW_LAYOUT);
    let l = DEFAULT_ROW_LAYOUT;
    for (let i = 0; i < MAX_LINES + 2; i++) l = addLine(l);
    expect(l.lines).toHaveLength(MAX_LINES);
  });
});
