import { Component, type ErrorInfo, type ReactNode } from 'react';

/*
 * Siatka bezpieczenstwa. Bez niej KAZDY wyjatek w renderze wywala cale drzewo Reacta
 * i zostaje biala strona — z niczym, co dalo by sie kliknac, i bez podpowiedzi, co
 * poszlo nie tak. Tutaj zamiast tego pokazujemy komunikat, tresc bledu do wklejenia
 * i dwa wyjscia: sprobuj ponownie (bez utraty stanu aplikacji) albo przeladuj.
 *
 * UWAGA: to lapie WYJATKI, nie zawieszenia. Nieskonczona petla w renderze nadal
 * zamrozi karte — od tego sa bezpieczniki w samych petlach (patrz markdown.tsx).
 */
interface Props {
  children: ReactNode;
  /** Krotki opis miejsca, np. „opis zadania" — trafia do komunikatu. */
  where?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Konsola zostaje jedynym miejscem z pelnym stosem — warto go zachowac.
    console.error('[binear] Nieoczekiwany błąd renderowania', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const where = this.props.where ? ` (${this.props.where})` : '';
    return (
      <div className="crash">
        <h2>Coś się wywaliło{where}</h2>
        <p>
          Reszta aplikacji działa dalej — możesz spróbować ponownie albo przeładować stronę.
          Jeśli to się powtarza, wklej poniższy komunikat do zgłoszenia.
        </p>
        <pre className="crash-msg">{String(error?.message || error)}</pre>
        <div className="crash-actions">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Spróbuj ponownie
          </button>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Przeładuj
          </button>
        </div>
      </div>
    );
  }
}
