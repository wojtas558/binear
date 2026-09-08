import { type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Epic, Stage, Task } from './bitrix';
import { Avatar, CommentIcon, LinkIcon, ParentIcon, PriorityIcon, SubtaskIcon, tagHue } from './icons';
import { shortDate, isUnassigned, sumPoints } from './taskView';
import { colDropId, dragId } from './dnd';
import { TaskCode } from './TaskCode';

/**
 * Tablica = kanban sprintu z Bitriksa, nie wlasny wymysl: kolumny to etapy
 * zwrocone przez `tasks.api.scrum.kanban.getStages`, razem z ich kolorem
 * i kolejnoscia. Przeciagniecie karty wola `task.stages.movetask`.
 *
 * Samego przenoszenia tablica NIE obsluguje — siedzi w jednym `DndContext`
 * razem z lista (App.tsx), zeby oba widoki mialy te sama mechanike i ten sam
 * podglad pod kursorem. Tutaj zostaja tylko: kolumna jako cel i karta jako
 * element przeciagany.
 */

const NO_STAGE = -1;

export function Board({
  tasks,
  stages,
  showDone,
  shownEmpty,
  pending,
  activeId,
  openId,
  marked,
  newIds,
  parentLabels,
  epicOf,
  subCounts,
  relatedIds,
  onOpen,
  onMenu,
  onCopied,
}: {
  tasks: Task[];
  stages: Stage[];
  /** PUSTE kolumny (po nazwie etapu), ktore mimo braku kart maja byc widoczne. */
  shownEmpty: string[];
  /** Kolumna konca (etap typu FINISH) podlega temu, nie `showEmpty`. */
  showDone: boolean;
  pending: Set<number>;
  activeId: number | null;
  openId: number | null;
  onOpen: (id: number, e: ReactMouseEvent) => void;
  marked: Set<number>;
  /** Zadania, ktorych nie bylo przy poprzednim uruchomieniu — patrz src/seen.ts. */
  newIds: Set<number>;
  parentLabels: Map<number, string>;
  /** Epik zadania — karta pokazuje ta sama plakietke co wiersz listy (parytet widokow). */
  epicOf: (t: Task) => Epic | null;
  /**
   * Podzadania: ile przeszlo filtr, ile filtr uciął. Na TABLICY kazde podzadanie
   * jest OSOBNA karta w swojej kolumnie — nic nie chowa sie pod rodzicem, jak na
   * liscie — wiec `inFilter` czyta sie tu wprost jako "jest gdzie indziej".
   */
  subCounts: Map<number, { hidden: number; inFilter: number }>;
  /** Zadania z powiazaniami (DEPENDS_ON) — sama obecnosc, bez liczby. */
  relatedIds: Set<number>;
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
  /** Toast po skopiowaniu kodu — pusty tekst znaczy, ze schowek odmowil. */
  onCopied: (code: string) => void;
}) {
  const byStage = new Map<number, Task[]>();
  for (const t of tasks) {
    const key = t.stageId && stages.some((s) => s.id === t.stageId) ? t.stageId : NO_STAGE;
    const list = byStage.get(key);
    if (list) list.push(t);
    else byStage.set(key, [t]);
  }

  const columns = [...stages]
    .sort((a, b) => a.sort - b.sort)
    .filter((s) => {
      if ((byStage.get(s.id)?.length ?? 0) > 0) return true; // sa karty — zawsze widoczna
      // Pusta kolumna: tylko gdy ZAZNACZONA w panelu; kolumna konca (FINISH)
      // dodatkowo tylko przy „Pokaż zakończone".
      return shownEmpty.includes(s.name) && (showDone || s.type !== 'FINISH');
    });
  const orphans = byStage.get(NO_STAGE) ?? [];

  return (
    <div className="board">
      {orphans.length > 0 && (
        <BoardColumn
          key="orphans"
          title="Poza sprintem"
          color={null}
          /* Zadania spoza sprintu nie maja etapu, wiec nie ma tu czego ustawic. */
          stageId={null}
          tasks={orphans}
          pending={pending}
          activeId={activeId}
          openId={openId}
          marked={marked}
          newIds={newIds}
          parentLabels={parentLabels}
          epicOf={epicOf}
          subCounts={subCounts}
          relatedIds={relatedIds}
          onOpen={onOpen}
          onMenu={onMenu}
          onCopied={onCopied}
        />
      )}

      {columns.map((s) => (
        <BoardColumn
          key={s.id}
          title={s.name}
          color={s.color}
          stageId={s.id}
          tasks={byStage.get(s.id) ?? []}
          pending={pending}
          activeId={activeId}
          openId={openId}
          marked={marked}
          newIds={newIds}
          parentLabels={parentLabels}
          epicOf={epicOf}
          subCounts={subCounts}
          relatedIds={relatedIds}
          onOpen={onOpen}
          onMenu={onMenu}
          onCopied={onCopied}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  title,
  color,
  stageId,
  tasks,
  pending,
  activeId,
  openId,
  marked,
  newIds,
  parentLabels,
  epicOf,
  subCounts,
  relatedIds,
  onOpen,
  onMenu,
  onCopied,
}: {
  title: string;
  color: string | null;
  /** null = kolumna "Poza sprintem": nie jest celem i jej kart sie nie przeciaga. */
  stageId: number | null;
  tasks: Task[];
  pending: Set<number>;
  activeId: number | null;
  openId: number | null;
  onOpen: (id: number, e: ReactMouseEvent) => void;
  marked: Set<number>;
  newIds: Set<number>;
  parentLabels: Map<number, string>;
  epicOf: (t: Task) => Epic | null;
  /**
   * Podzadania: ile przeszlo filtr, ile filtr uciął. Na TABLICY kazde podzadanie
   * jest OSOBNA karta w swojej kolumnie — nic nie chowa sie pod rodzicem, jak na
   * liscie — wiec `inFilter` czyta sie tu wprost jako "jest gdzie indziej".
   */
  subCounts: Map<number, { hidden: number; inFilter: number }>;
  /** Zadania z powiazaniami (DEPENDS_ON) — sama obecnosc, bez liczby. */
  relatedIds: Set<number>;
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
  /** Toast po skopiowaniu kodu — pusty tekst znaczy, ze schowek odmowil. */
  onCopied: (code: string) => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: colDropId(stageId ?? -1),
    disabled: stageId === null,
  });
  const sp = sumPoints(tasks);

  return (
    /*
     * Odcien etapu wjezdza JEDNA zmienna, a nie gotowym tlem. Gdyby tlo szlo inline,
     * bilo by `.col-over` (podswietlenie celu przeciagania), bo styl inline wygrywa
     * z klasa — i karta przestalaby pokazywac, gdzie wlasnie spadnie.
     */
    <section
      ref={setNodeRef}
      className={`col${isOver && active ? ' col-over' : ''}`}
      style={{ '--stage-tint': color ? `#${color}` : 'var(--fg-dim)' } as CSSProperties}
    >
      <header className="col-head">
        <span className="col-dot" style={{ background: color ? `#${color}` : 'var(--fg-dim)' }} />
        <span className="col-title">{title}</span>
        <span className="col-count">{tasks.length}</span>
        {sp !== null && (
          <span className="head-sp" title="Suma story points w kolumnie">
            {sp} SP
          </span>
        )}
      </header>

      <div className="col-body">
        {tasks.map((t) => (
          <BoardCard
            key={t.id}
            task={t}
            draggable={stageId !== null}
            active={activeId === t.id}
            selected={openId === t.id}
            marked={marked.has(t.id)}
            isNew={newIds.has(t.id)}
            busy={pending.has(t.id)}
            parentLabel={parentLabels.get(t.id)}
            epic={epicOf(t)}
            subs={subCounts.get(t.id)}
            hasRelated={relatedIds.has(t.id)}
            onOpen={onOpen}
            onMenu={onMenu}
            onCopied={onCopied}
          />
        ))}

        {tasks.length === 0 && <div className="col-empty">—</div>}
      </div>
    </section>
  );
}

/** Karta jest osobnym komponentem, bo `useDraggable` to hook — nie wejdzie w `.map()`. */
function BoardCard({
  task: t,
  draggable,
  active,
  selected,
  marked,
  isNew,
  busy,
  parentLabel,
  epic,
  subs,
  hasRelated,
  onOpen,
  onMenu,
  onCopied,
}: {
  task: Task;
  draggable: boolean;
  active: boolean;
  selected: boolean;
  marked: boolean;
  isNew: boolean;
  busy: boolean;
  parentLabel: string | undefined;
  /** Epik zadania — ta sama plakietka co w wierszu listy (parytet widokow). */
  epic: Epic | null;
  /** Liczby podzadan tego zadania — patrz `subCounts` wyzej. */
  subs: { hidden: number; inFilter: number } | undefined;
  hasRelated: boolean;
  onOpen: (id: number, e: ReactMouseEvent) => void;
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
  /** Toast po skopiowaniu kodu — pusty tekst znaczy, ze schowek odmowil. */
  onCopied: (code: string) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: dragId(t.id),
    disabled: !draggable,
  });

  return (
    <article
      ref={setNodeRef}
      data-task-id={t.id}
      {...attributes}
      {...listeners}
      className={`card${active ? ' card-active' : ''}${selected ? ' card-selected' : ''}${
        marked ? ' card-marked' : ''
      }${busy ? ' row-busy' : ''}${isDragging ? ' row-dragging' : ''}`}
      onMouseDown={(e) => {
        // jak w liscie: bez zaznaczania tekstu przy Shift/Ctrl + klik
        if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault();
        listeners?.onMouseDown?.(e);
      }}
      onClick={(e) => onOpen(t.id, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // inaczej wypadloby tez menu widoku spod tablicy
        onMenu(t.id, { left: e.clientX, top: e.clientY, bottom: e.clientY });
      }}
    >
      <div className="card-top">
        <TaskCode code={t.code ?? `#${t.id}`} copy={t.code ?? String(t.id)} onCopied={onCopied} />
        {/* Bez pierscienia etapu — kolumna, w ktorej lezy karta, JEST etapem. */}
        <PriorityIcon priority={t.priority} />
        <span className="card-spacer" />
        {/* Story pointy scruma — dociagane w tle, wiec pojawiaja sie chwile po karcie. */}
        {t.storyPoints != null && (
          <span className="row-sp" title={`Story points: ${t.storyPoints}`}>
            {t.storyPoints}
          </span>
        )}
        {/*
          Podzadania. Na liscie te liczby dziela sie na "w innych grupach" i "ukryte
          filtrem"; tutaj wszystkie podzadania i tak leza we wlasnych kolumnach, wiec
          `inFilter` JEST tym pierwszym przypadkiem — stad ta sama para liczb, ale
          bez rozroznienia, ktorego na tablicy nie ma jak zrobic.
        */}
        {subs && (subs.inFilter > 0 || subs.hidden > 0) && (
          <span
            className="row-subs"
            title={[
              subs.inFilter > 0 ? `${subs.inFilter} podzadań w innych kolumnach` : '',
              subs.hidden > 0 ? `${subs.hidden} podzadań ukrytych przez bieżący filtr` : '',
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <SubtaskIcon />
            {subs.inFilter > 0 && <span className="row-subs-elsewhere">{subs.inFilter}</span>}
            {subs.inFilter > 0 && subs.hidden > 0 && <span className="row-subs-sep">·</span>}
            {subs.hidden > 0 && <span className="row-subs-hidden">{subs.hidden}</span>}
          </span>
        )}
        {hasRelated && (
          <span className="row-related" title="Ma powiązane zadania">
            <LinkIcon />
          </span>
        )}
        {isNew && <span className="row-new">nowe</span>}
        {t.newComments > 0 && (
          <span className="row-unread" title={`Nieprzeczytane komentarze: ${t.newComments}`}>
            <CommentIcon />
            {t.newComments}
          </span>
        )}
        {/* Termin — ten sam format co w wierszu listy. */}
        {t.deadline && (
          <span className="card-date" title="Termin">
            {shortDate(t.deadline)}
          </span>
        )}
        {/* Zaslepka -> pusty awatar, dokladnie jak na liscie. */}
        {isUnassigned(t.responsibleId) ? (
          <Avatar name={null} />
        ) : (
          <Avatar name={t.responsibleName} photo={t.responsiblePhoto} />
        )}
      </div>
      {parentLabel !== undefined && (
        <div className="card-parent">
          <ParentIcon />
          {parentLabel}
        </div>
      )}
      <div className="card-title">{t.title || t.rawTitle}</div>
      {(t.tags.length > 0 || epic) && (
        <div className="card-tags">
          {/* Epik ZAWSZE pierwszy, przed tagami: nalezy do zadania na stale, a tagi
              przychodza i znikaja — gdy stal za nimi, skakal w bok przy kazdej zmianie
              etykiet i nie dalo sie go znalezc wzrokiem w stalym miejscu. */}
          {epic &&
            (() => {
              const col = epic.color ? `#${epic.color}` : tagHue(epic.name);
              return (
                <span
                  className="row-epic"
                  title={`Epik: ${epic.name}`}
                  style={{
                    borderColor: `color-mix(in srgb, ${col} 26%, transparent)`,
                    background: `color-mix(in srgb, ${col} 9%, transparent)`,
                  }}
                >
                  {epic.name}
                </span>
              );
            })()}
          {t.tags.map((tag) => (
            <span key={tag} className="tag tag-static">
              <span className="tag-dot" style={{ background: tagHue(tag) }} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
