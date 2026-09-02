import { type MouseEvent as ReactMouseEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Epic, Stage, Task } from './bitrix';
import { Avatar, CommentIcon, ParentIcon, PriorityIcon, tagHue } from './icons';
import { shortDate, isUnassigned } from './taskView';
import { colDropId, dragId } from './dnd';

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
  onOpen,
  onMenu,
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
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
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
          onOpen={onOpen}
          onMenu={onMenu}
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
          onOpen={onOpen}
          onMenu={onMenu}
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
  onOpen,
  onMenu,
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
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: colDropId(stageId ?? -1),
    disabled: stageId === null,
  });

  return (
    <section ref={setNodeRef} className={`col${isOver && active ? ' col-over' : ''}`}>
      <header className="col-head">
        <span className="col-dot" style={{ background: color ? `#${color}` : 'var(--fg-dim)' }} />
        <span className="col-title">{title}</span>
        <span className="col-count">{tasks.length}</span>
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
            onOpen={onOpen}
            onMenu={onMenu}
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
  onOpen,
  onMenu,
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
  onOpen: (id: number, e: ReactMouseEvent) => void;
  onMenu: (id: number, anchor: { left: number; top: number; bottom: number }) => void;
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
        <span className="row-code">{t.code ?? `#${t.id}`}</span>
        {/* Bez pierscienia etapu — kolumna, w ktorej lezy karta, JEST etapem. */}
        <PriorityIcon priority={t.priority} />
        <span className="card-spacer" />
        {/* Story pointy scruma — dociagane w tle, wiec pojawiaja sie chwile po karcie. */}
        {t.storyPoints != null && (
          <span className="row-sp" title={`Story points: ${t.storyPoints}`}>
            {t.storyPoints}
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
          {t.tags.map((tag) => (
            <span key={tag} className="tag tag-static">
              <span className="tag-dot" style={{ background: tagHue(tag) }} />
              {tag}
            </span>
          ))}
          {/* Epik — ta sama kwadratowa plakietka co w wierszu, tez za tagami. */}
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
        </div>
      )}
    </article>
  );
}
