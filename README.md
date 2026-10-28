# Binear

> [!WARNING]
> **Disclaimer:** this code was written almost entirely with Claude (Claude Code).
> The direction and review are mine; the code is largely generated. Read it before
> pointing it at your portal — a Bitrix webhook grants full access to the account
> that issues it.

A readable front end for Bitrix24 tasks.

Pick the project by **its name on the left of the toolbar** (or the palette,
`Projekt` section) — see [Projects](#projects). By default it shows **the active
sprint only** (detected by `status: active` in `tasks.api.scrum.sprint.list`, not
by highest id). The scope bar above the list — `Sprint 60 · Outside sprint · All`,
each with a count — steps outside in one click.

Three toggles sit next to it:

| toggle | effect (active sprint, 25 unfinished) |
| --- | --- |
| **Only mine** (on by default) | 10 tasks |
| **+ unassigned** | adds 7 placeholder-account tasks → 17 |
| **Completed** | adds tasks with status `Completed` |

`+ unassigned` only matters while `Only mine` is on; otherwise those tasks show
anyway, so the toggle is dimmed and inert.

## Running it

```bash
cd binear
npm install
cp .env.example .env   # then paste in the webhook
npm run dev            # http://localhost:5180
```

### Webhook

Needs an **inbound webhook** from Bitrix24:

1. Bitrix24 → **Applications** → **For developers** → **Other** → **Inbound webhook**
2. Scopes: **`task`**, **`user`**, **`sonet_group`** (Workgroups — without it
   everything works except the project list), **`im`** (Chat — without it no
   comments on newer tasks, see [Comments](#comments))
3. Copy the URL, shaped `https://<portal>.bitrix24.pl/rest/<user_id>/<token>/`
4. Paste it into `.env` as `BITRIX_WEBHOOK`

The token grants full portal access, so it **never reaches the browser**. The
front end calls `/api/bx/<method>`; the proxy in `server/bxProxy.ts` attaches the
token server-side and passes through only allowlisted methods.

## Projects

The top-left name **is** the switcher — clicking it lists the **projects you belong
to**, alphabetically (also in the palette's `Projekt` section). The note beside a
name shows only when you're more than a participant (`owner`, `moderator`).

The list comes from `sonet_group.user.groups`, not `sonet_group.get` — the latter
returns everything on the portal (85 groups here vs. our 4) and pages by 50, so
without pagination it would silently drop the rest. It needs the **`sonet_group`**
scope; without it Bitrix answers `insufficient_scope`, the error is swallowed, and
the list just comes back empty.

A project outside that list opens by **number** typed into the switcher's filter —
the same number in the Bitrix URL (`/workgroups/group/451/`). That field is also
the only way in when the scope is missing.

**Sprints and kanban exist only in scrum groups.** An ordinary project collapses
the scope bar to `All` and the board to one column. The saved scope isn't cleared,
only skipped. The group type **can't be told from the list** — no `sonet_group.*`
method marks it — so you only know after loading, by whether it has an active
sprint.

The choice lives in `binear.project.v1`, separate from view settings
(`binear.view.v1`): changing project reloads **data**, it doesn't rearrange the
screen. No stored value means "the one from `.env`" (`BX_GROUP_ID`). Switching
clears per-project state (open task, selection, collapsed groups, tag filter,
search); view settings — a decision about *how* to look — stay.

## Comments

A task's comments live in **two independent places**, and neither sees the other:

| source | when | method |
| --- | --- | --- |
| forum | task has a `forumTopicId` — the imported `109xxx` batch | `task.commentitem.getlist` |
| chat | every task has a `chatId`; today's discussion lands here | `im.dialog.messages.get` |

The panel asks both and merges by date — this needs the **`im`** scope.

The tell: IT-754 had `newCommentsCount: 2` but showed "No comments" — no forum, so
`task.commentitem.getlist` truthfully returned zero while the comment sat in chat.
The correlation is binary: `forumTopicId` present → comments, absent → always zero.

**System entries (`author_id === 0`) are hidden behind an "Akcje · N" toggle**
("changed stage", "is now an observer", "task chat created") — a chat holds far
more of these than real comments (IT-754: 6 messages, 1 comment). Off by default,
remembered per browser (`src/chatActions.ts`). Shown as one grey line: the actor's
avatar (from `[USER=id]`, missing photos via one `user.get`), a stage or status ring
for stage/status changes, BBCode stripped, and Bitrix's English phrasings translated
to its Polish wording — an English action in binear means a new phrasing to add there.
While hidden they don't count toward the unread badge either: Bitrix's
`newCommentsCount` includes them, so tasks with unread messages get their chat tail
re-read in one batch and recounted (`unreadWithoutActions`); a task that can't be
recounted keeps Bitrix's number. Author names ride in the response's `users` field.
Threads cut off at 100 messages (`im.dialog.messages.get` pages back via `LAST_ID`,
rarely needed).

**Sending still goes to the forum** (`task.commentitem.add`). On a forum-less task
it probably won't show in the Bitrix UI — the right route would be `im.message.add`
to the chat, unverified since it needs a live write.

## Tags

`TAGS` doesn't appear in `tasks.task.getFields`, but `tasks.task.list` returns it
with names (`{"243":{"id":243,"title":"EMX"}}`), so no dictionary query is needed.
Clicking a tag filters the list (shown in the scope bar, cleared with ✕). Tags are
also a palette section with usage counts.

## Tags & epics

The **Tagi i epiki** tab of **Ustawienia** renames, merges and deletes tags across the project, and adds, renames,
recolours and deletes epics. Bitrix has no tag dictionary — a tag is just a name on a task — so a tag change
rewrites every task that has it:

- only **open** tasks change; closed ones keep their tags (the dialog says how many);
- each task's tags are **read from Bitrix right before** it is written, so a list that is a few minutes old,
  or a change made in Bitrix meanwhile, can't bring an old tag back or drop someone else's;
- every rename, merge and delete asks first (a merge can't be split again); the window (close and tab switch) stays blocked until
  the data has reloaded, and if something fails halfway it says how many tasks were already changed;
- an epic's colour is saved once, when the colour picker closes.

## Team

The **Zespół i grafik** tab of **Ustawienia** (also opened by *Zespół i grafik* in Charts and planning) holds who is on the team, on what FTE and on which
days — capacity comes from it instead of `BX_CAPACITY_DEVS`. Per person:

- **Kierownik** — the manager: their tasks are outside the SP budget, get their own bar in planning and stay
  with them when they enter a sprint (the same as `BX_CAPACITY_EXCLUDE_IDS`). While nobody in the team is
  ticked, the manager from `BX_CAPACITY_EXCLUDE_IDS` still counts;
- **Moc** — their hours count into team capacity;
- **Budżet** — their tasks take SP budget in planning.

People are added by searching the whole company directory (IT first), so someone with no tasks yet can be added;
the "Nieprzypisane" placeholder account is not offered. While the window is open the list's shortcuts are off and
`Esc` closes it.

The team is saved **on the server**, in `binear-team.json` next to the app (gitignored; another path via
`BX_TEAM_FILE`), separately for each project — everyone using the same binear instance sees the same team and the
same capacity. The window reads it fresh every time it opens; the last save wins. The browser keeps a copy
(`binear.team.v1:<project>`) for a quick start and for when the server doesn't answer. A team saved the old way
(browser only) moves to the server by itself the first time the app opens and the server has no team yet.

## Sprint summary view

The fifth view mode (key `5`, "Podsumowanie sprintu") shows the **active sprint** the way it is discussed
at the Priority Council, from live data — so it works *before* the sprint is closed (closing moves the
undelivered tasks to the next sprint and the picture is gone):

- five tiles: **delivered**, **waiting for deployment** (PR), **in progress**, **waiting**, **on hold** — SP and
  number of tasks — plus one proportional bar and a one-line summary (finished = delivered + PR);
- a table **per department** (epic): totals, a bar and the SP per state; unfold a department to see its
  **topics** (parent tasks), each with its own bar — a click opens the task;
- only leaf tasks are counted (a parent with subtasks in the sprint is a folder, its points sit on the
  subtasks), a topic and a department come from the root task; tasks without SP are counted but add no
  points. State comes from the Bitrix status (5 delivered, 4 PR, 6 on hold, 3 or the "In progress" stage in
  progress, the rest waiting). Scope, filters and search do not apply here.

## Tiles

The row of cards under the header is made of **tiles**. A tile is a **saved view**: a scope (active sprint /
outside / all), the filters from the filter bar and the *only mine* switch, plus how it looks — name, colour
(8 swatches or any colour), one of 56 icons, and what it counts (**tasks** or the **sum of SP**, the other number
shown smaller). Tiles sit in **groups**; a group caption shows the sum of its tiles and the change against the
previous day, and a group can hide its caption.

Click a tile to apply its view, click it again to clear the filters; filters you add while a tile is active
narrow it. A tile still counting (story points or chats not loaded yet) shows `…` and writes nothing to the
history.

**Editing.** The tile editor is the **Kafelki** tab of **Ustawienia** (header button): the same strip of
tiles on top, the selected tile or group below, laid out like the view panel (label on the left, control on the
right). In the editor:

- **drag** a tile to reorder it, also into another group — or onto the **+** at the end (or pick **Osobno** under *Grupa*) to take it out of its group (it gets its own caption-less group);
  a tile that stands alone shows **Osobno** selected (dashed, in the accent colour — it is no group's name);
- **groups**: *Grupa* in a tile's form — new or existing — has **+ Nowa grupa**, which turns into a name field
  right there (Enter creates; for a new tile the group is created only together with the tile); a group left
  without tiles shows a "drag a tile here" slot;
  the **×** next to a group's name (on hover or when selected) deletes it and asks whether its tiles go with it
  or stay on the bar on their own;
- **+** at the end of the strip (or `N`) saves the **current view** as a new tile;
- keyboard: `←` `→` select, `Shift`+`←` `→` move, `↑` from a tile to its group, `↓` back, `Del` delete,
  `Esc` deselect, a second `Esc` closes the window;
- **Wczytaj domyślne kafelki** loads the IT set below from the repo (`public/binear-kafelki-IT.json`);
  on an empty row the same button stands in the row itself;
- **Eksportuj / Importuj** move a set as a JSON file; with tiles already there, binear asks whether to
  **replace** them or **add** the new ones next to them;
- **Wyczyść wszystko** removes every tile and group (after asking).
- **Pasek** shows or hides the bar on the list and chooses what happens when the tiles don't fit: one row that
  scrolls sideways (default) or wrapped onto further rows; remembered in this browser with the other view settings.
  The same switch is in **Wygląd** (*Pasek kafelków*) — one setting, so both always show the same value.

Deleting, clearing and importing ask in the app's own dialog. The configuration lives in this browser
(`localStorage`, key `binear.tiles.v1`).

## Filters made for tiles

Besides the usual dimensions, the filter bar (and so every tile) has:

- **Odpowiedź w czacie** — someone outside IT answered after our questions / not; read from the task chats;
- **Rodzaj zadania** — parent with an open subtask (a *folder*) / subtask / plain;
- **Gotowość do startu** — ready / not ready, by the rules in *What "ready" means* below;
- **Brakuje** — what exactly is missing: pool, story points, category, payback (`ZWROT-…`), deadline
  (`WYMOG`) or the `WARTOŚĆ` message (`RDZEN`). For example *DO-STARTU and missing only the payback*.

Tag filters match case-insensitively, as in Bitrix (`bug` = `BUG`). A **Status** filter that picks a closed
status shows completed tasks; nothing else does (`Status ≠ Odłożone` does not).

## The IT set

The default tiles (*Wczytaj domyślne kafelki*) follow the steps of the task audit. The register states exclude
**deferred tasks, `KONCEPCJA` and folders**, so the five state tiles add up to the "Poza sprintem" group sum
exactly — each task outside the sprint is in one of them:

| tile | filters |
| --- | --- |
| **Do wywiadu** | outside the sprint, neither `DO-STARTU` nor `OCZEKUJE-NA-ODPOWIEDZ` (new tasks, or tagged only `BUG`, `Wysoki`…) |
| **Czeka na odpowiedź** | `OCZEKUJE-NA-ODPOWIEDZ` without `DO-STARTU`, nobody outside IT answered yet |
| **Do analizy odpowiedzi** | the same tag, and someone outside IT answered with substance after our last questions |
| **Do wyceny** | `DO-STARTU` without story points **or** without a matrix tag `A`–`D` |
| **Gotowe do startu** | `DO-STARTU` with story points **and** a matrix tag `A`–`D` — can be pulled into a sprint |
| **Sprint** | the active sprint's remaining work (without *Wdrożone*, *Pull Request* and *Do zatwierdzenia*) |
| **Ważne** *(own group, no caption)* | open tasks with the **flame** **or** the `BUG` tag, in the sprint or outside it, deferred excluded |
| **Odłożone** | deferred tasks (status 6) outside the sprint |
| **Koncepcja** | open tasks tagged `KONCEPCJA`, deferred excluded |
| **Foldery** | outside the sprint, with an open subtask — containers, the work sits in the subtasks |

The two-tags case is in the filters too: a task with both `DO-STARTU` and `OCZEKUJE-NA-ODPOWIEDZ` counts as
`DO-STARTU`. Checked against the old built-in counters on live data: every tile gives the same number, except
**Sprint**, which used to count every task of the sprint, done ones included, and **Do wyceny** / **Gotowe do
startu**, which now follow the Eisenhower matrix (`A`–`D`) instead of the pools.

**What "ready" means (the *Gotowość* and *Brakuje* filter fields).** The default tiles no longer use it, but
the fields stay for your own tiles and views. A `DO-STARTU` task is ready to start when it has a **pool**, an
**estimate**, and the value that its pool asks for:

- **a pool** — exactly one of `CIAGLOSC` (continuity), `RDZEN` (core) or `DZIAL` (department).
  Mandatory: **without a pool a task is never ready** and sits on "Do wyceny", reconnaissance
  included. If a task carries two, the first in that order counts;
- **story points** (the estimate);
- **`CIAGLOSC` and `DZIAL`** — a benefit category (one tag out of `BUG`, `OSZCZEDNOSC`,
  `PRZYCHOD`, `RYZYKO`, `ANALITYKA`, `UTRZYMANIE`, `WYMOG`; a tag outside this list, e.g.
  `Wysoki` or `STRATEGIA`, is not a category) and a payback period — one of `ZWROT-3` (up to 3
  months), `ZWROT-6` (3–6), `ZWROT-12` (6–12) or `ZWROT-12+` (over 12, or "can't be counted"). The
  tag is a copy of the band written into the task's `WARTOŚĆ` chat message by the value script. If a
  task carries two of them, the worst one counts. `WYMOG` (law, contract, a counterparty) has no
  payback period but **must have a deadline** (Bitrix's own `Termin` field);
- **`RDZEN`** — a `WARTOŚĆ` message in the task chat (its first line can be `WARTOŚĆ: rdzeń`,
  `WARTOŚĆ: zwrot …` or `WARTOŚĆ: wymóg`). Category and `ZWROT` are **not** required, and the tag
  alone doesn't complete it — the chat does.

The old `STRATEGIA` tag meant what `RDZEN` means now (value from the `WARTOŚĆ` message), so a task with
`STRATEGIA` and **no pool tag** counts as `RDZEN` — it isn't pushed to "Do wyceny" and the bottom of planning
just because nobody re-tagged it. With a real pool tag, `STRATEGIA` changes nothing. A task with **two pool tags**
is never ready: *Brakuje* shows "Jedna pula (zadanie ma dwie)" until someone removes one.

**Reconnaissance** (up to 4 h, `--rozpoznanie`: its result is the estimate and the value of the real
task) is ready with just a pool and an estimate — no category, no payback tag, no `WARTOŚĆ`. It is
recognised the way the audit does it: by the line in its `WYCENA` chat message (`Rozpoznanie — bez
okresu zwrotu`, or the older opening of the justification: Rozpoznanie / Weryfikacja / Przegląd kodu
/ Sprawdzenie), or — with no chat read at all — by a title with "rozpoznanie" or "weryfikacja" on an
estimate of up to 4 h.

**Chats are read for two things only**, and only for open, non-deferred `DO-STARTU` tasks with a pool whose
completeness a chat decides: tasks up to 4 h without a complete set of tags
(reconnaissance) and `RDZEN` tasks (the `WARTOŚĆ` message). Everything else comes from the task list.
Chats are read only while some filter or tile uses *Gotowość* or *Brakuje*. While they load, those tiles show
`…` rather than a wrong number, and if chats can't be read at all (no `im` scope) they stay on `…`.

Missing any of the above (pool included) makes the task *not ready*.

**Planning: sort order.** The default stack follows the Eisenhower matrix, in this order: the **Bitrix
priority (flame)**, the **matrix tag** `A` → `B` → `C` → `D` (no tag last), **payback ascending**, and story points
ascending (smaller first, no estimate last).

- The flame means an outage (the company can't work), so nothing overtakes it.
- Payback: `ZWROT-3`, `ZWROT-6`, `ZWROT-12`, `ZWROT-12+`, with `WYMOG` first (nearest deadline first) and tasks
  without a payback tag last.

Every level is a sort level (**Macierz (A–D)**, **Pula**, **Tag Wysoki**, **Okres zwrotu**…) you can reorder,
reverse or drop from the sort menu. Sorting hides nothing: the register still shows every
`DO-STARTU` task, also those with no pool or payback worked out yet.

The sort is saved in the browser as a whole stack, so someone who never touched it would keep the old
default for good. A saved stack that is exactly one of the old defaults is replaced by the new one; a
stack you arranged yourself is left alone.

**Answers.** The anchor is the last comment by IT that looks like interview
questions (a line starting with `[B]1.`). An answer is a later message from someone outside IT that has substance: numbered
points (`1.`, `2)`), or at least 120 characters of its own text once `[USER=…]`
mentions and BBCode are stripped. A ping ("can you answer the questions?") or a
lone mention is not an answer, so it does not turn a task that is still waiting
into one to read. A one-word "yes" to a single question misses the bar — a
deliberate trade-off. System entries (`author_id 0`) don't count. A subtask with no
questions of its own reads its parent's chat, where the interview usually happened.
IT means the webhook owner, the accounts in `BX_IT_USERS` and the people in the
`BX_IT_DEPARTMENTS` departments. Departments come with the chat messages
(`users[].departments`), so telling IT apart costs no extra call. `CHAT_ID` is in
the task list select, so the only cost is one `im.dialog.messages.get` per waiting
task, batched. It runs after the story points arrive, again when a waiting task
changes, and every 5 minutes.

**Trend.** Each day's values are kept in the browser (`binear.counters.v1`, per
project, 90 days), per tile and per group. A tile shows the change against the last recorded day before
today (`▲ 20 wczoraj`); a rise is amber, a drop green. Only settled values are
recorded: until story points and chats arrive, a tile shows `…` and writes
nothing, so a half-loaded zero can't pose as a drop. A tile created anew (an import, a re-added set) starts
its history from that day. Days with binear closed are
simply missing, and the arrow then compares with the last day it was open.

## Sprint clock

On the **New / Pending** stage (list header or board column, active sprint only) a
chip shows two numbers, e.g. `mamy 97 · czeka 59 SP` — the story points the team can
still do before the sprint ends ("we have") and the points still waiting after the
excluded accounts' tasks are taken out ("waiting") — coloured by whether the second
fits in the first. The working-out (hours × developers, what is left out and why) is in
the tooltip. Numbers are rounded to whole values; the colour is computed from the exact ones.

- **Hours** are working hours, Mon–Fri 8–16, until the sprint's end. The sprint ends
  on the Monday at 9:00, so that Monday's 8–9 counts as the last hour. Holidays are
  not subtracted.
- **Capacity** = hours × developers (1 h = 1 SP per person). Developers come from
  `BX_CAPACITY_DEVS` in full-time equivalents, fractions allowed (default 3.5: three full-time
  developers plus one half-time).
- **Team and weekly schedule.** Instead of a fixed number of developers you can describe the team in
  the app: **Ustawienia → Zespół i grafik** (or the team link in the planning view). Pick people, set each one's FTE (1, 0.75,
  0.5, 0.25) and untick the days someone is away (everyone is present Mon–Fri by default, so only
  exceptions are stored). Capacity = FTE × 8 h per ticked working day; with a team entered it replaces
  `BX_CAPACITY_DEVS` in the countdown chip and, when the SP-per-sprint field is empty, becomes the
  planning limit (from now, or from the sprint start, until its end). An empty team keeps the old
  behaviour. The configuration is shared through the server (see [Team](#team)).
- **Waiting** = tasks of the active sprint on the `NEW` stage that have an estimate.
  Tasks in progress are not counted: we don't know how far along they are.
- **Left out of the limit**: tasks assigned to the accounts in
  `BX_CAPACITY_EXCLUDE_IDS` (e.g. a manager who isn't part of the team's capacity).
  They are subtracted before comparing and listed in the tooltip.
- **Colour**: green up to the capacity, orange slightly above it, red from
  1.5× capacity ("we won't make it").

It counts the whole group of tasks, not what the current filter lets through.

### Planning: team vs manager

The accounts in `BX_CAPACITY_EXCLUDE_IDS` (a manager who isn't part of the team's capacity) don't
use up the sprint limit in the planning view either:

- **The limit bars count the team only** — "planned" and "with carry-over" — so the manager's tasks,
  moved in from the backlog or carried over from the running sprint, no longer eat into the limit
  or show up as "over".
- **"How much the register can still take"** (the points left before the red "doesn't fit"
  line) is computed from the team's tasks only, and a manager's task is never marked as not fitting:
  it takes no capacity.
- **"Last delivered"**, the fallback limit when no capacity is typed in, counts the team's tasks
  only as well, so it is measured the same way as the bars it is compared against.
- The manager's work is still shown, **separately**: a bar of its own under the team's bars
  (`Kierownik · poza limitem`, no limit marker, carried-over part hatched), and the panel header
  reads `… SP zespołu · … SP kierownika` instead of one total.
- Without `BX_CAPACITY_EXCLUDE_IDS` nothing changes: one bar set, one total.

## Search

An identifier-shaped query (`IT-749`, `it 749`, `749`, `#114677`) is matched
**exactly** — task code or Bitrix number. Only when nothing matches do we fall back
to substring search across code, number, title and tags.

Without this, `IT-749` also hit task `#114749` (number contains "749"), which then
outranked the real IT-749.

## "Unassigned" = a placeholder account

Bitrix requires a responsible person, so the team uses **Klaudiusz Koder (id 251)**
as a placeholder for nobody's tasks — **177 of 999** in the group, 7 of 25 in the
sprint. These show as **Unassigned** (empty avatar, own group, last in the picker),
and assigning back to the placeholder is the only way to **unassign** a task, which
Bitrix otherwise forbids.

The placeholder shows as **Unassigned everywhere** it appears as a person —
responsible, **author**, collaborators, observers, comment authors — so it never
reads as a real person in one place and a placeholder in another. (Since the account
also authored most tasks via the bulk import, their **Autor** field now says
"Unassigned" too.) The id is configurable: `BX_UNASSIGNED_ID` in `.env`, served to the
front end via `/api/config` (defaults to 251).

## Important tasks on the lists

An important task gets a red mark — in the list, on the board cards and in planning:

- a **flame** for Bitrix's high priority ("Ważne"),
- a **bug** for the `BUG` tag,
- a task that has both shows both (smaller, one above the other, in the list).

**Where it sits.** In the list (and planning) the mark takes the place of the row's checkbox, which is
invisible until you hover the row anyway — so it needs no column of its own and every title still
starts in the same place. On hover the checkbox appears around the mark in the same red; once the
row is selected, the red tick replaces the mark. On the board cards the mark stands before the title.

The `BUG` tag is then not repeated as a label further along the row (the bug mark replaces it).
The **Ważne** (important) card counts flames and `BUG` tags together, each task once. Its day-to-day
history is kept under a new key, so the first day after the change shows "—" instead of comparing
against yesterday's `BUG`-only number. The row's old priority bars are gone — Bitrix only knows
"important or not", which is what the flame says; the priority is still editable in the detail
panel and filterable.

## Planning: who owns a task entering a sprint

When tasks are moved **from the register into a sprint** in the planning view, a task whose
responsible person is **outside IT** is handed to the placeholder account (`BX_UNASSIGNED_ID`, the
"Unassigned" account IT works under) — the requesting department isn't the one who will do it. If the
responsible person is **in IT**, they stay. A toast says how many tasks were handed over.

- **Who counts as IT**: the account binear runs under, accounts in `BX_IT_USERS`, people from the
  departments in `BX_IT_DEPARTMENTS` (read from each employee's `UF_DEPARTMENT`), the accounts in
  `BX_CAPACITY_EXCLUDE_IDS` (the manager), and the placeholder itself.
- **Only register → sprint.** Moving a task between sprints, or back to the register, changes nothing.
- **Unknown stays put.** If the employee list hasn't loaded, or the person isn't in it, the task is
  left alone — a wrong guess in the other direction would take a task away from someone in IT.
  The same goes for an empty `BX_IT_DEPARTMENTS`: without it nobody is handed over at all.
- **Move first, owner second.** If the owner change fails, the task stays in the sprint with its old
  owner and only the owner change is undone.
- Only this planning path does it; the context menu and the board's drag-and-drop move tasks as before.

## Status ≠ Stage

Two independent fields, and the main source of confusion:

| | Task status | Sprint stage |
| --- | --- | --- |
| what it is | built-in task field | kanban column of a specific sprint |
| values | `tasks.task.getFields` → 2–6 | `getStages(sprintId)` — its own per sprint |
| when it exists | always | only while the task is in a sprint |
| changing it | `tasks.task.update` (`STATUS`) | `task.stages.movetask` (`stageId`) |

A task has **both at once**, and they can contradict (Status `Pending` + Stage
`To approve / PR`). In the IT SCRUM group the real workflow lives in the **Stage** —
`bitrix_sync.py` drives it from git (PR → `To approve / PR`, deploy → `Deployed`).
Status is nearly unused (784 `Completed`, 184 `Pending`, 29 `Deferred`,
`In progress`/`Awaiting review` zero) — hence Stage is the default grouping.

## Typography

Most of the character is in the settings, not the typeface:

```css
font-feature-settings: 'cv01', 'ss03';
font-variation-settings: 'opsz' auto;
text-rendering: optimizeLegibility;
```

Weights are **non-standard** — medium `510`, semibold `590`, bold `680` — which
Inter's variable axis allows. **No custom `letter-spacing`** (a `-0.006em` that
fought Inter's optical sizing was removed). Sizes: micro 11, mini 12, small 13,
large 18 px.

**Icons are drawn (SVG), not typed.** Inter lacks `⌘ ⑂ ↻ ⋯ ↳ ✓ ✕ ↗`, so a fallback
font rendered them at random (`⌘` looked like a lightning bolt). Only `← → ↑ ↓`
stay as characters — they're in the font and mean the arrow keys. The shortcut
modifier follows the OS: `Ctrl` on Windows/Linux, `⌘` on macOS (`IS_MAC`).

**No rule under every row** — rows separate by hover and group headers; a hairline
every 36 px made a table of the list. Rules remain only between sections (panel
header, property block, palette field).

## No sidebar

The old sidebar held grouping and a cheat sheet, and vanished below 1080 px —
taking grouping with it. Everything moved into the toolbar (project left,
`☰ Group:` and `?` right), so **no control depends on window width** and
responsiveness gives up space, never function.

## Multi-select and bulk actions

| gesture | effect |
| --- | --- |
| **checkbox** (on hover) | selects without opening; `Shift` takes a range |
| `Ctrl`/`⌘` + click | toggles one task in the selection |
| `Shift` + click | selects the range from the last click, **inclusive** |
| plain click | clears selection, opens the task |
| `Esc` | drops selection (only then closes the panel) |

The checkbox shows only under the cursor or when checked. Modifier-selecting
doesn't select text (`preventDefault` on `mousedown` + clearing
`window.getSelection()`). The range is computed in **visible** order (collapsed
groups and subtasks accounted for), so `Shift` never catches off-screen rows.

Right-click on a selected task covers the **whole selection** — header shows
`Selected: N`, current values disappear (they differ across tasks); `s`/`a`/`p`/`m`
behave the same. Each task gets its own optimistic mutation, so one error rolls
back only that task. A bulk stage change applies only to tasks in the **same
sprint** as the chosen stage — the rest are skipped with a toast, not silently.

## Hierarchy in the list

Subtasks nest under their parent and collapse (`▸`) when the parent shares the
group. **Expanded by default** — collapsing is opt-in, so subtasks don't silently
vanish.

Two side-by-side badges mean different things:

| badge | meaning |
| --- | --- |
| `+N` (filled, neutral) | tags that didn't fit — hover to see them. Fit depends on **list width** (2 → 6), measured with a `ResizeObserver` on the container (an open panel takes half the screen) |
| `⑂ N` (outlined, accent) | subtasks **hidden by the filter** — visible ones aren't counted |

E.g. IT-736 shows `+1` (a third tag) and `⑂ 2` (two placeholder subtasks cut by
"Only mine").

When the **parent has left the group**, its subtask sits at level 0 and gets a
clickable `↳ IT-736` link to the parent, so it doesn't read as standalone:

| grouping | rows with the link |
| --- | --- |
| Sprint stage | 23 |
| Assignee | 23 |
| Task status | 7 |

On the **board** cards don't nest, so all 63 subtasks get the link.

The `j`/`k` cursor walks only what's visible, so collapsing shortens navigation.
**The cursor sticks to the task, not the position** — the list rebuilds on every
filter/group/sort change, so after a rebuild we match the same `id`, and when the
task has dropped out we **highlight nothing** (clamping to the length would just
strand the highlight on a random row). `j`/`k` then enters from the top.

For the same reason **the panel closes when the open task leaves the content
filters** (Only mine, Completed, tag, search) — a selection not in the list isn't a
selection. But **scope is not a content filter**: switching `Sprint · Outside · All`
is a way of *looking*, like List/Board, so it keeps the open task even when that task
isn't in the chosen scope. Two more exceptions: collapsing a group only hides the row
(task stays), and a subtask opened **despite** the filters (via a panel link) stays,
since its hidden state was known at click time.

## View panel (Display)

View tabs, then `label → compact select` rows (a direction button beside Grouping
and Sorting), toggles last:

```
[ ☰ List ][ ▦ Board ]
Grouping        Sprint stage    ⌄   ↑
Sub-grouping    None            ⌄
Sorting         Updated         ⌄   ↓
Scope           Sprint 60       ⌄
──────────────────────────────────
Only mine                         ☑
+ unassigned                      ☐
Show completed                    ☐
```

Sorting: **Updated / Created / Priority / Due date / Title**, own direction; blanks
always go last, either way. The button beside Grouping reverses **group** order (not
tasks within a group). **Your own tasks are always favoured** — but only as a
tiebreaker *under* the chosen sort, so it never overrides the order you picked (there's
no toggle for it). The palette's **Sort by** section reverses direction when you pick
the same axis again, like a table header.

### Settings

All configuration lives in one **Ustawienia** window — the *Ustawienia* button in the header, or the bottom of
the view panel. Tabs on the left: **Wygląd** (theme, font, group
colouring, deadline look, task panel as a drawer or a column, and the *Karta zadania* section: which elements a
list row shows, left or right, in how many lines — this browser only; the view panel keeps only what shapes the
current view), **Kafelki** (see *Tiles*; stored in this browser only), **Środowisko**, **Zespół i grafik** (see *Team*), **Tagi i epiki** (see
*Tags & epics*) and **Uprawnienia webhooka** (what the token can do — read-only probes). A tab, once opened,
stays mounted while the window is open, so switching tabs doesn't lose an unsaved form or the chosen week.

**Środowisko** holds the
non-secret `.env` values: default project (`BX_GROUP_ID`), the *Unassigned* account (`BX_UNASSIGNED_ID`),
IT departments and extra IT accounts (`BX_IT_DEPARTMENTS`, `BX_IT_USERS`), developers in FTE
(`BX_CAPACITY_DEVS`) and who stays outside the SP limit (`BX_CAPACITY_EXCLUDE_IDS`). People and departments
are picked by name; if the webhook can't read the company structure (`department` scope), departments are
typed as numbers. **Zapisz** rewrites only those lines in `.env` (comments and everything else stay) through
`/api/env` and the server re-reads them at once — no restart. Only same-origin requests can save, and only
these keys with digit-only values pass. A key also set in `.env.local` or the system environment wins over
`.env`; the panel says so instead of pretending it saved. `BITRIX_WEBHOOK` is never shown or editable.

## Two context menus

Right-click gives **different** things in two places:

- **on a task** (row/card) — status, assignee, priority, stage
- **on empty background** — view, grouping, scope, filters, refresh

Rows stop propagation so the task menu doesn't also fire the view menu. That view
menu also opens from a toolbar button on screens ≤ 620 px (where the scope bar is
hidden) — one definition, two entrances.

## Responsiveness

Things are given up in order of least need; **no control disappears** — all live in
the always-visible toolbar and view panel.

| width | what happens |
| --- | --- |
| ≤ 1280 px | detail panel narrower |
| ≤ 860 px | detail panel full-screen, scope bar wraps |
| ≤ 620 px | scope bar → single button; date and tags leave the row |

Also: `@media (hover: none)` pins `⋯` (no hover on touch), and
`prefers-reduced-motion` disables animations.

## Colors and themes

The theme (and the font, group colouring, deadline look and task panel) is picked in **Ustawienia → Wygląd** or the command
palette. The color layer is CSS variables in `styles.css`; a theme overrides **only those** —
spacing, weights and sizes are shared, so switching themes moves neither layout nor
density. The choice lands on `<html>` as `data-theme`; "System" mirrors
`prefers-color-scheme` and follows the OS mid-session. `binear.theme.v1` is separate
from view settings because a `<head>` script reads it before React starts — else a
light theme would flash a dark background.

| dark | background | | light | background |
| --- | --- | --- | --- | --- |
| Dark (default) | `#09090c` | | Light (default) | `#fffeff` |
| Tokyo Night | `#1a1b26` | | **Bitrix24** | `#f8fafb` |
| Gruvbox | `#1d2021` | | Catppuccin Latte | `#eff1f5` |
| Solarized Dark | `#002b36` | | Rosé Pine Dawn | `#faf4ed` |
| Argonaut | `#212434` | | Solarized Light | `#fdf6e3` |
| Everforest | `#272e33` | | | |
| Nord | `#2e3440` | | | |

**Bitrix24** is the only theme with borrowed colors — all from the portal's
`ui.design-tokens.css` (`gray-05` panel, `link-primary-base` `#2066b0` accent,
`red-60` priority), token names in comments. Two departures: the **layer order is
ours** (panel darker than the background, rule 1 — Bitrix does the reverse), and the
**accent is the link color, not brand blue** `#2fc6f6`, which is too light for white
button text.

Two rules for every theme:

1. **Elevation** — dark: panel lighter than background; light: darker. Reversing it
   flattens the UI.
2. **Text contrast is graded** — `fg → fg-secondary → fg-muted → fg-dim`.

Swap two adjacent levels on either ladder and the depth is gone. The variable
mapping is documented atop `styles.css`.

## Views

**List** — group by stage / status / person, plus **sub-grouping** on a second axis
(e.g. Stage → Assignee). Group and subgroup headers collapse independently with
counts; the primary axis drops out of the subgroup list.

**Board** — the sprint kanban from Bitrix: columns are the stages from
`tasks.api.scrum.kanban.getStages`, in their order and colors. Dragging calls
`task.stages.movetask`.

**Drag & drop works in the list too** — dropping a row onto a group applies that
group's value:

| grouping | what dropping does |
| --- | --- |
| Sprint stage | `task.stages.movetask` (resolved within **each** task's own sprint — same name, different id per sprint) |
| Task status | `tasks.task.update` → `STATUS` |
| Assignee | `tasks.task.update` → `RESPONSIBLE_ID` |

Dragging a selected task moves the **whole selection**. "Outside sprint" and
"Unassigned" can't be dropped onto — they're the absence of a value; a toast says
so rather than staying silent.

## Command palette

`Ctrl/⌘+K` — one entrance to everything: actions on the cursor's task,
view/scope/grouping switches, jump to a task by `IT-XXX` or title. Matching is on
all query words, so "sta com" finds "Status: Completed". `?` opens the cheat sheet.

## Bitrix-specific fields

The panel shows these **only when the task uses them**:

- **parent task and subtasks** — hierarchy computed locally, no extra query; in the
  list it's the `⑂ N` counter
- **checklist** — with a completed count
- **collaborators** and **observers** (`accomplicesData` / `auditorsData`)
- the task's **author**

## Task actions

Main route is **right-click** (or the `⋯` on a hovered row) — the menu shows each
field's current value. Shortcuts are an alternative.

| Action | REST method |
| --- | --- |
| Status | `tasks.task.update` |
| Assignee | `tasks.task.update` |
| Priority | `tasks.task.update` |
| Stage | `task.stages.movetask` — only for tasks in a sprint |
| Sprint | `tasks.api.scrum.task.update` — sprint ↔ backlog, see below |
| Comment | `task.commentitem.add` — **writes to the forum**, see [Comments](#comments) |

Writes are **optimistic**: the row changes immediately and dims until confirmed; on
rejection it reverts to the remembered value and a toast shows `error_description`.

### Sprint ↔ backlog

The `w` shortcut (and the **Sprint** context-menu entry) works on multi-selection.
Two targets: **the active sprint** and **Backlog**. Historical sprints are omitted
on purpose — you'd never drop a task into a closed one, and 61 entries would clutter.

Two things this puts straight:

- **"Outside sprint" isn't the absence of an assignment.** In scrum the backlog is
  its own entity with an id (`229`) just like a sprint (`367`), and a task always
  sits in one — hence one method both ways, not add/remove. The backlog id comes
  from `tasks.api.scrum.backlog.get`.
- **`tasks.task.update({ SPRINT_ID })` isn't an alternative** — the field exists in
  `getFields`, but membership lives in a separate scrum table; setting the field
  alone desyncs them.

The stage after a move is **not guessed** — Bitrix assigns it on entry, so we clear
it optimistically and pull the real one with a silent refresh (see
[Background refresh](#background-refresh)). Dragging a card from "Outside sprint"
onto a sprint column **still doesn't pull it in** — a toast says so.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` (or ↓ / ↑) | navigate the list |
| `↵` | open task |
| `Esc` | close menu / panel / leave search |
| `/` or `Ctrl+F` | search — we take over `Ctrl+F`, since the browser's find only sees filtered rows |
| `r` | refresh |
| `s` / `a` / `p` / `m` | status / assignee / priority / stage |
| `w` | sprint ↔ backlog (`s` is status, so sprint gets **w** for *wrzuć*, "throw it in") |
| `Ctrl+↵` | send comment (in the comment field) |

## How it works

- `server/bxProxy.ts` — a Vite plugin: `/api/bx/<method>` → `POST` to the webhook,
  serializing params in Bitrix's format (`filter[GROUP_ID]=451`). Method allowlist,
  because the webhook is omnipotent. `/api/config` hands over `groupId`, `userId`
  and the portal address — everything but the token.
- `src/bitrix.ts` — client, types, normalization. Bitrix returns fields as
  `camelCase` or `UPPER_CASE`, and `responsible` as an id or an object;
  normalization flattens that. Pagination via `next` (50/page).
- `src/markdown.tsx` — descriptions/comments mix HTML entities (`&#91;`), BBCode
  (`[url=…]`, `[b]`, `[list]`) and markdown from the import. We render **both at
  once** — headings, lists, task lists `- [ ]`, tables, code, quotes, `**bold**`,
  `` `code` ``, `~~strike~~`, links, plus inline `[b]/[i]/[u]/[s]` — all as React
  elements, **without `dangerouslySetInnerHTML`** (task content is untrusted). On
  IT-749: 1 table, 37 list items, 2 code blocks, 10 checkboxes, 60× bold, 153×
  inline code. A trap: imported URLs shaped `[text](<https://…>)` need the angle
  brackets stripped, or the `href` ends in `>` and the link breaks.
- Kanban stages are **per sprint**, so we fetch them only for sprints that occur on
  tasks.

## Background refresh

The list keeps up on its own — every 30 s, no spinner, no flicker. It isn't
listening, because **Bitrix can't call us**:

| channel | state |
| --- | --- |
| inbound webhook | an API key, not a push channel — one direction |
| `event.bind` (outbound) | `WRONG_AUTH_TYPE` — `event.*` refuses webhook auth; needs a local app **and** a public address, but Binear is on `localhost` |
| `pull.*` (WebSocket) | `insufficient_scope` — the module is on the portal; adding the `pull` scope would be the only route to real listening |

Instead we fetch **the delta**: `tasks.task.list` filtered by `>CHANGED_DATE`, a
single `ID` field, `start: -1` (no `total`). It's almost always empty, and only a
non-empty answer triggers a full fetch — so 30 s costs one tiny query, not a sweep
across 1011 tasks.

Two things to know:

- **The threshold is data, not clock.** `since` is the freshest `changedDate`
  Bitrix returned, handed back untouched. An offset-less date is read in the
  portal's timezone, two hours off ours — a locally computed threshold caught
  two-hour-old changes every probe.
- **A deleted task has no change date**, so the probe misses it — hence returning to
  the tab (`visibilitychange`) does a full refresh, not a probe.

### When the probe stays quiet

- **Tab in the background** (`document.hidden`) — nobody's looking.
- **A write of ours is in flight** — a stale response would briefly roll back the
  optimistic change.
- **Nobody's at the keyboard** — 5 minutes idle. `document.hidden` speaks about the
  **tab**, not you: a tab left in front looks used, so the probe once hit Bitrix
  every 30 s **all night** — thousands of queries from one IP.

Coming back (keyboard or tab switch) **pulls full data at once** — during the gap a
task could have been deleted, which the probe can't see.

### Fresh data for the open task

The probe above is blind to some edits: **story points and the epic live on the task's
scrum entity, and changing them does not move the task's change date**, so an edit made
in Bitrix never woke the probe and the list kept the old value until someone refreshed
everything by hand.

So the detail panel keeps **the task it shows** fresh by itself, and says how fresh it
is. In the panel header, next to the icons:

`↻ pobrano 12 s temu` — when this task's data last arrived from Bitrix. Click it to pull
this one task again.

- **On open** the panel shows what it has (list row, cached details and comments) at
  once, labelled `z pamięci`, and in the same moment starts fetching the real thing in
  the background; the label turns into `pobrano …` when it lands.
- **While it stays open**, every 30 s it checks again — the task's list fields (tags,
  stage, people, deadline, **story points, epic**), its details and its comments. The
  thread is swapped quietly and only when it actually changed, so scroll and a draft
  you're typing are left alone.
- **It stops asking** when the tab is in the background or nobody has touched the
  keyboard for 5 minutes (same rule as the list probe), and asks at once when you come
  back — to the tab, or to the keyboard or mouse after a break.
- **Cost**: one task is two requests for the row (`tasks.task.list` by `ID` +
  `tasks.api.scrum.task.get`), one for the details and one or two for the comments —
  a handful per 30 s, only while a task is open. Your own unconfirmed edits keep
  priority over the fetched row, as with every fetch.
- If a refresh fails the label turns amber (`nie udało się odświeżyć · 3 min temu`) and
  the old data stays — an old number must not pass for a fresh one.
