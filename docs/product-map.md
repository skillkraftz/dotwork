# Dotwork product map: how the app works today

This describes what the code does now (commit `25cf010`, the head of `main`, with phases 1 and 2 of [product-model.md](product-model.md) applied: pages,
spreads and books are Library documents that save themselves, and sections are documents too), read from `src/`, not from the other docs or from comments. Where the code and a doc disagree, the code wins and the disagreement is listed in **Things that disagree** at the end.
Anything I could not confirm from the code is marked **(unsure)**.

The owner's example, `tests/fixtures/monthly-log-book.json`, was checked against the code; see **The owner's monthly log book**.

## 1. The parts, in one picture

```mermaid
flowchart LR
  subgraph DESIGNER["Designer (Page / Spread view)"]
    ED["Editor<br/>3 Stores: page, left, right<br/>each with its own undo (200 steps)"]
    ADV["Advanced picker<br/>icons · widgets · art"]
    SET["Settings window<br/>name · page number · identity · side"]
  end

  subgraph BOOK["Book (Book view)"]
    ARR["Arranger<br/>one page at a time · Apply · Dates<br/>Build book · Save as section · Flip<br/>own undo (30 snapshots)"]
  end

  subgraph LIB["Library"]
    LIBW["Library window"]
    IDB[("IndexedDB dotwork/library<br/>pages · spreads · sections · books")]
    LS[("localStorage<br/>widgets (and art) · favorites")]
    BUILT["Built-ins in the code and examples/<br/>pages · spreads · sections · widgets · art · book templates"]
  end

  subgraph PRINT["Printing"]
    EXP["Import and export window<br/>Import · Export (JSON) · PNG · PDF"]
    CAL["Calibrate"]
    PP[("Printer profile<br/>localStorage dotwork.printer")]
  end

  OPEN[("Open page, spread and book<br/>dotwork.open: Library ids")]
  FILES(["Files: .json in and out · .png · .zip of PDFs"])

  ED -- "every change: written to its own entry after 400 ms" --> IDB
  ED --> OPEN
  SET --> ED
  ADV --> ED
  LIBW <--> IDB
  LIBW <--> LS
  BUILT -- "open: read-only; edit: a named copy" --> ED
  LIBW -- "open page / spread: the open one is written first" --> ED
  LIBW -- "open book: the open one is written first" --> ARR
  IDB -- "pages, spreads, sections listed in the picker and builder" --> ARR
  ARR -- "every change: written to its own entry after 400 ms" --> IDB
  ARR --> OPEN
  ED -. "no link: pages in a book are copies" .-> ARR
  ARR -- "Save pages as a section (a copy)" --> LIBW

  CAL -- "offsets · scale · creep · shifts · tones" --> PP
  EXP -- "layout and the same fields" --> PP
  PP -- "how to print" --> EXP
  ARR -- "the open book, read at the moment of export" --> EXP
  ED -- "page / spread for JSON and PNG" --> EXP
  ARR -- "name, page count, pages" --> CAL
  EXP <--> FILES
  CAL --> FILES
  EXP -- "Import page / spread: adds a document and opens it" --> ED
  EXP -- "Import book: adds a document and opens it" --> ARR
  EXP -- "Import section: adds it to the Library" --> LIBW
```

The one rule that holds everywhere: **nothing refers to anything else; everything is copied.** A page in a book is a copy of the
design it was chosen from. A spread holds two copies. A section holds copies. A recipe holds whole copies of its sections. A widget
placed on a page becomes ordinary elements. The only references in the app are Library ids (favorites, and the "Bottom book" choice in
the PDF tab) and the names of built-ins.

## 2. Things the app stores

| Thing | What it holds | Where it is kept | How it refers to others |
|---|---|---|---|
| **Page** (`dotwork-page`, version 2) | `name`, `identity` (the header text, may hold tokens), `page_number` (default on), `side` (`left` / `right` / `either`), the 27 × 44 grid, `elements[]` (pattern, shade, box, rule, checkboxes, text, sequence, art; each may carry a `group` id). `src/format/types.ts` | Library: kind `page`; the open page is one of these entries (its `name` is the entry's, put into the file when it is exported). Inside spreads, books, sections, recipes. | Copy everywhere. |
| **Spread** (`dotwork-spread`, v2) | `name`, a `left` page and a `right` page (each must carry the matching `side`). `src/format/spread.ts` | Library: kind `spread`; the open spread is one of these entries. The two pages are the editor's two Stores; the spread object is built when written or exported (`currentSpread()` in `main.ts`). | Two embedded copies. |
| **Book** (`dotwork-book`, v1) | `name`, `page_count` (multiple of 4, 4–400), `page_numbers`, `print: { signatures }`, `pages[]` (page or `null`, entry *i* is page *i*+1, each turned to face its slot), optional `dates[]` (parallel to `pages`), `cover` (`front` = inside front, `back` = inside back, optional `outside_front`, `outside_back`), optional `recipe`. `src/book/book.ts` | Library: kind `book`; the open book is one of these entries (its `name` is the entry's, put into the file when it is exported). | Embedded copies of every page, cover, and (in the recipe) every section. |
| **Section** (`dotwork-section`, v1) | `name`, `pages[]` (page or `null`), `days[]` (each page's date as whole days after the first dated page, or `null`), `weekday` of the first dated page, `move` (`none` / `day` / `week` / `month`: how dates shift per repeat), `left` (began on a left page). `src/book/sections.ts` | Library: kind `section`. Built-ins in code (`src/builtin/sections.ts`). Also inside every recipe step. | Embedded page copies. |
| **Recipe** | `month` (`YYYY-MM`), optional `gap` page (Notes when absent), `steps[]`: `{ section (a full copy), repeat: times n / weeks (month?, only_in_month) / fill, start? }`. `src/book/sections.ts`, `src/book/build.ts` | Inside the book (`book.recipe`), so in Library books and in exported JSON. The *window's* working copy is memory only until **Generate book**. | Embedded section copies. |
| **Widget** | `{ id, name, elements[] }`, positions relative to its top-left. `src/widgets.ts` | `localStorage` `dotwork.widgets` (not the Library's IndexedDB). Built-ins from `examples/widgets/*.json` (`src/builtin/widgets.ts`). | Placing it adds ordinary copies; no link back. |
| **Art** | A widget holding one `art` element (an imported SVG: shapes and colors). `src/art/` | Same as widgets: `dotwork.widgets`. Built-ins from `examples/art/*.svg` plus presets. | Same. |
| **Library entry** | `{ id (uuid), kind, name, updated, data }`. The name lives only in the entry, for every kind: `data.name` is left out when it is written and put back when it is read (an older entry that still has one loses it the next time it is written). `src/library/library.ts` | IndexedDB database `dotwork`, store `library` (`src/library/idb.ts`, one connection kept open). The backend is a `Keeper` (`src/library/keeper.ts`): with no IndexedDB, a database that refuses to open, or a first write that fails, it carries on from memory (lost on reload) and the notice at the top says so (D7). | The open page, spread and book *are* their entries, written in place. Names are unique per kind (a taken name gets ` 2`, ` 3`…, built-in names count as taken). A section is a document without an editor: saved from a book (**Save pages as a section**), imported, or duplicated, always as a new entry. |
| **The open documents** | The id of the open page, spread and book (a built-in page or spread by its example id; a built-in book, such as a template's, is not remembered, so the last saved book comes back). `src/documents.ts`, `main.ts` | `localStorage` `dotwork.open` (`{ "page": …, "spread": …, "book": … }`), read at start-up so a reload reopens them; one open document per view (Page, Spread, Book) until the three areas of the product model arrive. | By Library id. |
| **Library backup** (`dotwork-library`, v1) | Every Library entry. | A downloaded file (**Back up library** / **Restore backup**). | Items are replaced by id on restore. **Does not include widgets, art or favorites** (they are in `localStorage`, not the Library store). |
| **Printer profile** | creep per sheet, fore-edge shift, cover shift, target margin, the four tones, `sheet_layout`, and per layout: front/back offsets, back rotation, x/y scale, line weight. `src/printer.ts`, `src/book/impose.ts` | `localStorage` `dotwork.printer`. Loaded once at start-up into a module variable in `main.ts`. Defaults (`DEFAULT_PRINT`) are the owner's printer. | Never in a book. `summary.txt` and calibration pages record the values used. |
| **Old drafts** | None any more. The page, spread and book drafts (`dotwork.page`, `dotwork.spread.left/right/name`, `dotwork.book`) are no longer read or written; anything left under those keys stays untouched. (`src/drafts.ts` is now used only for the printer profile.) | | n/a |
| **Favorites** | Starred Library item ids. | `localStorage` `dotwork.favorites`. | By Library id; built-ins by name (`example:<page name>`, `template:<id>` …). |
| **Book templates** | Functions that build a whole book from a few numbers (year, month, first and last week). | Code only (`src/builtin/templates.ts`). Not saved; the result is just a book. | Output is a copy. |
| **View settings** | `dotwork.view` (page / spread / book), `dotwork.book.spreads` (one page or two), `dotwork.book.picker-tab`, `dotwork.book.flip-ms`. | `localStorage`. | n/a |
| **Memory only** (lost on reload) | Undo stacks, selection, hidden/locked layers, current tool and mode, which spread page is active, the Book view's current page, every window's unsaved choices (PDF checkboxes, PNG resolution, "Bottom book", Calibrate readings, Dates window, builder working recipe). | | |

**Files the app makes:** page / spread / book JSON, PNG (page or spread), and a zip of PDFs
(`<book>-print.zip`: `pages.pdf`, `cover-outside.pdf`, `cover-inside.pdf`, per-signature `print-first.pdf` / `print-second.pdf`
(and `print-duplex.pdf` for two-up), `preview.png`, `summary.txt`, `book.json`, and `error.txt` only on a problem). Calibration
downloads (`calibration-sheet.pdf`, a creep-test zip) also carry `book.json`.

## 3. Every screen, window and menu

Top bar: **Page ▾** (Page, Spread, Book, Settings…), **Edit ▾** (Edit, Preview, Library…, New), **Export**, Undo, Redo, Help.
Page/Spread views also have the bottom tool bar (Select, Draw, Advanced) and the properties drawer / layers.

| Screen | Reads | Writes | When it saves |
|---|---|---|---|
| **Document bar** (under the top bar, in every view) | The open document's name, save status and whether it is a built-in (`DocSession`, `src/documents.ts`) | The name button renames in place (`DocSession.rename`); **Retry** after a failed write; **Edit a copy** on a built-in | Name: on Enter or when the field loses focus. The name shows **Untitled: name it** as a chip while the name is `Untitled`, `Untitled 2`…; the mark says **Saved**, **Saving…** or **Not saved** (with Retry, and a notice that has the real reason and Copy details). It says Saved only after a write that worked with nothing changed since. A built-in shows the quiet bar "Built-in. Editing makes a copy." When the browser can't keep documents, a warning above the bar says so (with an **Export…** button, and the top-bar Export button turns dark) and the mark says **Not saved**, never Saved, with no Retry. |
| **Page view** (editor) | The open page document (`dotwork.open` → Library) at start; Store | Store → its Library entry | Every committed change is written 400 ms after the last one, and at once when the tab is hidden (`visibilitychange`) or closed (`pagehide`). Typing in a properties text field commits after a pause or on blur (`panel.ts`). Undo history, selection, hidden/locked are not saved; undo is in memory for the open document and starts empty when another is opened. A change to a built-in is not made: a name is asked for, the copy is created, and the change is made in it (`Store.guard`). |
| **Spread view** | The open spread document | The two Stores → one spread entry; the name is the entry's | Same. Left and right each have their own undo. |
| **Properties / Layers** (drawer or side panel) | The selected element(s) | Store (undoable) | Same as above. |
| **Advanced** (sequence, icon, checkboxes, widgets, art) | Library-side widgets and built-ins | Arms a tool on all three Stores; **More → Save as widget** writes `dotwork.widgets` | Widgets: immediately. |
| **Settings…** | Page: `store.page` and the document's name. Spread: the document's name + both pages (which keep names of their own inside the spread). Book: the book | Page/spread: Store commits (undoable, coalesced per field); the name renames the document (not a Store commit). Book: `arranger.edit()` → the open book document; the book's name renames the document (not an undo step) | On each input event (`oninput`), not on Done. A built-in's name is read-only. |
| **Library…** (window) | IndexedDB entries; built-ins; `dotwork.widgets`; favorites | rename, delete → IndexedDB (nothing is saved by hand: there is no Save button); **Duplicate** of a page, spread, book or section, built-in or saved, asks for a name (prefilled `<name> copy`) and adds a document; **Export** (sections only) downloads the section; star → favorites; Import SVG art → `dotwork.widgets`; Back up / Restore → file | Only when a button is pressed. Opening a page, spread or book writes the open one first and switches (nothing is replaced); opening a built-in, or a book made from a template, is read-only. A section can't be opened (there is no section editor): tapping it says how to use it. Deleting the open document starts a new one. Tabs: Pages, Spreads, Sections, Art, Books (templates + saved books), Widgets, Favorites. It opens on Pages (or Books in the Book view). |
| **Book view** (Arranger) | The open book document (`dotwork.open` → Library, opened the first time the view is shown); Library pages / spreads / sections (refreshed when shown and when the Library closes); built-in pages and spreads; printer profile (only to warn) | The book, via `edit()` → its Library entry; **Save pages as a section** → Library (a new section; a taken name gets ` 2`, nothing is replaced) | After every change, one undo snapshot each, and the book is written 400 ms after the last change and when the tab is hidden or closed, as for pages. A change to a built-in book is not made: a name is asked for, the copy is created, and the change is made in it (`ArrangerHost.editing`). Slot, Spreads toggle: `dotwork.book.spreads` for the toggle, the slot is memory only. |
| **Choose design…** (picker) | Blank, saved pages, built-in pages; for left slots with a page after them also spreads | `setSlot` / `fillSlots` on the book | On choosing. A saved page or spread that is still `Untitled…` is named first (a small window; its Library name changes). |
| **Apply to more pages…** | The design on the current page (or its facing page) | `applyDesign` over a range, or every left / right page | On Apply. |
| **Dates…** (More menu) | Book dates; the current page; today's local date only when the book has no dates | `book.dates` (and nothing else) | On **Set dates** / **Clear dates**. Details in Dates. |
| **Build book…** (the builder) | `book.recipe`, else the month of the first dated page, else today; saved + built-in sections; saved + built-in pages (for the gap page) | Only on **Generate book**: every interior page, every date, `book.recipe`. Covers are not touched. | One undo step. Cancel discards the working recipe. |
| **Save pages as a section…** | A page range of the book and its dates | Library section | On **Save section**. |
| **Flip through** | The book (read-only). Speed from `dotwork.book.flip-ms` | Speed | On slider input. |
| **Import and export** window (**Export** button) | See below | See below | See below. Opens on Export; opens on PDF in the Book view. |
| ↳ **Import** | A chosen `.json` | A page, spread or book is added as a new document named from the file (` 2` if taken) and opened, after the open one is written; a section is added to the Library (nothing opens). Nothing is replaced. A library backup is refused with a pointer to Restore backup. Version-1 pages are converted. | Immediately. |
| ↳ **Export** | The open page / spread / book **at the moment Download is pressed** (`jsonToExport()` in `main.ts` runs again on click), whether or not the 400 ms write has happened | A `.json` download. Before the first export (JSON, or the print zip on the PDF tab) of a page, spread or book that is still `Untitled…`, a small window asks for a name (leaving the field empty keeps it; cancelling cancels the export). | On Download. |
| ↳ **PNG** | The page (or the spread being edited) | A `.png` (150 / 300 / 600 dpi), with the same name question. Not in the Book view. Prints with sample values: the sample date (Mon Oct 26 2026) for tokens and a sample page number "47" (`SAMPLE_DATE`, `SAMPLE_PAGE_NUMBER`); the tab says so in one line | On Download. |
| ↳ **PDF** | The book, printer profile, Library books (Bottom book) | A zip. Its fields write the printer profile (`dotwork.printer`) and the book's signatures (the open book) as they are changed | Fields: on change. Files: on Download. |
| **Calibrate** (from the PDF tab) | Book (name, page count; included as `book.json` in downloads), printer profile | The printer profile only, each time a field or a "Use" button changes it. Never the book. | Immediately; typed readings are memory only. Closing returns to the PDF tab. |
| **Help mode** | `src/help.ts` (one entry per `data-help` key, touch and desktop text) | Nothing | n/a |
| **Notices** | Problems (can't export, a page, spread or book that is not saved, a printer profile that can't be read) | Nothing | n/a |
| **Can't-keep warning** | `Keeper.keeping` | Nothing | Shown at the top for as long as the browser can't keep documents. |

Keyboard shortcuts (page and spread views only; the Book view has none except ←/→ for the page): V, A, P, S, B, R, C, T, Ctrl/Cmd+Z/Y/D, arrows, Delete, Escape.

## 4. Dates end to end

**Where a date can come from.** A date is a `YYYY-MM-DD` string. There are six sources:

1. **Dates… window** (`arranger.ts` `openDates` / `renderDates`, math in `plan.ts`). *Each page is one week*: you give a year and a week number; every page in the range gets a Sunday, seven days apart (`weekStart`). *Each page is one day*: you give a start date; pages are consecutive days. The range is "From page – To page", prefilled with the current page to the end of the run of pages that share its design.
2. **Book builder** (`build.ts` `planSteps` / `applyBuild`). For each step, each repeat's first date plus the section's `days[i]` for page *i*. Where the first date comes from depends on the step (below). Replaces every interior page's date.
3. **Library book / template / import:** a book arrives with its `dates` as stored. Templates (`templates.ts`) compute literal dates from year/month (or year/first week).
4. **Defaults used when nothing else is known:** `todayIso()` (local date, never UTC) starts the Dates window for a book with no dates and is the builder's month for a book with no recipe and no dates; hard-coded `2026-01` / week 1 in the Dates window and a `2026-01` recipe are overwritten the moment either window opens (`arranger.ts` lines 102 and 113, 528–540, 662).
5. **The sample date** `2026-10-26` (`SAMPLE_DATE`): not a book date; it is what every editor view, Library thumbnail, PNG, and the Page view's Preview show tokens as.
6. Nothing else. There is no "date of the book" and no setting that moves all dates at once.

**Where it is stored.** `book.dates[]`, one entry per interior page (`null` = undated), absent when no page has one. Covers have no date. `book.recipe.month` and each step's `start` / `repeat.month` are separate stored values the builder reads next time; they are *not* kept in step with `dates` (see Things that disagree).

**How tokens read it.** `{weekday} {month} {monthname} {day} {year} {week} {months}` (`src/format/tokens.ts`, `dates.ts`). Every print/preview path calls `expandFor(dateOf(book, slot))`: a dated page fills its tokens from its date; an undated page and every cover print them **blank** (`blankTokens`), so they can be written in by hand. The editor, Library thumbnails and PNGs use the sample date instead. Weeks run Sunday–Saturday and week 1 holds January 1.

**What an offset means.** `{name+N}` / `{name-N}` shifts the **date by N days**, then reads the token. It is a *day* offset for every token: `{day+1}` is tomorrow's day number, and **`{month+1}` is the month of tomorrow**, not next month (so it equals `{month}` except on the last day of a month). `{month+6}` in the built-in weekly reflection (`WEEK {week}  {month} {day}-{month+6} {day+6}`) works because the week's last day is six days on. There is no month offset. `{months}` is a separate token: the month, or "NOV / DEC" when the 7 days from the date reach the next month. A page "stands for a day" (`pageSpan`) if it uses `{weekday}` or `{day}` with only 0 offsets and no `{months}`; otherwise it stands for a week. That decides what the builder drops (`only_in_month`) and what **Save as section** guesses.

**What happens when…**

- **Pages move.** There is no UI to move or swap pages (`movePage` / `swapPages` in `book.ts` are exercised only by tests). **Apply to more pages** and **Choose design** replace the design in a slot; the slot keeps its date, unless the new design uses no date tokens, in which case the date is cleared (`setSlot`). A date is never added by choosing a design.
- **The book is resized** (Settings → Pages): `pages` and `dates` are cut or padded with `null`; the recipe is untouched, even though it was built for another page count (the next **Generate** uses the new count).
- **Rebuild** (Generate book): every interior page and date is replaced; covers are not touched; `book.recipe` is replaced by the window's recipe (its month, gap, steps).
- **A step is repeated:**
  - *Each week of a month* (`weeks`): the first repeat starts on the section's `weekday` on or before the 1st of the step's month (else the recipe's month); each next repeat is exactly 7 days later until a start passes the month's last day. The section's `move` is **ignored**. With "only days in the month" day pages dated outside the month are left out (week pages are kept).
  - *A number of times* (`times`) and *Fill what's left* (`fill`): the first repeat starts on the step's `start`, else the 1st of the **recipe's** month. Repeat *k* moves by the **section's** `move`: `none` repeats the same dates every time, `day` +k days, `week` +7k days, `month` +k calendar months (day of month kept, clamped).
  - Each repeat starts on the side of the spine the section started on; a gap page is inserted otherwise.
- **A section is saved from the book** (`sectionFrom`): dates become `days` relative to the first dated page; `weekday` is that page's weekday; `move` is the window's choice, prefilled by `guessMove` (any run with more than one distinct date is guessed as `week`, whatever the spacing); a run with no dates is saved with `move: none`.
- **Imported:** `readBook` checks `dates` has `page_count` entries, each a real day or `null`. The recipe is checked for shape only (month format, repeat kinds, at most one `fill`); nothing checks that `recipe.month` agrees with `dates`.
- **Library "Open" of a book, or a template:** the book's dates are copied as they are.

### The owner's monthly log book (`tests/fixtures/monthly-log-book.json`)

What the file holds: a 52-page book with `dates`, and a `recipe` of **one step**: `{ repeat: fill, no start }` of a section "Week Log"
(11 pages, `days` = `[null, 0, null, 14, 21, 28, 35, 42, 49, null, null]`, `weekday` 1, `move` `none`, starts on a right page), `recipe.month`
`2027-11`, no gap page. `tests/monthly-log-book.test.ts` pins the findings below.

1. **Why the month is 2027-11.** The recipe's month and the section's dates both start at 2027-11-01, a Monday (the section's `weekday` is 1), and every dated page in the book is in 2027-11 or 2027-12. So the book was dated from 2027-11-01 before the section was saved from it, and the builder then offered, and kept, 2027-11 as `recipe.month` (a book with dates opens the builder on its first dated page's month, `arranger.ts:662`; one with a recipe keeps the recipe's). The file cannot say *how* 2027 was chosen in the first place. A Monday start means the Dates window's *one day* mode, with a start date typed or picked, or a builder date field; its *week* mode only produces Sundays. Which year was typed or picked is **(unsure)**: nothing in the code supplies 2027 (the defaults are the clock, and 2026 in the window's unused initial state).
2. **Why the daily pages are a week apart.** The section was saved from pages dated 14, 21, 28, 35, 42 and 49 days after the first dated page: seven days apart, one daily page per week. That is what the Dates window's *Each page is one week* mode gives a run of daily pages (it is the mode the window opens in, §4 above), and the book's own pages show the same thing (pages 4–9: Nov 15, 22, 29, Dec 6, 13, 20). Page 2 is dated 0 and page 3 is not dated at all, so the run was dated in pieces (why page 3 has no date is **(unsure)**).
3. **Why every week section has the same dates.** The step is *Fill what's left* with no `start`, on a section whose `move` is `none`. A fill repeat starts on `start`, else the 1st of `recipe.month`, and repeat *k* moves by the section's `move`, which is `none`: so each of the four repeats (pages 1–12, 13–24, 25–36, 37–48; each is 11 pages plus a Notes gap page to keep the next repeat on a right page) is dated 2027-11-01, 11-15, 11-22 … identically. (`weeks` would have spaced them out; so would `move: week`.)
4. **Extra: the last four pages were edited by hand.** Rebuilding from this recipe would leave pages 49–52 blank (the plan fills four 12-page repeats), but the book has a tracker, two daily pages and a "Patterns & takeaways" page there. The recipe describes pages 1–48, not the book.

## 5. Saving and export

- **Autosave.** The open page, spread and book are Library entries and every committed change is written to them, 400 ms after the last change and at once when the tab is hidden or closed (`DocSession` / `Autosave` in `src/documents.ts`). There is no Save button and no unsaved state; the mark beside the name says **Saved** only after a write that worked and nothing has changed since, and **Not saved** with Retry (and the browser's real error, with Copy details) when a write fails. Switching documents writes the current one first and does not switch if that fails. If the browser can't keep documents at all (no IndexedDB, private mode, or a first write that fails) the warning at the top says so, the app works from memory and the mark says Not saved. An Untitled page, spread or book that was never drawn on is deleted when another document is opened or the tab is closed; named or edited documents are never deleted by the app.
- **No explicit save.** Nothing is saved by hand; **Save pages as a section** is the one thing that adds a Library entry on request, always as a new section (a taken name gets ` 2`, nothing is replaced). Names are trimmed; an empty name becomes `Untitled`.
- **Opening.** A page, spread or book from the Library, or an import, switches to that document; nothing is replaced (the one open was written first, and is in the Library). A built-in opens read-only, and so does a book made from a template. **New** makes a page, spread or book (whichever view you are in) named Untitled (`Untitled 2`… if taken); on one that is still empty it does nothing.
- **Export JSON** (Export tab) exports the live object for the current view: the open page, the open spread (built from the two Stores and the document's name), or the open book (`arranger.current`, carrying the document's name), checked against the format first. It is the document as it is on screen now, not the file that was opened; `tests/e2e/navigation.e2e.ts` ("Export saves the book as it is now…") and `tests/e2e/documents.e2e.ts` pin that. It exports the **view you are in**: in Page view you get the page even if a book is open in the background.
- **Built-ins vs copies.** Built-in pages, spreads, sections, widgets, art and templates are code or `examples/` files and cannot be changed or overwritten. A built-in page or spread opens read-only; so does a book built from a template. Changing anything, or **Edit a copy**, asks for a name (prefilled `<name> copy`), creates a document and carries on in it with the change that was attempted; Library **Duplicate** asks the same, for books and sections too. Built-in names count as taken, so a saved page or spread gets ` 2` added rather than being refused.
- **Names.** Defaults: page, spread and book `Untitled` (`Untitled 2`…; the pages inside a spread are `Left page` / `Right page`); a section saved from a book is named in the Save window (`Pages 3–10` if left empty). A name already used in its kind gets ` 2` added. File names come from the name via `slug` (fallback `page`, `spread`, `book`): `untitled.json`, `untitled-print.zip`. Every document has one copy of its name (the entry's); the file gets it when exported.
- **On reload.** The open page, spread and book (`dotwork.open`),
- **Printing a book** uses the book as it is and the printer profile as it is at that moment; the zip's `book.json` is that same object, `summary.txt` the same settings.

## 6. Covers

The book has four cover pages: **inside front** (left page, `cover.front`), **inside back** (right page, `cover.back`), **outside front** (right, `cover.outside_front`), **outside back** (left, `cover.outside_back`). They are ordinary pages: no page number, no date, tokens print blank.

- **Generated:** only by a **book template**, and only the two *inside* covers: the monthly journal gets a tracker cover for the month and a page index (`monthlyTracker`, `monthlyPageIndex`); the year planner a goals cover and a year index; plain books a purpose cover and a plain index. These are built from the answers (year, month) as **literal text and drawings**, not tokens, and are never touched again by **Build book** (which replaces interior pages only) or by changing a date. The outside covers are never generated.
- **Typed or chosen in:** everything else. The outside covers, and any inside cover you want different, are chosen with **Choose design…** after stepping to the cover with ‹ / › (the outside front cover comes before the inside front cover, the outside back after the inside back), or drawn in the editor and saved to the Library first. **Apply to more pages** never reaches a cover (`scopeSlots`, `plan.ts:6`); a spread chosen on the first left slot can fill the inside front cover and page 1 (`fillSlots` allows slots 0 to page_count+1).
- **Printed:** `cover-outside.pdf` (outside back | outside front, first pass) and `cover-inside.pdf` (inside front | inside back, second pass), single-sided, with the cover fore-edge shift. Missing outside covers print blank.

## 7. Things that disagree: inconsistencies, duplication, dead code, stale docs

**Behaviour that contradicts itself or its own words**

1. **Recipe month vs. dates.** `openBuild` prefers `book.recipe.month` over the dates on the pages (`arranger.ts:662`); the Dates window and any later change never update the recipe. Nothing reports the mismatch. The month a book "is" is stored in two places.
2. **A newly added step has no `start`.** `arranger.ts:795` adds `times ×1`; all such steps start on the same day (a second way to get the owner's finding 3).
3. **Dates window defaults to weeks.** `arranger.ts:113` and `:530`; daily pages get a week apart on first use (example 2).
4. **`weeks` ignores `move`; `times` and `fill` honour it.** The section list says "dates a week later" for a section, which describes only the `times`/`fill` behaviour.
5. **`guessMove` guesses `week` for any run with two or more distinct dates** (e.g. 30 daily pages in November), where `month` would be the repeat people mean (`build.ts:44`).
6. ~~"New" help says Undo brings the old one back~~: fixed in phases 1 and 2 (New keeps the old document in the Library).
7. ~~Open / Import of a book replaces the draft with no confirm and no undo~~: fixed in phase 2 (books are added and opened like pages and spreads).
8. **PNG shows sample values**: sample date 2026-10-26 and page number "47" (`png.ts` → `render.ts` defaults), unlike every PDF path, which fills from the book. A PNG of a dated book page is not what prints.
9. **"Back up library" leaves out widgets, art and favorites**, although the Library window lists them on tabs (`library.ts` `exportAll`, `widgets.ts`, `favorites.ts`).
10. **Widgets and art are in `localStorage`**, the Library's pages and books in IndexedDB: two stores, two failure modes (a large imported SVG can hit the localStorage quota; the failure is silent, "last for this visit", `widgets.ts:changed`).
11. ~~IndexedDB missing → memory backend, silently~~: fixed in phase 2 (the warning at the top says so, and the mark never says Saved).
12. ~~Per-page "Untitled" collision~~: fixed in phase 1 (Untitled, Untitled 2…; a taken name gets ` 2`).
13. **Template defaults read the clock once at load** (`templates.ts:55`: `new Date().getFullYear()` and `getMonth()`), while built-in sample pages are fixed to 2026-10 (`builtin/library.ts:25`) and the editor's token sample is fixed to 2026-10-26 (`tokens.ts:8`).
14. **Template books hold literal text** where the builder's books hold tokens (a reflection's identity `WEEK 44  OCT 26-31` vs `WEEK {week}  {month} {day}-{month+6} {day+6}`); a template book cannot be re-dated.

**Dead code (nothing in the app uses it)**

- `swapPages`, `movePage`, `carry` (`book.ts:174–190`): tested, but there is no way to move or swap pages in the UI, so the "dates travel with their page" rule in the docs has no user-visible path.
- `findBuiltinSection` (`builtin/sections.ts:48`), `monthSpan` (`builtin/calendar.ts:34`): unused, not tested.
- Exported but used only by tests: `markZone` (`book/alignment.ts`), `backPoint`, `backRegion` (`print/sheets.ts`), `calibrationPages` (`print/calibrate.ts`), `moveElement` (`geometry.ts`), `itemValue` (`format/sequence.ts`), `TRIM_ZONE_MM` (`book/impose.ts`), `SAMPLE_DATE` outside `tokens.ts`.
- `fresh` in `LibraryHost.openBook(book, fresh?)` (`library/dialog.ts:40–41`, passed at `:272`): `main.ts openBook(next)` ignores it. Its doc ("takes the printer's saved print settings") is from before the printer profile.
- Version-1 page support: `format/v1.ts`, `validate-v1.ts`, `convert.ts`, and the `converted` flags through `readBook` / `readSpread` / the notices in `main.ts:540–557`. `CLAUDE.md` says not to add conversions; these predate it and are still wired in.
- Old-book tolerance: `readBook` ignores everything but `signatures` inside `print` (`book.ts:216`) so books from before the printer profile still open; `readPrinter` fills in `back_rotation_deg` and `line_weight_x_pct` for older profiles (`printer.ts:41–49`). Both are migrations under another name.

**Duplication**

- `isObject` is defined in seven files (`book/book.ts`, `book/sections.ts`, `library/library.ts`, `format/spread.ts`, `format/validate.ts`, `format/validate-v1.ts`, `format/art.ts`).
- `daysBetween`: `build.ts:15` and `plan.ts:136`, identical.
- "Today as a local `YYYY-MM-DD`": `dates.ts` `todayIso` and `print/settingstext.ts` `isoDay`.
- Month and weekday name tables: `dates.ts` (`MONTHS`, `MONTH_NAMES`, `WEEKDAYS`) and `builtin/calendar.ts` (`MONTH_ABBR`, `MONTH_NAMES`, `WEEKDAY_ABBR`).
- "A page from examples/pages, or the notes page": `example()` in both `builtin/templates.ts` and `builtin/sections.ts`.
- The `try { return localStorage } catch` wrapper is written out three times in `main.ts` (`:46`, `:90`, `:599`); `stored()` is in `main.ts:44` and `arranger.ts:39`.
- Two undo systems: `Store` (200 steps, coalescing, per page) and `Arranger` (30 JSON snapshots, whole book). The top-bar Undo is hidden in the Book view, which has its own button.
- A name lives twice in each Library *book and section* (`item.name`, `item.data.name`). (A page or spread keeps it once, in the entry, since phase 1.)

**Stale docs and help text**

- `docs/book-format.md:20–22` shows `"recipe": { "month", "weekday", "section" }`, the shape before steps; the **Recipe** section below it is right.
- `docs/book-format.md` lists the two-up defaults as front -0.75 / -1.6 and back 0 / 1.1; `DEFAULT_PRINT` (`book/impose.ts`) is front -0.25 / -1.55 and back -0.4 / 1, scale y 101.01, rotation -0.183.
- `docs/book-format.md` says dates "travel with their page: moving or swapping pages moves their dates": no UI moves pages.
- `docs/library-format.md:3–4` says **Export library** / **Import library**; the buttons are **Back up library** / **Restore backup**. It also says version-1 pages are converted.
- `help.ts` entries `book-export` and `book-cover-shift` say `cover.pdf`; the files are `cover-outside.pdf` and `cover-inside.pdf`. `impose.ts:75` comment says the same.
- `CLAUDE.md` roadmap item 15 still names **Build by week**, which is now only a preset (`builtin/sections.ts:34`).
- No doc lists the `localStorage` keys; §2 here is the only list.

## 8. Open questions

1. In the Monthly Log Book, which action chose the year 2027 (finding 1)? Nothing in the code does, so it was typed or picked.
2. Should the recipe's month follow the dates (or the dates the recipe), and should a new step start where the previous one ended instead of on the 1st?
3. Should Dates open in *one day* mode unless the current page is a week page?
4. Should PNG fill tokens and the page number like the PDFs, or stay a sample?
5. Should "Back up library" also carry widgets, art and favorites?
6. Is there meant to be a way to move or swap pages in the Book view (the code and docs assume one)?
