import { describe, expect, it } from 'vitest';

import { actionIcon, actionText, actorId, unreadWithoutActions } from './chatActions';

describe('actionText', () => {
  it('wykonawca osobno, URL jako tekst, TIMESTAMP jako data i godzina', () => {
    const a = actionText(
      '[USER=28]Robert Wielgusiak[/USER] zmienił termin na [URL=/x?chatAction=changeDeadline][TIMESTAMP=1793656800 FORMAT=LONG_DATE_FORMAT], [TIMESTAMP=1793656800 FORMAT=SHORT_TIME_FORMAT][/URL].',
    );
    expect(a.actor).toBe('Robert Wielgusiak');
    expect(a.text).toMatch(/^zmienił termin na \d{1,2} \S+ 2026, \d{2}:\d{2}\.$/);
  });

  it('osoba w srodku zdania zostaje sama nazwa', () => {
    expect(actionText('[USER=251]Klaudiusz Koder AI[/USER] jest teraz obserwatorem.')).toEqual({
      actor: 'Klaudiusz Koder AI',
      text: 'jest teraz obserwatorem.',
    });
    expect(actionText('Utworzono czat [B]zadania[/B]')).toEqual({ actor: null, text: 'Utworzono czat zadania' });
  });

  it('„Użytkownik [USER]" na poczatku — to tez wykonawca', () => {
    const raw = 'Użytkownik [USER=28]Robert Wielgusiak[/USER] zmienił odpowiedzialnego na [USER=303]Wojciech Szyper[/USER].';
    expect(actionText(raw)).toEqual({ actor: 'Robert Wielgusiak', text: 'zmienił odpowiedzialnego na Wojciech Szyper.' });
    expect(actorId(raw)).toBe(28);
    expect(actorId('Utworzono czat')).toBeNull();
  });

  it('sledzenie czasu zapisane przez Bitrix po angielsku idzie po polsku', () => {
    const url = (t: string) => `[URL=/workgroups/group/451/tasks/task/view/116661/?chatAction=openTimeTracking&entityId=2549]${t}[/URL]`;
    expect(actionText(`[USER=303]Wojciech Szyper[/USER] deactivated time tracking. Duration: ${url('36 minutes')}.`)).toEqual({
      actor: 'Wojciech Szyper',
      text: 'wyłączył śledzenie czasu. Czas trwania: 36 minut.',
    });
    expect(actionText(`[USER=303]W[/USER] deactivated time tracking. Duration: ${url('1 hour 6 minutes')}.`).text).toBe(
      'wyłączył śledzenie czasu. Czas trwania: 1 godzina 6 minut.',
    );
    expect(actionText('[USER=303]W[/USER] activated time tracking.').text).toBe('włączył śledzenie czasu.');
    /* polski wpis zostaje bez zmian */
    expect(actionText('[USER=28]R[/USER] wyłączył śledzenie czasu. Czas trwania: 6 godzin 53 minut.').text).toBe(
      'wyłączył śledzenie czasu. Czas trwania: 6 godzin 53 minut.',
    );
  });
});

describe('unreadWithoutActions', () => {
  const ME = 303;
  const sys = (id: number, who: number, what: string) => ({ id, authorId: 0, text: `[USER=${who}]X[/USER] ${what}` });
  const msg = (id: number, author: number) => ({ id, authorId: author, text: 'tresc' });

  it('IT-1093: licznik 2 = komentarz + akcja kogos innego; wlasne akcje sie nie licza', () => {
    const lines = [
      sys(1, ME, 'utworzył'),
      msg(2, 251),
      sys(3, 251, 'jest teraz obserwatorem.'),
      sys(4, ME, 'zmienił etap'),
      sys(5, ME, 'rozpoczął zadanie'),
    ];
    expect(unreadWithoutActions(lines, 2, ME)).toBe(1);
  });

  it('wlasne komentarze pomijane, same akcje daja zero', () => {
    expect(unreadWithoutActions([msg(1, 251), sys(2, 28, 'zmienił termin'), msg(3, ME)], 1, ME)).toBe(0);
  });

  it('za krotka koncowka — null (zostaje licznik Bitriksa)', () => {
    expect(unreadWithoutActions([msg(1, 251)], 3, ME)).toBeNull();
  });
});

describe('angielskie wpisy Bitriksa', () => {
  const pl = (raw: string) => actionText(raw).text;
  it('kazdy zwrot zebrany z portalu idzie po polsku', () => {
    expect(pl('[USER=28]R[/USER] changed assignee to [USER=251]Klaudiusz Koder AI[/USER].')).toBe(
      'zmienił odpowiedzialnego na Klaudiusz Koder AI.',
    );
    expect(pl('[USER=28]R[/USER] added observer: [USER=1]Gabriela Drzał[/USER].')).toBe('dodał obserwatora: Gabriela Drzał.');
    expect(pl('[USER=28]R[/USER] added observers: [USER=1]A[/USER], [USER=2]B[/USER].')).toBe('dodał obserwatorów A, B.');
    expect(pl('[USER=28]R[/USER] added participant: [USER=1]A[/USER].')).toBe('dodał uczestnika: A.');
    expect(pl('[USER=28]R[/USER] added participants: [USER=1]A[/USER], [USER=2]B[/USER].')).toBe('dodał uczestników A, B.');
    expect(pl('[USER=28]R[/USER] changed stage to "Pull Request".')).toBe('zmienił etap na „Pull Request”.');
    expect(pl('[USER=28]R[/USER] completed the task and submitted it for review.')).toBe(
      'zakończył zadanie i przesłał je do sprawdzenia.',
    );
    expect(pl('[USER=28]R[/USER], the task is almost overdue. Deadline: X.')).toBe(', termin zadania wkrótce minie. Termin: X.');
    expect(pl('[USER=28]R[/USER], the task is overdue since X.\nComplete the task ASAP, or change the deadline.')).toBe(
      ', termin zadania minął X. Zakończ zadanie jak najszybciej lub zmień termin.',
    );
    expect(pl('[USER=28]R[/USER] deactivated time tracking. Duration: 2 hours 1 minute.')).toBe(
      'wyłączył śledzenie czasu. Czas trwania: 2 godziny 1 minuta.',
    );
    expect(pl('[USER=28]R[/USER] deactivated time tracking. Duration: 12 hours 22 minutes 5 seconds.')).toBe(
      'wyłączył śledzenie czasu. Czas trwania: 12 godzin 22 minuty 5 sekund.',
    );
  });

  it('przetlumaczona zmiana etapu dostaje pierscien etapu', () => {
    expect(actionIcon(pl('[USER=28]R[/USER] changed stage to "W toku".'))).toEqual({ kind: 'stage', name: 'W toku' });
  });
});

describe('actionIcon', () => {
  it('etap po nazwie kolumny, status po czasowniku, reszta bez ikony', () => {
    expect(actionIcon('zmienił etap na „Pull Request”.')).toEqual({ kind: 'stage', name: 'Pull Request' });
    expect(actionIcon('rozpoczął zadanie.')).toEqual({ kind: 'status', status: '3' });
    expect(actionIcon('wznowił odłożone zadanie.')).toEqual({ kind: 'status', status: '3' });
    expect(actionIcon('zakończył zadanie i przesłał je do sprawdzenia.')).toEqual({ kind: 'status', status: '4' });
    expect(actionIcon('ukończyła zadanie.')).toEqual({ kind: 'status', status: '5' });
    expect(actionIcon('zmienił termin na 2 listopada 2026, 23:00.')).toBeNull();
    expect(actionIcon('jest teraz obserwatorem.')).toBeNull();
  });
});
