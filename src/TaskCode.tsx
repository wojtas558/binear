import { useState } from 'react';

import { CheckIcon, CopyIcon } from './icons';

/**
 * Kod zadania z przyciskiem kopiowania. Kopiujemy sam kod (IT-749), bo to jego
 * wkleja sie w nazwe galezi, tytul PR-a i commit — czyli w to, po czym
 * `bitrix_sync.py` rozpoznaje zadanie.
 *
 * Wspolny dla listy i tablicy: karta ma pokazywac to samo, co wiersz (parytet
 * widokow), a Board nie moze importowac z App.tsx — wyszedlby cykl importow.
 * To ten sam powod, dla ktorego `sumPoints` mieszka w taskView.ts.
 */
export function TaskCode({
  code,
  copy,
  onCopied,
}: {
  code: string;
  /**
   * Co ma trafic do schowka, gdy rozni sie od tego, co widac.
   *
   * Zadanie bez kodu IT pokazuje `#116213` — krzyzyk mowi "to numer, nie kod" — ale
   * wklejac trzeba samo `116213`: tyle przyjmuje wyszukiwarka Bitriksa i tyle wchodzi
   * w adres zadania. Z krzyzykiem kopia byla do niczego.
   */
  copy?: string;
  onCopied: (text: string) => void;
}) {
  const [done, setDone] = useState(false);

  return (
    <span className="row-code">
      {code}
      <button
        className="copy-btn"
        title={`Kopiuj ${copy ?? code}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            .writeText(copy ?? code)
            .then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1200);
              onCopied(copy ?? code);
            })
            .catch(() => onCopied(''));
        }}
      >
        {done ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

