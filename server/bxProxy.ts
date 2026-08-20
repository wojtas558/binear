import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Metody REST dopuszczone przez proxy. Webhook daje pelny dostep do portalu,
 * wiec przegladarka moze wywolac wylacznie to, co jest tu wymienione.
 * MVP jest read-only - mutacje (tasks.task.update, task.stages.movetask,
 * task.commentitem.add) dokladamy dopiero razem z UI, ktore ich uzywa.
 */
const ALLOWED = new Set([
  'batch', // laczy do 50 wywolan w jedno zapytanie HTTP — bez tego lista to 20 round-tripow
  // odczyt
  'tasks.task.list',
  'tasks.task.get',
  'tasks.task.getFields',
  'tasks.api.scrum.kanban.getStages',
  'tasks.api.scrum.sprint.list',
  'tasks.api.scrum.backlog.get', // id backlogu — bez niego nie ma jak wyjac zadania ze sprintu
  'tasks.api.scrum.task.get', // scrumowa czesc zadania: entityId, storyPoints, kod nadany przez Bitrix
  'tasks.task.history.list', // dziennik zmian zadania — z niego liczymy czas w statusie "W toku"
  'task.commentitem.getlist',
  'im.dialog.messages.get', // komentarze zadan zyja dzis w czacie, nie na forum
  'sonet_group.user.groups', // projekty uzytkownika — lista w przelaczniku
  'user.get',
  // zapis — kazda zmiana idzie jako uzytkownik z URL-a webhooka
  'tasks.task.update',
  'task.stages.movetask',
  'tasks.api.scrum.task.update', // sprint <-> backlog; przynaleznosc trzyma scrum, nie pole zadania
  'task.commentitem.add',
  'task.checklistitem.complete', // odhaczenie pozycji checklisty
  'task.checklistitem.renew', // cofniecie odhaczenia
]);

/** Serializacja zagniezdzonych parametrow w formacie, ktorego oczekuje Bitrix (PHP-style brackets). */
function encodeParams(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    value.forEach((item, i) => encodeParams(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      encodeParams(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  return out;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function bxProxy(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const webhook = (env.BITRIX_WEBHOOK || '').replace(/\/+$/, '');
  const groupId = env.BX_GROUP_ID || '451';
  // Konto-zaslepka "Nieprzypisane" — patrz .env.example. Domyslnie 251 (Klaudiusz Koder).
  const unassignedId = Number(env.BX_UNASSIGNED_ID) || 251;

  return {
    name: 'bitrix-proxy',
    configureServer(server) {
      if (!webhook) {
        server.config.logger.warn(
          '\n[bitrix] Brak BITRIX_WEBHOOK w .env — aplikacja wystartuje, ale kazde zapytanie zwroci 500.\n' +
            '         Skopiuj .env.example do .env i wklej URL webhooka.\n',
        );
      }

      // Konfiguracja bez sekretu — front musi znac groupId i "kim jestem",
      // ale nie token. userId czytamy z samego URL-a webhooka (/rest/<uid>/<token>/).
      // groupId to juz tylko wartosc DOMYSLNA: projekt wybrany w aplikacji
      // (localStorage) ma pierwszenstwo, wiec .env decyduje o pierwszym starcie.
      const userId = webhook.match(/\/rest\/(\d+)\//)?.[1] ?? null;
      // Adres portalu bierzemy z webhooka — zeby nie wpisywac domeny na sztywno w UI.
      const portal = webhook.match(/^(https?:\/\/[^/]+)/)?.[1] ?? null;

      server.middlewares.use('/api/config', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ groupId, userId, portal, unassignedId, configured: Boolean(webhook) }));
      });

      /**
       * Wersja lokalnej kopii czytana NA ZYWO (przy kazdym zapytaniu), nie zapamietana
       * przy starcie — inaczej po `git pull` + HMR wartosc byłaby nieaktualna i baner
       * „nowa wersja" wisialby w kolko. `repo`/`branch` tez z gita, bez zaszywania nazwy.
       * Puste pola, gdy `git` niedostepny — front wtedy po prostu nie sprawdza.
       */
      server.middlewares.use('/api/version', async (_req, res) => {
        const git = async (args: string[]): Promise<string> => {
          try {
            const { stdout } = await run('git', args, { cwd: process.cwd() });
            return stdout.trim();
          } catch {
            return '';
          }
        };
        const [sha, remote, branch] = await Promise.all([
          git(['rev-parse', 'HEAD']),
          git(['config', '--get', 'remote.origin.url']),
          git(['rev-parse', '--abbrev-ref', 'HEAD']),
        ]);
        const repo = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1] ?? '';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ sha, repo, branch: branch || 'master' }));
      });

      /**
       * Jednoklikowa aktualizacja: `git pull --ff-only` po stronie serwera (przegladarka
       * nie ma dostepu do gita). Vite obserwuje pliki, wiec zaraz po pobraniu robi HMR
       * i aplikacja odswieza sie z nowym kodem — uzytkownik tylko klika w baner.
       *
       * `--ff-only` swiadomie ODMAWIA, gdy sa lokalne zmiany albo trzeba merge'a — nic
       * nie nadpisujemy; wtedy front pokazuje instrukcje recznego `git pull`. Endpoint
       * istnieje tylko w dev-serwerze i slucha na localhoscie (maszyna uzytkownika).
       */
      server.middlewares.use('/api/update', async (req, res) => {
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') return send(405, { ok: false, message: 'Tylko POST' });

        try {
          const { stdout, stderr } = await run('git', ['pull', '--ff-only'], { cwd: process.cwd() });
          const out = `${stdout}${stderr}`.trim();
          const upToDate = /already up[- ]to[- ]date/i.test(out);
          send(200, { ok: true, updated: !upToDate, message: out });
        } catch (err: any) {
          // Nie-zerowy git (brudne drzewo / brak ff / brak sieci / brak gita) — obsluzone,
          // nie 500: front ma pokazac powod i podpowiedziec reczny pull.
          const message = String(err?.stderr || err?.stdout || err?.message || err).trim();
          send(200, { ok: false, message });
        }
      });

      server.middlewares.use('/api/bx/', async (req, res) => {
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        const method = (req.url || '').replace(/^\//, '').split('?')[0];

        if (!webhook) return send(500, { error: 'BITRIX_WEBHOOK nie jest ustawiony w .env' });
        if (!ALLOWED.has(method)) return send(403, { error: `Metoda spoza allowlisty: ${method}` });

        try {
          const raw = await readBody(req);
          const params = raw ? JSON.parse(raw) : {};
          const body = encodeParams(params).join('&');

          const upstream = await fetch(`${webhook}/${method}.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          });

          const text = await upstream.text();
          res.statusCode = upstream.ok ? 200 : upstream.status;
          res.setHeader('content-type', 'application/json');
          res.end(text);
        } catch (err) {
          send(502, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
