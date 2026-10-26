# Dotwork product model: how the app should work

This is the target. [product-map.md](product-map.md) says how the app works at commit `4366849`; this says how it should. Nothing
here is built yet. The printer, calibration and the page and spread drawing tools stay as they are (the editor, Advanced, layers,
properties, the print pipeline, creep, imposition and the PDFs): this model changes where things are kept, how they are saved,
how a book is put together and dated, and how pages are linked to their designs.

Each decision has a **Why** and what it **Replaces** in the map (`map §n` is a section of the map; `map §7.n` is item *n* of its
list of things that disagree). Section 10 puts the decisions in order, section 11 is the database that comes after, section 12 answers the PR #29 questions
and section 13 lists what I still need from the owner.

## 1. Two kinds of book, one tool

**D1. A book is undated or dated, and both are built the same way.**
- An **undated book** is for ideas, art, writing: a stack of designs with no calendar. Its pages print their date tokens blank.
- A **dated book** has a calendar and holds everything tracked in a stretch of time: for example one book per month, 52 pages
  plus covers.

The same outline (section 4) builds both. The only difference is that a dated book has a calendar, so its blocks can repeat "each day /
week / month of the calendar" and its pages can print dates. Take the calendar away and the same book is an undated one.

**Why.** The map has two ways to make a book (hand-placing pages, or a builder with a recipe), two ways to date it (the Dates window,
the builder) and book templates that write literal text. One tool for both means one thing to learn and one thing to keep correct.

**Replaces.** Hand-placed pages, the Build book window, its recipe and the Dates window as separate things (map §3, §4); templates that
write literal dates (map §7.14).

## 2. Three areas, one Library

**D2. The app has three areas: Design, Plan and Print. They share one Library.** A segmented control in the top bar switches
between them (three buttons, 44 px high, fits 390 px). The Library is one place that holds every document; each area opens it on its
own tabs, and a search box searches all of it.

| Area | Is for | Documents it opens | Screens |
|---|---|---|---|
| **Design** | Drawing one page or one spread | Pages, spreads, widgets, art | Page view, Spread view, tool bar, Advanced, properties and layers, page/spread Settings, Library tabs Pages, Spreads, Widgets, Art |
| **Plan** | Putting designs into a book and dating it | Books, sections | The outline, Choose design, Calendar, Updates, Versions, Flip through, book Settings, Library tabs Books, Sections |
| **Print** | Getting a book onto paper | The open book (it opens nothing itself) | Print (what is now the PDF tab), Printer (the profile), Calibrate |

- **Widgets and art belong to Design.** They are drawn and saved there and placed from Advanced.
- **Sections belong to Plan.** A section is a group of blocks (D9), so it opens in the same outline editor as a book, without a calendar.
- **The Export window stays** (Import, Export JSON, PNG), reachable from the **Export** button in every area. Its PDF tab goes away: the
  same fields and the Download live on the Print screen, because they are the printer's. The Export button on a book offers "Print…".
- **The printer profile stays one profile in `localStorage`** (`dotwork.printer`), not a Library document: it belongs to a printer, not to a
  design, and a book must open the same everywhere.
- **Settings** is per area: the name and the page options in Design, the book options (name, pages, page numbers, signatures,
  calendar) in Plan.

**Why.** The map's top bar mixes three jobs (Page, Spread and Book are three views of one menu; the PDF tab hides the printer inside an
export window). Three areas match what the owner does in order: draw, assemble, print.

**Replaces.** The **Page ▾** menu as the way to move between Page, Spread and Book; Calibrate being reachable only from the PDF tab (map §3).

## 3. Documents

**D3. Everything in the Library is a document, and a document autosaves while you edit it.** Pages, spreads, sections, books, widgets
and art are all documents in one IndexedDB store. There are no drafts: what you are editing *is* the Library document, and every
committed change is written to it (after a 400 ms pause, and when the tab is hidden or closed). A small "Saved" mark beside the name says
so; "Not saved" with a retry appears if a write fails. There is no Save button and no unsaved-changes state.

**D4. Names.** A new document starts as `Untitled` (`Untitled 2`, `Untitled 3`... if taken), and beside its name a visible chip says
**Untitled: name it**; tapping it renames in place. The app asks for a real name, in a small dialog, before the first **export**, before
the document is **placed in a book**, and before it is **saved as a section**. A name that is already used in its kind gets ` 2`
added instead of being refused. There is one copy of the name (not one in the Library item and another inside the data); the file gets
it when exported. Nothing is ever saved over anything, so there is no replace confirm.

**D5. Built-ins are read-only; editing makes a named copy.** A built-in opens with a quiet bar: "Built-in. Editing makes a copy." Trying
to change anything (or pressing **Edit a copy**) asks for a name, prefilled with `<name> copy`, creates the document and carries on in it.
The Library's **Duplicate** does the same from the list.

**D6. Opening never replaces anything; Export exports the open document; Import adds.** Opening another document (from the Library, a
template, an import, a link) writes the current one first and switches. The app remembers the open document (`dotwork.open`) and comes
back to it on reload. **Export JSON** writes the open document as it is at that moment, in whatever area you are in. PNG is offered for pages
and spreads, PDFs for books. **Import** makes a new document named from the file and opens it. Restoring a backup adds every document
that is not already there (same id and content: skipped; same id, different content: added as `<name> restored`); nothing is replaced.
A PNG is what is on screen: a page has no date or number of its own, so it shows the sample (Mon 26 Oct 2026, page 47) and the PNG tab says so
in one line. Undo stays in memory for the open document.

**D7. If the browser cannot keep documents** (no IndexedDB, private mode), the app says so at the top, in words, and keeps working from
memory with Export prominent. It never looks like it saved when it did not.

**D8. What happens to today's data.** No adoption code and no conversions.
- **Before phase 1 the owner exports anything open** (the page, the spread, the book) as JSON. The drafts (`dotwork.page`,
  `dotwork.spread.*`, `dotwork.book`) are then not read any more; the app starts on an empty document.
- **The existing Library entries stay.** They are already `{ id, kind, name, updated, data }` in the one IndexedDB store, and pages and
  spreads do not change format, so they simply keep working. `data.name` is dropped the next time an entry is written.
- **Sections and books** keep their stored shape until phase 5 changes the book format. After it, an old-format section or book is listed in
  the Library as "Old format" with Export and Delete, and cannot be opened. The owner's page designs are the work that matters and they
  survive; the books are built again from the outline (a few minutes each, which phase 6 makes quick).
- **Widgets and art** (`dotwork.widgets`, in `localStorage`) are not carried into the new store either. Before phase 3 the owner places any
  widget or art worth keeping on a page saved in the Library (it keeps its elements) and re-saves it as a widget afterwards. Art can
  also be imported again from its SVG file.
- **Favorites** (`dotwork.favorites`) start again; they are a tap each.

**Why.** The map has two parallel ways to keep work (a draft per view, and explicit Library saves) and no link between them: edits to
a page never reach its saved copy, `Untitled` collides, the book draft is replaced by Open without a word, and nothing says whether
anything is saved. One open document that saves itself removes all of that and makes "Export what I am looking at" true. Pre-release,
nothing is worth a migration.

**Replaces.** Drafts and the `Save page / spread / left / right / book` buttons; "Save a copy" as the way to save; the replace-on-save
confirm; `Untitled` collisions (map §7.12); Open/Import replacing a draft silently (map §7.7); the false "Undo brings the old one back"
help text for New (map §7.6); the memory fallback hidden from the user (map §7.11); widgets in a second store (map §7.10); the name stored twice.

## 4. A book is an outline

**D9. A book is an outline: an ordered list of blocks, edited like the layers panel.** A **block** is a **page**, a **spread**, or a
**group** of blocks, and every block has a **repeat**:

| Repeat | Means |
|---|---|
| **×N** (a number of times) | N copies, one after another. The default is ×1. |
| **each day / week / month of the calendar** | One copy for each day, week or month of the book's calendar, in order. A dated book only. |
| **each day / week of the group's span** | Inside a group that repeats per week or per month: one copy for each day (or week) of the span that repeat covers. |
| **fill what's left** | As many copies as use up the pages the other blocks leave, so the book keeps its page count. At most one in a book. |

A group's children are blocks too, so a group can hold groups. A group saved to the Library becomes a **section**: the section *is* the
group, with its children and their repeats, but not its own outer repeat (that belongs to where it is placed). Placing a section in a book
adds a group.

**D10. The outline is edited like the layers panel.** One row per block: a **thumbnail** (the page, the spread, or the group's first page), the
name, its **repeat**, **pages used** and the **dates it covers**, as in `×5 · 10 pages · Nov 1 – Dec 5`. A group's row can be **collapsed**
to that line. Rows can be **dragged** to reorder or into and out of groups, and every row has **Up / Down** buttons (44 px) for touch; the row
menu also has **Duplicate**, **Group** and **Ungroup** (acts on the selected rows), **Delete**, **Repeat…** and **Save as section…** (groups
only). Arrow keys and drag are desktop shortcuts, not the only way. Moving a block never changes its dates (D13). Selecting a row shows the
page, the spread or the group's pages large above the outline, so the page still gets most of the screen; on a phone the outline is a sheet
that slides up over it.

**D11. The outline always shows the count and the gaps.** A line at the top reads `48 of 52 pages`, live. When the blocks need more pages
than the book has it turns red, says by how many, and offers **Make the book N pages** (the next multiple of 4 that fits). **Spreads start
on a left page**: where one would land on a right page the app inserts a **gap page**, shown in the outline as a dim row ("Gap page:
keeps the spread facing") so nothing is hidden; gap pages count in the total. Blank pages are blocks like any other (Blank ×3).

**D12. Undated books are just outlines with no calendar.** The "each day / week / month" repeats are greyed out with "Set a calendar", **fill
what's left** and **×N** work, every date token prints blank (as today), and page numbers, covers, imposition and export are untouched.

**Why.** Sections-as-runs, parts, steps and a recipe all say the same thing in different words, and each has its own window. An outline
is one list that reads top to bottom like the book, can be changed by dragging, shows what it costs in pages, and is something people already
understand from the layers panel. Fill what's left is what lets the same outline fit a 28-day month and a 31-day month.

**Replaces.** Sections as runs with `days` / `weekday` / `move`, the recipe and its steps (`times` / `weeks` / `fill`), the Build book window, the
Dates window, "Apply to more pages…" as the way to repeat a design (it becomes ×N and Duplicate), `swapPages` / `movePage` with no UI
(map §7), the Contents list (the outline is the contents), and a book file that stored every page and every date (map §2, §4).

**The book file** (the shape, to be written into `docs/book-format.md` in phase 5): the book keeps `name`, `page_count`, `page_numbers`,
`print.signatures`, the four `cover` pages and an `outline`; it no longer stores `pages`, `dates` or `recipe`. The printed pages and their
dates are worked out from the outline by one function, so the file is the design, as the working rules say.

```json
"calendar": { "start": "2026-11-01", "end": "2026-11-30", "week_starts": 0 },
"outline": [
  { "type": "group", "name": "Week", "repeat": { "each": "week" }, "leave_out": [3, 4, 5, 6],
    "from": { "id": "…", "fingerprint": "…" },
    "children": [
      { "type": "page", "page": { "...": "a dotwork-page, full copy" }, "from": { "id": "…", "fingerprint": "…" }, "repeat": { "times": 1 } },
      { "type": "page", "page": { "...": "…" }, "repeat": { "each": "day", "of": "span" } }
    ] },
  { "type": "page", "page": { "...": "…" }, "repeat": { "fill": true } }
]
```

## 5. Dates

**D13. Dates come from each block's own repeat, never from where it sits.** The calendar is `start`, `end` (two real days) and
`week_starts` (Sunday, 0, by default; settable). It is chosen in Plan → Settings → **Calendar**: a month, a number of months from a
month, or from and to; the picker opens on next month as a suggestion and nothing is set until Set is tapped. The calendar has
**days** (every day from start to end), **weeks** (every week, by the week start, that touches the range; numbered 1..n *in the calendar*) and
**months** (every month that touches it).

- **Each week of the calendar** is weeks 1..n of the calendar, wherever the block sits in the outline. Likewise each day and each month.
- **A group that repeats per week** (or per month) gives each repeat a **span**: week *k*'s seven days, or that month. Its children read that
  span. A child that repeats **each day of the span** makes one page for each day of the span *that is inside the calendar*, so the
  first and last week of a month that starts mid-week make fewer day pages.
- **What a page reads.** A block with its own repeat reads that unit: a day, a week or a month. A block with a plain ×N inside a spanning
  group reads the group's span (the tracker and the reflection in a week group read the week). A block with ×N or fill outside any span is
  undated.
- **A week page covers the whole week**, even where part of it is outside the calendar, so its tokens read the full week. A month page
  reads its month. A day page exists only for a day inside the calendar.
- **Spreads.** By default a spread whose repeat is **each day** gives each of its two pages its own day, so it covers **two days per
  repeat** (left page day *d*, right page day *d*+1, the next repeat starts at *d*+2). With **each week** or **each month** the two
  pages share the one week or month (a weekly planner spread covers one week). A spread has a small setting, **Pages: one each / shared**,
  to change either default.
- **Month lengths** (28 to 31 days, four weeks or five) are handled by the repeats; **fill what's left** keeps the page count.
- **Gap pages and blank blocks are undated.** A block whose unit has nothing left (the calendar is shorter than the outline expects) is shown
  as "outside the calendar" and prints undated; the outline says how many pages that is.

**D14. Short repeats.** When the calendar ends inside a repeat of a group (the last week of a month that ends mid-week), the group's
**Leave out in a short last repeat** list, a tick per child and empty by default, says which children are not placed in that one repeat. A
first repeat that starts before the calendar loses only its day pages outside it and keeps everything else.

**D15. Tokens count in the token's own unit, and `@end` reads the end of what the page covers.**
- `{day+1}` is the next day, `{weekday+1}` the next weekday, **`{week+1}` the next week**, **`{month+1}` the next month**, **`{year+1}` the
  next year**. (The map's rule that every offset is in days, so `{month+1}` was "the month of tomorrow", goes.)
- A **week page** reads its week: `{weekday}`, `{day}`, `{month}`, `{year}` are the week's first day, `{week}` its number, `{day+6}` its last
  day. A **day page** reads its day. A **month page** reads the 1st. Weeks are numbered from the week that holds 1 January, counted from the
  book's week start (as written in `page-format.md`).
- **`@end`**: any token can end in `@end` to read the **last day** of what the page covers: a week page its last day, a month page the last day of
  the month, a day page its own day, a cover the calendar's last day. `{month} {day} – {month@end} {day@end}` on the week of 29 Nov 2026 prints
  `NOV 29 – DEC 5`. `@end` takes no offset.
- The built-in Weekly reflection becomes `WEEK {week}  {month} {day}-{month@end} {day@end}` (its old `{month+6}` would now mean six months
  on). Covers use it for ranges: `{monthname} – {monthname@end} {year@end}`. `{months}` ("NOV" or "NOV / DEC") stays as it is.
- In the editor, tokens still show the sample date (Mon 26 Oct 2026). Undated pages and covers of an undated book print them blank.

**D16. Covers read the book.** A cover reads the calendar as a month page for its first month (`{monthname}`, `{year}`) and `@end` reads the
calendar's last day. Covers can also hold two generated pieces from the book, drawn at print time: a **Page index** (one line per top-level
block with its dates and first page) and a **Month tracker** (one row per day of the first month). They need one new element type in the
page format, `generated`. In the editor they show sample rows.

**Why.** The map's dates were stored in three places (the Dates window, the builder, a template), the recipe's month could disagree with
them, the Dates window defaulted to weeks so daily pages ended up a week apart, and the owner's own book had a hole and a hand-edited
tail. Dates that come from each block's repeat cannot disagree, cannot be lost by dragging a row, and re-dating a book is changing the
calendar.

**Replaces.** `book.dates[]`, `recipe.month`, the section's `days` / `weekday` / `move`, the recipe's `start`, `only_in_month` (a day outside
the calendar is simply not made), `guessMove`, the Dates window and its defaults, the 'dates travel with their page' rule, the
all-offsets-are-days rule and `{month+6}`, covers built from literal text (map §4, §6, §7.1-§7.5).

## 6. The owner's books as outlines

The week is the one in the owner's Monthly Log Book (`tests/fixtures/monthly-log-book.json`): tracker, a daily log for each day, weekly
reflection, then Book notes setup, Book notes and Notes (12 pages; I take "notes" in the owner's shorthand to be those three). Weeks start on
Sunday. The dates here were checked by hand against the rules above.

### November 2026 (1 Nov is a Sunday, 30 Nov a Monday): 52 pages

Calendar: 1 Nov 2026 to 30 Nov 2026, week starts Sunday. The calendar's weeks are 45 (1-7 Nov), 46, 47, 48 and 49 (29 Nov-5 Dec; two of its
days are in the calendar).

| Row | Repeat | Pages | Dates | Prints |
|---|---|---|---|---|
| **Week** (group) | each week of the calendar | 51 | Nov 1 – Dec 5 | leave out in the last week: Weekly reflection, Book notes setup, Book notes, Notes |
| ↳ Tracker | ×1 | 5 | the week | the week's tracker |
| ↳ Daily log | each day of the span | 30 | Nov 1 – Nov 30 | `SUN NOV 1` … `MON NOV 30` |
| ↳ Weekly reflection | ×1 | 4 | weeks 45-48 | `WEEK 45  NOV 1-NOV 7` … `WEEK 48  NOV 22-NOV 28` |
| ↳ Book notes setup | ×1 | 4 | undated | |
| ↳ Book notes | ×1 | 4 | undated | |
| ↳ Notes | ×1 | 4 | undated | |
| **Notes** | fill what's left | 0 | undated | |
| **Month review** | ×1 | 1 | Nov 1 – Nov 30 | `NOVEMBER REVIEW` |

The outline reads **52 of 52 pages**: weeks 45-48 are 12 pages each (pages 1-48), week 49 is three pages (49 tracker, 50
`SUN NOV 29`, 51 `MON NOV 30`), the fill gets 0 and the review is page 52. This is the owner's current book page for page, but nothing is
dated by hand and the order of the rows does not matter to the dates.

### The same outline set to February 2027 (28 days): 52 pages

Change only the calendar to 1 Feb 2027 to 28 Feb 2027. 1 Feb is a Monday, so the weeks are 6 (31 Jan-6 Feb, six days in the calendar), 7, 8, 9
and 10 (28 Feb-6 Mar, one day in the calendar).

| Row | Repeat | Pages | Dates |
|---|---|---|---|
| **Week** (group) | each week of the calendar | 49 | Jan 31 – Mar 6 |
| ↳ Tracker | ×1 | 5 | the week |
| ↳ Daily log | each day of the span | 28 | Feb 1 – Feb 28 (week 6 has no Sunday page) |
| ↳ Weekly reflection | ×1 | 4 | weeks 6-9 |
| ↳ Book notes setup, Book notes, Notes | ×1 | 4 each | undated |
| **Notes** | fill what's left | **2** | undated |
| **Month review** | ×1 | 1 | Feb 1 – Feb 28 |

Week 6 is 11 pages, weeks 7-9 are 12, week 10 is two (the tracker and `SUN FEB 28`; the others are left out), 49 in all; the fill takes the
2 pages left, so the review is still page 52. The outline shows `52 of 52`. Nothing was re-typed.

### The alternative: planner spreads, then dailies, then reflections (November 2026)

| Row | Repeat | Pages | Starts | Dates |
|---|---|---|---|---|
| (gap page) | | 1 | p.1 | keeps the first spread on a left page |
| **Weekly planner** (spread) | each week of the calendar | 10 (5 spreads) | p.2 | weeks 45-49 (Nov 1 – Dec 5), one week per spread |
| **Daily log** | each day of the calendar | 30 | p.12 | `SUN NOV 1` … `MON NOV 30` |
| **Weekly reflection** | each week of the calendar | 5 | p.42 | `WEEK 45  NOV 1-NOV 7` … `WEEK 49  NOV 29-DEC 5` |
| **Notes** | fill what's left | 5 | p.47 | undated |
| **Month review** | ×1 | 1 | p.52 | Nov 1 – Nov 30 |

Every date is the same as in the first outline (the same day pages, the same weeks); only the order of the book differs, and the reflection for
week 49 covers its whole week because a week page does. Dragging the Daily log row above the planner would not change any date.

## 7. Links between designs and books

**D17. A page placed in a book is a full copy plus a link to the original design.** Every block embeds its page (or spread), so a book file
is the whole book and prints with no Library. Each also carries `from`: the original design's id and a **fingerprint** of that design as it
was placed. A page placed *from a section or a spread* links to **the original design behind it** (the page design the section's page was
copied from; the spread for a spread's halves, with which half), carried through, so a design change reaches every book directly. A
section also links its own pages (so a section has its own update line, like a book), and a group placed from a section links to the
section. Built-ins are linked by name and their content in the app.

**D18. The fingerprint** is a short hash of the page's `identity`, `grid` and `elements`, in the order stored. It leaves out the name,
`side` and `page_number`, because placing a page turns those to fit the slot. The same function describes the design now and the copy in the
book, so it answers both questions: *has the design changed since?* (its fingerprint now is not the one in the link) and *was the page
edited by hand in the book?* (the copy's fingerprint is not the one in the link).

**D19. Opening a book checks the links** and, if any need attention, shows one line at the top: "4 pages use designs that changed". **Check
for updates** in Plan does the same. Tapping it opens a list (thumbnail, where it is in the outline, design name, a mark if the copy was edited
by hand, a mark if the design was deleted) with:
- **Update this book**: replaces each listed block's page with the design as it is now, turned to its slot, after taking a **snapshot** (D22).
  Blocks edited by hand are not included unless ticked; the list says "edited here" next to them first.
- **Choose**: a tick per row, then **Update ticked** (also after a snapshot).
- **Make an updated copy**: a new book `<name> updated` with the updates applied, the original untouched.
- **Keep**: leaves the blocks and stores the design's current fingerprint in their links, so the line goes away until the design changes
  again. A deleted design is cleared this way too (the page stays as a plain copy).

If a group's section changed, its children are replaced by the section's first, then the design updates are applied on top.

**D20. Editing a page that sits in a book.** The row's menu has **Edit here** (the editor opens on the block's copy; Back returns to the
outline) and **Edit the design** (opens the linked design; the book is already saved, so Back returns to it and the update line is waiting).
**Edit here changes every repeat of that block** (a page that appears 7 times is one copy). To make just one repeat different, **Split out
this page** turns the row into three: the repeats before, this one as ×1, and the repeats after; the middle one can then be edited.

**Why.** The owner redraws a page once and wants every book to follow, but wants a printed book to stay exactly as designed until he says
so. A copy plus a link gives both, keeps every book file self-contained, and carrying the link through means one design change needs no
chain of updates.

**Replaces.** "Nothing refers to anything else; everything is copied" (map §1): the rule stays for the file, with links added;
`Choose design…` and `Apply to more pages…` stop being the way to repeat (map §3).

## 8. Book versions

**D21. A book keeps snapshots.** A snapshot is a full copy of the book with a time and a reason. They are taken **automatically** before design
updates are applied, before the calendar or the page count is changed, before a template or section replaces a non-empty outline, and before a
restore; and by **Save version** in the book menu (optionally with a note). A **timeline** (Plan → Versions) lists them newest first with date
and reason. Any snapshot can be **viewed** (read-only, with a "Version from…" bar), **printed**, **copied as a new book**, or **restored**
(restoring first snapshots the current state, so it can be undone).

**D22. Limits.** The last 30 snapshots are kept per book. Snapshots taken before updates are the last to go: the oldest of other kinds is
dropped first. A snapshot is a whole copy, so nothing about it depends on the Library or on any older format; one that can no longer be read
by a later format is listed as "Old format" and is only deleted (there are no conversions). Snapshots live in the Library store as records
tied to the book's id; they are not in the book's JSON export and not in the backup (a backup of the book is itself a version).

**Why.** Updating from linked designs and changing the calendar rewrite many pages at once. "Undo" is in memory and goes with the tab. A
snapshot is the simple, honest way to take the change back, and with it no version history of designs is needed (D17 keeps only a fingerprint).

**Replaces.** The 30-snapshot in-memory undo of the arranger as the only safety net for bulk changes, and "Open book replaces the draft with
no way back" (map §7.7).

## 9. Built-ins and templates

The built-in **Journal week**, **Month-end
review**, **Idea spread** and **Book notes** sections become groups in the new outline, and book templates become built-in books (an outline
plus a calendar) that open read-only and make a copy when edited; a template that needs a month asks the calendar question when copied.

## 10. Phases

Each phase leaves the app working and deployable, passes the unit and e2e suites, and updates the docs it touches in place (the working rule:
no migrations, old files break). **★** marks a change to a page, book or library **file**. There are three file changes (phases 5, 6 and 10) and
one change of meaning (phase 4); the library backup gains two kinds in phase 3.

| # | Phase | What it does | What the owner can try after it |
|---|---|---|---|
| 1 | **Documents: pages and spreads** | One Library store; the open page or spread autosaves; "Saved" mark; New starts Untitled with the name-it chip and asks before export, placing and saving as a section; built-ins read-only with Edit a copy; the open document is remembered; Open and Import add documents. The old drafts are no longer read (the owner exported first). | Draw a page, close the tab, come back: it is there. Open a built-in and tap Edit a copy. |
| 2 | **Documents: books and sections** | Books and sections open and autosave the same way; Open and Import of a book make documents; Export exports the open document; the "can't keep documents" notice. The book view is otherwise unchanged. | Open two books and switch between them without losing either. Import a book twice and get two. |
| 3 | **Full backup** ★ library file | Widgets, art and favorites become documents in the store; Back up and Restore carry every document, favorite, widget and art, and never replace. | Back up, clear the browser, restore: pages, spreads, books, widgets and art are all back. |
| 4 | **Token units and `@end`** (meaning change) | `{month+1}`, `{year+1}`, `{week+1}` count in their own unit; week pages read their week; `@end`; the built-in Weekly reflection and the examples are rewritten; the editor shows the new samples. Books still store dates, so they print as before. | See `{month+1}` and `NOV 29 – DEC 5` on a week page in the editor. |
| 5 | **★ The outline (undated)** | The book becomes an outline: pages, spreads and groups; ×N and fill; drag, Up/Down, Duplicate, Group/Ungroup, Collapse, Delete; save a group as a section; thumbnails, repeat, pages and the live "N of 52 pages"; gap pages for spreads; Make the book N pages; Edit here / Split out; moving blocks. Links (`from`) are recorded but not used yet. Removes `pages`, `dates`, `recipe`, the Build, Dates and Apply windows. Old books and sections become "Old format". | Build a 52-page undated book as an outline on a phone: blank ×10, an idea spread ×6, notes to fill the rest. Drag a group around. |
| 6 | **★ The calendar and derived dates** | `calendar`, the "each day / week / month" repeats, "of the span", week start, short-repeat leave-out, spread coverage, dates on every page and in the editor's row text; the book's dates in PDFs, PNG-less previews and Flip through. Rebuilds the November book fixture as the November 2026 outline and its test. | Make the November 2026 book (52 pages), change the calendar to February 2027, and get a 52-page book with the fill absorbing the difference. Drag a row and see no date move. |
| 7 | **Links and the updates list** | `from` is used: the update line, the list (Update this book, Choose, Make an updated copy, Keep, edited-here marks), Edit here / Edit the design, sections' own update line. No file change. | Change a page design, open the book, update only the pages you pick. |
| 8 | **Book versions** | Snapshots (automatic and Save version), the timeline, view, print, copy as new book, restore. They are Library records, not part of the book file. | Update a book, then restore the version from before it. |
| 9 | **The three areas** | The Design / Plan / Print switcher, Library tabs per area, the Print screen (the PDF tab, Calibrate and Printer), settings per area, help entries. | On a phone, go draw → arrange → print without opening a menu to change views. |
| 10 | **★ Covers from the book** | The `generated` element (Page index, Month tracker); cover tokens read the calendar; the templates' covers use them. | The cover and the page index follow the calendar. |

The old code that goes away with the formats is removed in the phase that makes it unreachable: version-1 page support and its converters, the
old-book tolerance in `readBook` / `readPrinter`, `dates`, the recipe, `findBuiltinSection`, `monthSpan` and the dead helpers listed in map §7.

## 11. The database later

The database comes after the phases. It stores what the phases already keep, and adds as little as possible:
- **`documents`**: `id`, `owner`, `kind` (`page`, `spread`, `section`, `book`, `widget`, `art`), `name` (unique per owner and kind), `data` (the JSON
  of the file formats, whole), `updated`, `favorite`. Autosave is one upsert of one document; nothing needs to query inside `data`.
- **`versions`**: `id`, `book_id`, `owner`, `at`, `reason`, `note`, `data` (the whole book).
- **`settings`**: one row per owner holding the printer profile as JSON.

Everything else stays in the files. Built-ins stay in the app. Links are ids and fingerprints inside `data`, so nothing in the database knows
about them. Conflicts between devices are last-write-wins on a document's `updated`. Sharing and a page gallery are later and need nothing
else yet.

## 12. The PR #29 open questions, answered

**Q1. The recipe month against the page dates.** There is no recipe and no stored date. The calendar is the only stored time (D13).

**Q2. Where a builder step starts.** There are no steps. A block's dates come from its own repeat (each week of the calendar is weeks 1..n
wherever it sits), so there is no "start" to forget and two blocks cannot start on the same day by accident.

**Q3. The Dates window's default mode.** The window is gone. What a page reads follows from its repeat (D13): each day gives day pages, each
week week pages; a plain ×N inside a week group reads the week.

**Q4. PNG date and page number.** A PNG is the screen: the sample date and page number for a design, and the PNG tab says so (D6). The book's
`preview.png` and Flip through show the book's real dates and numbers.

**Q5. Library backup contents.** Every document (pages, spreads, sections, books, widgets, art) and the favorites. Not the built-ins, not the
printer profile (it belongs to a printer), not the snapshots (D22).

**Q6. Moving and swapping pages.** Both are the outline: drag a row or use Up / Down, and Duplicate. Dates follow the block's repeat, so moving
never changes them (D10, D13). Swapping two blocks is dragging one past the other.

## 13. Open questions for the owner

1. **The week.** I used the Monthly Log Book's 12-page week (tracker, 7 daily logs, reflection, Book notes setup, Book notes, Notes) for
   the 52 pages. The built-in Journal week is 10 pages. Is the 12-page week the one you mean by "notes"?
2. **Short repeats.** "Leave out" applies only when the calendar ends inside a repeat; a first week that starts before the calendar keeps
   everything except the day pages outside it (so February's week 6 keeps its reflection). Is that right, or should the start leave pages
   out too?
3. **Spreads and days.** A spread set to "each day" gives each page its own day (two days per repeat); set to "each week" or "each month" its
   two pages share one. A switch on the spread changes it. Is that the right default?
4. **Edit here changes every repeat** of a block, and **Split out this page** makes one different. Is that enough, or do you want to
   edit one repeat in place?
5. **Snapshots.** 30 per book, pre-update ones kept longest, not in the backup. Right?
6. **Widgets and art** are not carried over (D8): place anything you want to keep on a Library page before phase 3. Fine?
7. **A cover for one month** reads `{monthname} {year}`; the range form `{monthname} – {monthname@end} {year@end}` is for longer
   calendars. Should a one-month book's cover say the range too?
