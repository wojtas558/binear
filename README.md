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

**System entries are filtered by `author_id === 0`** ("changed stage", "is now an
observer", "task chat created") — a chat holds far more of these than real
comments (IT-754: 6 messages, 1 comment). Author names ride in the response's
`users` field, so no extra `user.get`. Threads cut off at 100 messages
(`im.dialog.messages.get` pages back via `LAST_ID`, rarely needed).

**Sending still goes to the forum** (`task.commentitem.add`). On a forum-less task
it probably won't show in the Bitrix UI — the right route would be `im.message.add`
to the chat, unverified since it needs a live write.

## Tags

`TAGS` doesn't appear in `tasks.task.getFields`, but `tasks.task.list` returns it
with names (`{"243":{"id":243,"title":"EMX"}}`), so no dictionary query is needed.
Clicking a tag filters the list (shown in the scope bar, cleared with ✕). Tags are
also a palette section with usage counts.

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

The color layer is CSS variables in `styles.css`; a theme overrides **only those** —
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
