import { describe, expect, it } from 'vitest';
import {
  batchViolation,
  parseTeams,
  parseWebhook,
  readCookie,
  rewriteEnv,
  sameOrigin,
  sessionCookie,
  validateEnvUpdate,
  withCsp,
} from './bxProxy';

const req = (headers: Record<string, string>) => ({ headers });

describe('sameOrigin', () => {
  it('przepuszcza brak Origin (curl, ta sama strona bez naglowka) i ten sam adres', () => {
    expect(sameOrigin(req({ host: 'localhost:5181' }))).toBe(true);
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'http://localhost:5181' }))).toBe(true);
  });

  it('odrzuca inna strone i inny port', () => {
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'http://localhost:5182' }))).toBe(false);
  });
});

describe('batchViolation', () => {
  it('przepuszcza wywolania z allowlisty', () => {
    expect(batchViolation({ halt: 0, cmd: { a: 'tasks.task.list?filter[GROUP_ID]=451', b: 'user.get' } })).toBeNull();
    expect(batchViolation({ cmd: {} })).toBeNull();
  });

  it('odrzuca metode spoza allowlisty i batch w batchu', () => {
    expect(batchViolation({ cmd: { a: 'crm.deal.list' } })).toMatch(/crm\.deal\.list/);
    expect(batchViolation({ cmd: { a: 'batch?cmd[x]=tasks.task.list' } })).toMatch(/batch/);
    expect(batchViolation({ cmd: { a: 'BATCH' } })).toMatch(/BATCH/);
  });

  it('odrzuca wielkosc liter, ktorej nie ma na allowliscie', () => {
    expect(batchViolation({ cmd: { a: 'TASKS.TASK.LIST' } })).not.toBeNull();
  });

  it('odrzuca klucze, ktore Bitrix czyta jako cmd, a sprawdzenie by ominely', () => {
    expect(batchViolation({ 'cmd[x]': 'crm.deal.list' })).toMatch(/klucz/);
    expect(batchViolation({ CMD: { a: 'crm.deal.list' } })).toMatch(/klucz/);
    expect(batchViolation({ ' cmd': { a: 'crm.deal.list' } })).toMatch(/klucz/);
  });

  it('wywolanie, ktore nie jest tekstem, nie przechodzi', () => {
    expect(batchViolation({ cmd: { a: { method: 'tasks.task.list' } } })).not.toBeNull();
  });
});

describe('parseTeams', () => {
  it('brak pliku = pusto, w obu trybach', () => {
    expect(parseTeams(null, false)).toEqual({});
    expect(parseTeams(null, true)).toEqual({});
  });

  it('czyta poprawny plik', () => {
    expect(parseTeams('{"451":{"members":[],"off":{}}}', true)).toEqual({ 451: { members: [], off: {} } });
  });

  it('uszkodzony plik: odczyt daje pusto, zapis rzuca (nie nadpisuje zespolow innych projektow)', () => {
    for (const bad of ['BROKEN{', '[]', 'null', '42']) {
      expect(parseTeams(bad, false)).toEqual({});
      expect(() => parseTeams(bad, true)).toThrow();
    }
  });
});

describe('withCsp', () => {
  it('wstawia polityke zaraz po <head>, takze z atrybutami', () => {
    const out = withCsp('<html><head lang="pl"><title>x</title></head></html>', 'localhost:5181');
    expect(out).toMatch(/^<html><head lang="pl"><meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(out).toContain('img-src http://localhost:5181 data: https:');
    expect(out).not.toMatch(/script-src/);
  });

  it('<header> to nie <head> — bez <head> nie ma PDF', () => {
    expect(withCsp('<html><body><header>x</header></body></html>', 'localhost:5181')).toBeNull();
  });
});

describe('validateEnvUpdate', () => {
  it('ujednolica listy id i liczbe programistow', () => {
    expect(validateEnvUpdate({ BX_IT_USERS: ' 251, 303 ,251', BX_CAPACITY_DEVS: '3,5', BX_IT_DEPARTMENTS: '' })).toEqual({
      values: { BX_IT_USERS: '251,303', BX_CAPACITY_DEVS: '3.5', BX_IT_DEPARTMENTS: '' },
    });
  });
  it('odrzuca sekret, cudze klucze i wszystko, co nie jest numerem', () => {
    expect(validateEnvUpdate({ BITRIX_WEBHOOK: 'x' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_TEAM_FILE: '/etc/passwd' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_IT_USERS: '251\nBITRIX_WEBHOOK=x' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_GROUP_ID: '451 # x' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_GROUP_ID: '' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_CAPACITY_DEVS: '0' })).toHaveProperty('error');
    expect(validateEnvUpdate({ BX_UNASSIGNED_ID: 251 })).toHaveProperty('error');
    expect(validateEnvUpdate(['BX_GROUP_ID'])).toHaveProperty('error');
  });
});

describe('rewriteEnv', () => {
  const file = '# webhook\nBITRIX_WEBHOOK=https://x/rest/1/t/\n\n# projekt\nBX_GROUP_ID=451\nBX_IT_USERS=251\n';
  it('zmienia tylko swoje linie, komentarze i sekret zostaja', () => {
    expect(rewriteEnv(file, { BX_GROUP_ID: '452' })).toBe(file.replace('BX_GROUP_ID=451', 'BX_GROUP_ID=452'));
  });
  it('brakujacy klucz dochodzi na koncu, przed koncowa nowa linia', () => {
    expect(rewriteEnv(file, { BX_CAPACITY_DEVS: '4' })).toBe(file + 'BX_CAPACITY_DEVS=4\n');
  });
  it('zachowuje CRLF i dziala na pustym pliku', () => {
    expect(rewriteEnv('BX_GROUP_ID=1\r\nX=2\r\n', { BX_GROUP_ID: '3' })).toBe('BX_GROUP_ID=3\r\nX=2\r\n');
    expect(rewriteEnv('', { BX_GROUP_ID: '3' })).toBe('BX_GROUP_ID=3\n');
  });
  it('linia z export i spacjami tez jest rozpoznana', () => {
    expect(rewriteEnv('export BX_IT_USERS = 1\n', { BX_IT_USERS: '2' })).toBe('BX_IT_USERS=2\n');
  });
});

describe('parseWebhook', () => {
  const portal = 'firma.bitrix24.pl';

  it('ujednolica poprawny webhook', () => {
    expect(parseWebhook(' https://firma.bitrix24.pl/rest/12/abc123/ ', portal)).toBe('https://firma.bitrix24.pl/rest/12/abc123');
    expect(parseWebhook('https://FIRMA.bitrix24.pl/rest/12/abc123', portal)).toBe('https://firma.bitrix24.pl/rest/12/abc123');
  });

  it('odrzuca inny host — serwer sam wola ten adres', () => {
    expect(parseWebhook('https://192.168.1.1/rest/12/abc', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl.evil.example/rest/12/abc', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl@evil.example/rest/12/abc', portal)).toBeNull();
    expect(parseWebhook('https://x:y@firma.bitrix24.pl/rest/12/abc', portal)).toBeNull();
  });

  it('odrzuca http, port, zapytanie i inna sciezke', () => {
    expect(parseWebhook('http://firma.bitrix24.pl/rest/12/abc', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl:8443/rest/12/abc', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl/rest/12/abc?x=1', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl/rest/12/abc/user.get', portal)).toBeNull();
    expect(parseWebhook('https://firma.bitrix24.pl/rest/x/abc', portal)).toBeNull();
    expect(parseWebhook(null, portal)).toBeNull();
    expect(parseWebhook('nie adres', portal)).toBeNull();
  });
});

describe('ciasteczko sesji', () => {
  it('czyta wartosc spod wlasciwej nazwy', () => {
    const header = `inne=1; ${sessionCookie('https://a/rest/1/b', false).split(';')[0]}; jeszcze=2`;
    expect(readCookie(header, 'binear_webhook')).toBe('https://a/rest/1/b');
    expect(readCookie('inne=1', 'binear_webhook')).toBeNull();
    expect(readCookie(undefined, 'binear_webhook')).toBeNull();
  });

  it('jest HttpOnly i SameSite=Strict, Secure za HTTPS, a pusta wartosc kasuje', () => {
    expect(sessionCookie('x', false)).toMatch(/HttpOnly; SameSite=Strict/);
    expect(sessionCookie('x', false)).not.toMatch(/Secure/);
    expect(sessionCookie('x', true)).toMatch(/Secure$/);
    expect(sessionCookie('', true)).toMatch(/Max-Age=0/);
  });
});
