import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { fetchConfig, login } from './bitrix';

/**
 * Tryb wspolny (`BX_PORTAL` w .env): zanim ruszy aplikacja, osoba musi wkleic wlasny webhook.
 * Poza tym trybem nie robi nic. Blad `/api/config` tez przepuszcza dalej — App ma wlasny ekran bledu.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [portal, setPortal] = useState<string | null | undefined>(undefined);
  const [webhook, setWebhook] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then((c) => setPortal(c.multiUser && !c.configured ? c.portal : null))
      .catch(() => setPortal(null));
  }, []);

  if (portal === undefined) return null;
  if (portal === null) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(webhook);
      setPortal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="session-gate" onSubmit={submit}>
      <h1>Binear</h1>
      <label htmlFor="session-webhook">Twój webhook Bitrix24</label>
      <input
        id="session-webhook"
        type="password"
        autoComplete="off"
        autoFocus
        placeholder={`${portal}/rest/…`}
        value={webhook}
        onChange={(e) => setWebhook(e.target.value)}
      />
      {error && <p className="session-gate-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !webhook.trim()}>
        Wejdź
      </button>
    </form>
  );
}
