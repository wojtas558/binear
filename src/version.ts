/**
 * Sprawdzenie, czy na GitHubie jest nowszy commit niz ten, na ktorym stoi lokalna
 * kopia. Repo jest publiczne, wiec pytamy API bezposrednio z przegladarki — bez
 * tokenu, bez proxy. Odpalane RAZ przy zaladowaniu aplikacji (nie w tle).
 *
 * Limit anonimowego API GitHuba to 60 zapytan/godz. na IP — przy jednym sprawdzeniu
 * na wejscie w zupelnosci wystarcza. Kazdy blad (brak sieci, limit, brak `git` przy
 * starcie) konczy sie `null` — baner sie po prostu nie pokazuje.
 */
export interface UpdateInfo {
  behind: boolean;
  localSha: string;
  latestSha: string;
  /** Pierwsza linia opisu najnowszego commita — do pokazania w banerze. */
  message: string;
  /** Link do porownania „co doszlo" na GitHubie. */
  compareUrl: string;
}

export interface UpdateResult {
  ok: boolean;
  /** false = „Already up to date" (pull przeszedl, ale nic nie doszlo). */
  updated?: boolean;
  message: string;
}

/**
 * Odpala `git pull --ff-only` po stronie dev-serwera (endpoint `/api/update`).
 * Po sukcesie Vite sam zrobi HMR — wolajacy zwykle po prostu przeladowuje strone.
 * `ok: false` = pull sie nie udal (brudne drzewo / brak ff / brak sieci) i `message`
 * niesie powod do pokazania uzytkownikowi.
 */
export async function runUpdate(): Promise<UpdateResult> {
  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    return {
      ok: Boolean(json?.ok),
      updated: json?.updated,
      message: String(json?.message ?? ''),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Wersja lokalnej kopii — czytana na zywo z dev-serwera (`/api/version`). */
async function localVersion(): Promise<{ sha: string; repo: string; branch: string } | null> {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return null;
    const json = await res.json();
    const sha = String(json?.sha ?? '');
    const repo = String(json?.repo ?? '');
    return sha && repo ? { sha, repo, branch: String(json?.branch || 'master') } : null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const local = await localVersion();
  // Bez lokalnego commita (rozpakowany ZIP / brak gita) albo bez repo nie ma czego porownac.
  if (!local) return null;

  try {
    const res = await fetch(`https://api.github.com/repos/${local.repo}/commits/${local.branch}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const latestSha: string = json?.sha ?? '';
    if (!latestSha) return null;

    return {
      behind: latestSha !== local.sha,
      localSha: local.sha,
      latestSha,
      message: String(json?.commit?.message ?? '').split('\n')[0].trim(),
      compareUrl: `https://github.com/${local.repo}/compare/${local.sha}...${local.branch}`,
    };
  } catch {
    return null;
  }
}
