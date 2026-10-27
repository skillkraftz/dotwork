# Dotwork product model: how the app should work

This is the target. [product-map.md](product-map.md) says how the app works now; this says how it should. The cleanup and phases 1 to 4 (section 10) are built:
pages, spreads and books are documents that save themselves (D3–D7 for them; sections are documents without an editor). Everything else here is not built yet. The printer, calibration and the page and spread drawing tools stay as they are (the editor, Advanced, layers,
properties, the print pipeline, creep, imposition and the PDFs): this model changes where things are kept, how they are saved,
how a book is put together and dated, and how pages are linked to their designs.

Each decision has a **Why** and what it **Replaces** in the map (`map §n` is a section of the map; `map §7.n` is item *n* of its
list of things that disagree). Section 10 puts the decisions in order, section 11 is the database that comes after, and section 12 answers the PR #29 questions.

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
| **Plan** | Putting designs into a book and dating it | Books, sections | The outline, Page map, Choose design, Calendar, Updates, Versions, Flip through, book Settings, Library tabs Books, Sections |
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
that is not already there (same id and content: skipped; same id, different content: added as `<name> (from backup)`); nothing is replaced or deleted.
A PNG is what is on screen: a page has no date or number of its own, so it shows the sample (Mon 26 Oct 2026, page 47) and the PNG tab says so
in one line. Undo stays in memory for the open document.

**D7. If the browser cannot keep documents** (no IndexedDB, private mode), the app says so at the top, in words, and keeps working from
memory with Export prominent. It never looks like it saved when it did not.

**D8. What happens to today's data.** No adoption code for drafts and no conversions. The one exception is a small, one-time move of widgets and art, so that nothing the owner saved is lost.
- **Before phase 1 the owner exports anything open** (the page, the spread, the book) as JSON. The drafts (`dotwork.page`,
  `dotwork.spread.*`, `dotwork.book`) are then not read any more; the app starts on an empty document.
- **The existing Library entries stay.** They are already `{ id, kind, name, updated, data }` in the one IndexedDB store, and pages and
  spreads do not change format, so they simply keep working. `data.name` is dropped the next time an entry is written.
- **Sections and books** keep their stored shape until phase 5a changes the book format. After it, an old-format section or book is listed in
  the Library as "Old format" with Export and Delete, and cannot be opened: no conversion and no "Extract pages". The owner's page and spread
  designs are the work that matters and they survive (the cleanup made them built-ins); the books are built again from the outline (a few
  minutes each, which phases 6 and 7 make quick). The same holds for every later format change until the database: old files are not read.
- **Widgets and art** are Library items, not drafts. In phase 3, on first start, the contents of `dotwork.widgets` (`localStorage`) are
  copied once into the Library store as documents of kind `widget` and `art` (same id and name; ` 2` if the name is taken), and a flag
  (`dotwork.widgets.moved`) marks the move done. The old key is left untouched (it is the safety net). If the move fails, what was copied is
  taken out again, the real error is shown with Copy details, and it is tried again next start. It was `src/widgetmove.ts`; it existed for
  exactly one release and was deleted in phase 4.
- **Favorites** (`dotwork.favorites`) start again; they are a tap each.

**Why.** The map has two parallel ways to keep work (a draft per view, and explicit Library saves) and no link between them: edits to
a page never reach its saved copy, `Untitled` collides, the book draft is replaced by Open without a word, and nothing says whether
anything is saved. One open document that saves itself removes all of that and makes "Export what I am looking at" true. Pre-release,
nothing is worth a migration.

**Replaces.** Drafts and the `Save page / spread / left / right / book` buttons; "Save a copy" as the way to save; the replace-on-save
confirm; `Untitled` collisions (map §7.12); Open/Import replacing a draft silently (map §7.7); the false "Undo brings the old one back"
help text for New (map §7.6); the memory fallback hidden from the user (map §7.11); widgets in a second store (map §7.10, moved once in phase 3); the name stored twice.

## 4. A book is an outline

**D9. A book is an outline: an ordered list of blocks, edited like the layers panel.** A **block** is a **page**, a **spread**, a **group**
of blocks, or **free pages**. Page, spread and group blocks have a **repeat**:

| Repeat | Means |
|---|---|
| **×N** (a number of times) | N copies, one after another. The default is ×1. |
| **each day / week / month of the calendar** | One copy for each day, week or month of the book's calendar, in order. A dated book only. |
| **each day / week of the group's span** | Inside a group that repeats per week or per month: one copy for each day (or week) of the span that repeat covers. |
| **fill what's left** | As many copies as use up the pages the other blocks leave, so the book keeps its page count. |

- **Free pages** is a block of pages the owner fills by hand (book notes, ideas, anything). It takes whatever pages the other blocks leave, like
  fill, but each page is its own: blank, or a design chosen or drawn there. **Free pages and what is in them are kept when the book is
  re-dated**: free page *i* stays free page *i* when the calendar change moves it to another page number. The block is padded with blank
  pages up to the room there is, and **never trimmed**: a free page that no longer fits after a re-date is **kept**, marked **doesn't fit**, and
  the outline says **over by N pages** (red, like any overflow; printing waits until the book fits). The owner decides what to remove (delete
  those pages, or **Remove empty ones**, which takes only blank pages from the end) or makes room with Make the book N pages. Nothing is
  dropped automatically. A book has at most one block that takes what's left (a fill or free pages).
- **Pin to page.** Any block can be pinned to a page: a page number, or *last page* (which follows the book if it is resized). The pinned block
  is placed there first and the others flow around it; the free pages or fill before it take up the slack. A pinned spread needs a left
  page; a pin that collides with other blocks turns the count red and says which.

A group's children are blocks too, so a group can hold groups. A group saved to the Library becomes a **section**: the section *is* the
group, with its children and their repeats, but not its own outer repeat or pin (those belong to where it is placed). Placing a section in a
book adds a group.

**D10. The outline is edited like the layers panel.** One row per block: a **thumbnail** (the page, the spread, or the group's first page), the
name, its **repeat**, **pages used** and the **dates it covers**, as in `×5 · 10 pages · Nov 1 – Dec 5`, and a line saying **what its first
repeat reads**: `reads: SUN NOV 1`, or for a week page in a partial week `reads: week of Dec 27 – Jan 2, in book: Jan 1-2`. Opening the row lists
every repeat the same way, partial ones marked. A group's row can be **collapsed** to the first line. A pinned block shows `pinned: p.52`. Rows can be **dragged** to reorder or into and out of groups, and every row has **Up / Down** buttons (44 px) for touch; the row
menu also has **Duplicate**, **Group** and **Ungroup** (acts on the selected rows), **Delete**, **Repeat…**, **Pin to page…** and **Save as
section…** (groups only). Arrow keys and drag are desktop shortcuts, not the only way. Moving a block never changes its dates (D13). Selecting a row shows the
page, the spread or the group's pages large above the outline, so the page still gets most of the screen; on a phone the outline is a sheet
that slides up over it.

**D11. The outline always shows the count and the gaps.** A line at the top reads `48 of 52 pages`, live. When the blocks need more pages
than the book has it turns red, says by how many, and offers **Make the book N pages** (the next multiple of 4 that fits). **Spreads start
on a left page**: where one would land on a right page the app inserts a **gap page**, shown in the outline as a dim row ("Gap page:
keeps the spread facing") so nothing is hidden; gap pages count in the total. Blank pages are blocks like any other (Blank ×3). **Plan → Page map** lists every page of the book as it will print: page number, what it is,
and the dates it reads, one line each (D16 uses it on covers).

**D12. Undated books are just outlines with no calendar.** The "each day / week / month" repeats are greyed out with "Set a calendar", **fill
what's left**, **×N**, **free pages** and **pin to page** work, every date token prints blank (as today), and page numbers, covers, imposition and export are untouched.

**Why.** Sections-as-runs, parts, steps and a recipe all say the same thing in different words, and each has its own window. An outline
is one list that reads top to bottom like the book, can be changed by dragging, shows what it costs in pages, and is something people already
understand from the layers panel. Fill what's left is what lets the same outline fit a 28-day month and a 31-day month.

**Replaces.** Sections as runs with `days` / `weekday` / `move`, the recipe and its steps (`times` / `weeks` / `fill`), the Build book window, the
Dates window, "Apply to more pages…" as the way to repeat a design (it becomes ×N and Duplicate), `swapPages` / `movePage` with no UI
(map §7), the Contents list (the outline is the contents), and a book file that stored every page and every date (map §2, §4).

**The book file** (written into `docs/book-format.md` in phase 5a, which has the final shape; the sketch below also shows the calendar of phase 6): the book keeps `name`, `page_count`, `page_numbers`,
`print.signatures`, the four `cover` pages and an `outline`; it no longer stores `pages`, `dates` or `recipe`. The printed pages and their
dates are worked out from the outline by one function, so the file is the design, as the working rules say.

```json
"calendar": { "start": "2026-11-01", "end": "2026-11-30", "week_starts": 0 },
"outline": [
  { "type": "group", "name": "Weeks", "repeat": { "each": "week" }, "children": [
      { "type": "page", "page": { "...": "week page with a week block, full copy" }, "from": { "id": "…", "fingerprint": "…" }, "repeat": { "times": 1 } },
      { "type": "page", "page": { "...": "daily log" }, "repeat": { "each": "day", "of": "span" } },
      { "type": "page", "page": { "...": "weekly review" }, "repeat": { "times": 1 } }
    ] },
  { "type": "free", "pages": [ null, null, { "...": "a page the owner put there" } ] },
  { "type": "page", "page": { "...": "month review" }, "repeat": { "times": 1 }, "pin": "last" }
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
- **The repeat is suggested from the page's tokens, and shown.** When a page or spread is added to the outline its repeat is suggested, in one
  tap to change: `{weekday}` or `{day}` alone → each day; `{week}`, an offset of 6 or more days (`{day+6}`) or `@end` → each week;
  `{monthname}` → each month; no tokens → ×1. (A day token with `{week}` is still a day page: the week number is only extra.) Inside a
  group with a span the suggestion is "each day of the span" or "×1 (reads the span)". Each row then says what its first repeat prints
  (D10), so a wrong guess is visible before anything is printed.
- **Month lengths** (28 to 31 days, four weeks or five) are handled by the repeats; **fill what's left** keeps the page count.
- **Gap pages and blank blocks are undated.** A block whose unit has nothing left (the calendar is shorter than the outline expects) is shown
  as "outside the calendar" and prints undated; the outline says how many pages that is.

**D14. Short repeats.** When the calendar ends inside a repeat of a group (the last week of a month that ends mid-week), the group's
**Leave out in a short last repeat** list, a tick per child and empty by default, says which children are not placed in that one repeat. A
first repeat that starts before the calendar loses only its day pages outside it and keeps everything else. The option is kept for other
books (a week group with pages that make no sense in a part-week); **the monthly log book does not need it** (section 6): its short weeks
are handled by the week block (D16) and the day pages that fall outside the month are simply not made.

**D15. Tokens count in the token's own unit, and `@end` reads the end of what the page covers.**
- `{day+1}` is the next day, `{weekday+1}` the next weekday, **`{week+1}` the next week**, **`{month+1}` the next month**, **`{year+1}` the
  next year**. (The map's rule that every offset is in days, so `{month+1}` was "the month of tomorrow", goes.)
- A **week page** reads its week: `{weekday}`, `{day}`, `{month}`, `{year}` are the week's first day, `{week}` its number, `{day+6}` its last
  day. A **day page** reads its day. A **month page** reads the 1st. **A week is numbered by its book's year** (the year the calendar starts in): the week holding 1 January of that year is week 1, counted from
  the book's week start. So in a December 2026 book the week Dec 27 – Jan 2 is **week 53**, and in a January 2027 book the same week is
  **week 1**; the weekly review reads `WEEK 53  DEC 27-JAN 2` in one and `WEEK 1  DEC 27-JAN 2` in the other.
- **`@end`**: any token can end in `@end` to read the **last day** of what the page covers: a week page its last day, a month page the last day of
  the month, a day page its own day, a cover the calendar's last day. `{month} {day} – {month@end} {day@end}` on the week of 29 Nov 2026 prints
  `NOV 29 – DEC 5`. `@end` takes no offset.
- The built-in Weekly reflection becomes `WEEK {week}  {month} {day}-{month@end} {day@end}` (its old `{month+6}` would now mean six months
  on). Covers use it for ranges: `{monthname} – {monthname@end} {year@end}`. `{months}` ("NOV" or "NOV / DEC") stays as it is.
- **Example.** A week tracker whose seven column headings are `{day}`, `{day+1}` … `{day+6}` (and `{weekday}` … `{weekday+6}` above them) prints that
  week's seven days: `SUN MON TUE WED THU FRI SAT` over `1 2 3 4 5 6 7` for the week of 1 Nov 2026, and `29 30 1 2 3 4 5` for the week of
  29 Nov (a week page covers the whole week, even the days outside the month).
- In the editor, tokens still show the sample date (Mon 26 Oct 2026). Undated pages and covers of an undated book print them blank.

**D16. Generated elements are widgets that draw from the book.** Three pieces are drawn at print time from the book, not typed: the **Week
block**, the **Page index** and the **Month tracker**. They are one new element type in the page format, `generated` (a `kind`, a box
`x y w h` and a few options). In the editor they are **placed from the widget picker like any other widget** (Advanced → Widgets, under
Generated), **resize to their box**, move, group and layer like other elements, and show **sample data** (the sample week or month) so the page
can be designed; the real content is drawn from the book wherever the page lands, in the editor's Preview, Flip through, the PNG of a book
page's preview and the PDFs.

- **Week block.** Goals, then one row per day of the page's week that is inside the calendar, in weekday order, then outcomes. A page reads
  its week (D13) and the block asks the calendar which of the week's seven days are inside it. Row height is the same in every week (it comes
  from the box: (box height − goals − outcomes) ÷ 7, in half cells); the space of the days that are outside the calendar becomes **lined
  writing space** of exactly that many rows, separated by a rule:
  - **Every weekday is at the same vertical position on every page.** Day rows have one fixed place each, the same as in a full week. The days
    outside the calendar are always at one end of the week (the start in the first week, the end in the last), so anchoring the rest to the
    opposite end puts every present day on its full-week row:
  - **Full week**: goals, 7 day rows, outcomes. No lined space.
  - **First (partial) week**: the present days sit on their usual rows at the bottom, the outcomes under them, the goals directly above the first
    present day, and above the goals a rule and lined space in place of the missing days.
  - **Last (partial) week**: the present days sit on their usual rows from the top, the goals directly above the first (as in a full week), the
    outcomes directly under the last present day, and under the outcomes a rule and lined space in place of the missing days.
  - A calendar shorter than a week keeps its days on their usual rows with goals and outcomes around them, and lined space above and below.

  **One week page design covers all three.** Each day row carries its weekday and date (`FRI 1`) and writing lines. Properties: goals rows,
  outcomes rows, labels on or off. For editing only, the sample can be previewed as a full, first or last week.
- **Page index.** One line for each page of the book (or for each top-level block, an option) with the dates it reads and its page number; the
  same list as the Page map (D10). It is how a book's contents are reviewed at a glance: **a year of 12 monthly books can be reviewed side by
  side**, since every book's cover carries its page index and the Library shows covers.
- **Month tracker.** One row per day of the calendar's first month.
- **Covers read the book.** A cover reads the calendar as a month page for its first month (`{monthname}`, `{year}`) and `@end` reads the
  calendar's last day, so a one-month cover says `NOVEMBER 2026` and a longer one `{monthname} – {monthname@end} {year@end}`.

**Why.** The map's dates were stored in three places (the Dates window, the builder, a template), the recipe's month could disagree with
them, the Dates window defaulted to weeks so daily pages ended up a week apart, and the owner's own book had a hole and a hand-edited
tail. Dates that come from each block's repeat cannot disagree, cannot be lost by dragging a row, and re-dating a book is changing the
calendar.

**Replaces.** `book.dates[]`, `recipe.month`, the section's `days` / `weekday` / `move`, the recipe's `start`, `only_in_month` (a day outside
the calendar is simply not made), `guessMove`, the Dates window and its defaults, the 'dates travel with their page' rule, the
all-offsets-are-days rule and `{month+6}`, covers built from literal text (map §4, §6, §7.1-§7.5).

## 6. The owner's monthly log book

A monthly book logs **one calendar month**. Weeks are calendar weeks, **Sunday to Saturday** (the week start setting stays; Sunday is the
default). Only the month's first and last weeks can be partial, and they show it (D16). What the book contains is generated from the calendar:

- for each calendar week that touches the month (4 to 6): a **week page**, then a **daily log** page for each day of that week inside the month,
  then a **weekly review** page;
- the **month review**, pinned to page 52 (the left page facing the inside back cover);
- every other page is a **free page**, filled by hand (book notes, ideas, anything); free pages and what is in them survive re-dating (D9).

```
Weeks (group)            each week of the calendar        2 pages a week + 1 a day        Nov 1 – Dec 5
  Week page              ×1   reads: the week            (week block, D16)
  Daily log              each day of the span   reads: its day
  Weekly review          ×1   reads: the week
Free pages               what's left                      51 − the rest
Month review             ×1   pinned: last page (p.52)   reads: the month
```

The generated pages are `2 × weeks + days of the month` (at most 2×6 + 31 = 43), the month review is one, and the free pages are the rest of
the 52. Week numbers follow D15 (the week holding 1 January of the book's year is week 1).

### November 2026: 5 weeks, the last partial (29-30). 40 pages used, 11 free

1 Nov is a Sunday and 30 Nov a Monday. The first week is full; the last has two days in the month.

| Page | What | Reads |
|---|---|---|
| 1 | Week page (full: goals, 7 days, outcomes) | week 45, Nov 1-7 |
| 2-8 | Daily log ×7 | SUN NOV 1 … SAT NOV 7 |
| 9 | Weekly review | WEEK 45  NOV 1-NOV 7 |
| 10 | Week page | week 46, Nov 8-14 |
| 11-17 | Daily log ×7 | SUN NOV 8 … SAT NOV 14 |
| 18 | Weekly review | WEEK 46 |
| 19 · 20-26 · 27 | Week page · Daily log ×7 · Weekly review | week 47, Nov 15-21 |
| 28 · 29-35 · 36 | Week page · Daily log ×7 · Weekly review | week 48, Nov 22-28 |
| 37 | Week page, **last week**: goals, SUN 29, MON 30, outcomes, then a rule and lined space for the five days outside the month | week 49, Nov 29-Dec 5, in book: Nov 29-30 |
| 38-39 | Daily log ×2 | SUN NOV 29, MON NOV 30 |
| 40 | Weekly review | WEEK 49  NOV 29-DEC 5 |
| 41-51 | Free pages ×11 | (the owner's) |
| 52 | Month review | NOVEMBER REVIEW |

### January 2027: 6 weeks, both ends partial. 43 pages used, 8 free

1 Jan is a Friday. The first week (week 1, Sun Dec 27 to Sat Jan 2) has two days in the month; the last (week 6, Sun Jan 31 to Sat Feb 6) has
one.

| Page | What | Reads |
|---|---|---|
| 1 | Week page, **first week**: lined space and a rule on top (five days outside the month), then goals, FRI 1 and SAT 2 on their usual rows, outcomes under them | week 1, Dec 27-Jan 2, in book: Jan 1-2 |
| 2-3 | Daily log ×2 | FRI JAN 1, SAT JAN 2 |
| 4 | Weekly review | WEEK 1  DEC 27-JAN 2 |
| 5 · 6-12 · 13 | Week page · Daily log ×7 · Weekly review | week 2, Jan 3-9 |
| 14 · 15-21 · 22 | the same | week 3, Jan 10-16 |
| 23 · 24-30 · 31 | the same | week 4, Jan 17-23 |
| 32 · 33-39 · 40 | the same | week 5, Jan 24-30 |
| 41 | Week page, **last week**: goals, SUN 31, outcomes, a rule, lined space for the six days outside the month | week 6, Jan 31-Feb 6, in book: Jan 31 |
| 42 | Daily log ×1 | SUN JAN 31 |
| 43 | Weekly review | WEEK 6  JAN 31-FEB 6 |
| 44-51 | Free pages ×8 | (the owner's) |
| 52 | Month review | JANUARY REVIEW |

### February 2027: 5 weeks, 28 days. 38 pages used, 13 free

1 Feb is a Monday, so the first week (week 6, Sun Jan 31 to Sat Feb 6) has six days in the month and its lined space is one row; the last week
(week 10, Sun Feb 28 to Sat Mar 6) has one.

| Page | What | Reads |
|---|---|---|
| 1 | Week page, **first week**: lined space (one day) and a rule on top, then goals, MON-SAT on their usual rows, outcomes under them | week 6, Jan 31-Feb 6, in book: Feb 1-6 |
| 2-7 | Daily log ×6 | MON FEB 1 … SAT FEB 6 |
| 8 | Weekly review | WEEK 6  JAN 31-FEB 6 |
| 9 · 10-16 · 17 | Week page · Daily log ×7 · Weekly review | week 7, Feb 7-13 |
| 18 · 19-25 · 26 | the same | week 8, Feb 14-20 |
| 27 · 28-34 · 35 | the same | week 9, Feb 21-27 |
| 36 | Week page, **last week**: goals, SUN 28, outcomes, a rule, lined space (six days) | week 10, Feb 28-Mar 6, in book: Feb 28 |
| 37 | Daily log ×1 | SUN FEB 28 |
| 38 | Weekly review | WEEK 10  FEB 28-MAR 6 |
| 39-51 | Free pages ×13 | (the owner's) |
| 52 | Month review | FEBRUARY REVIEW |

Changing the calendar from November to February (or to any month) re-dates and re-lays every generated page; the free pages keep their
contents, in order, and move to pages 39-51.

### Every month of 2026 and 2027 fits

Each month is a calendar with its first and last days; the columns are the weeks that touch it (and their week numbers in that book's year), the days inside
the first and last week, the pages the generated part uses (`2 × weeks + days`), and the free pages (`51 − used`, the 52nd is the month review).

| Month | 1st, days | Weeks | Week numbers | Days in first / last week | Used | Free |
|---|---|---|---|---|---|---|
| Jan 2026 | Thu, 31 | 5 | 1…5 | 3 / 7 | 41 | 10 |
| Feb 2026 | Sun, 28 | 4 | 6…9 | 7 / 7 | 36 | 15 |
| Mar 2026 | Sun, 31 | 5 | 10…14 | 7 / 3 | 41 | 10 |
| Apr 2026 | Wed, 30 | 5 | 14…18 | 4 / 5 | 40 | 11 |
| May 2026 | Fri, 31 | 6 | 18…23 | 2 / 1 | 43 | 8 |
| Jun 2026 | Mon, 30 | 5 | 23…27 | 6 / 3 | 40 | 11 |
| Jul 2026 | Wed, 31 | 5 | 27…31 | 4 / 6 | 41 | 10 |
| Aug 2026 | Sat, 31 | 6 | 31…36 | 1 / 2 | 43 | 8 |
| Sep 2026 | Tue, 30 | 5 | 36…40 | 5 / 4 | 40 | 11 |
| Oct 2026 | Thu, 31 | 5 | 40…44 | 3 / 7 | 41 | 10 |
| Nov 2026 | Sun, 30 | 5 | 45…49 | 7 / 2 | 40 | 11 |
| Dec 2026 | Tue, 31 | 5 | 49…53 | 5 / 5 | 41 | 10 |
| Jan 2027 | Fri, 31 | 6 | 1…6 | 2 / 1 | 43 | 8 |
| Feb 2027 | Mon, 28 | 5 | 6…10 | 6 / 1 | 38 | 13 |
| Mar 2027 | Mon, 31 | 5 | 10…14 | 6 / 4 | 41 | 10 |
| Apr 2027 | Thu, 30 | 5 | 14…18 | 3 / 6 | 40 | 11 |
| May 2027 | Sat, 31 | 6 | 18…23 | 1 / 2 | 43 | 8 |
| Jun 2027 | Tue, 30 | 5 | 23…27 | 5 / 4 | 40 | 11 |
| Jul 2027 | Thu, 31 | 5 | 27…31 | 3 / 7 | 41 | 10 |
| Aug 2027 | Sun, 31 | 5 | 32…36 | 7 / 3 | 41 | 10 |
| Sep 2027 | Wed, 30 | 5 | 36…40 | 4 / 5 | 40 | 11 |
| Oct 2027 | Fri, 31 | 6 | 40…45 | 2 / 1 | 43 | 8 |
| Nov 2027 | Mon, 30 | 5 | 45…49 | 6 / 3 | 40 | 11 |
| Dec 2027 | Wed, 31 | 5 | 49…53 | 4 / 6 | 41 | 10 |

All 24 fit: the most any month uses is 43 pages (a six-week month of 31 days), so at least 8 pages are free and the month review is always page 52.
The week numbers were worked out by hand with D15 (a week is numbered by its book's year). In the December books the last week is
week 53 (Dec 27, 2026 – Jan 2, 2027; Dec 26, 2027 – Jan 1, 2028); the same weeks are week 1 in the January books that follow.

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
- **Update this book**: replaces each listed block's page with the design as it is now, turned to its slot.
  Blocks edited by hand are not included unless ticked; the list says "edited here" next to them first.
- **Choose**: a tick per row, then **Update ticked**.
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

**Later, maybe.** Book versions are not in the plan (section 10). The owner exports a book to keep a copy, and the outline's Undo covers a
session. This section is what they would be if they come back after November.

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
plus a calendar) that open read-only and make a copy when edited; a template that needs a month asks the calendar question when copied. The
monthly log book (section 6) is one of them: **Monthly log**, which asks for the month and builds the outline.

## 10. Phases

Each phase leaves the app working and deployable, passes the unit and e2e suites, and updates the docs it touches in place (the working rule:
no back compatibility, old files are listed as "Old format"). **★** marks a change to a page, book or library **file**. The goal of the plan is one
thing: **build November 2026 and print it.** There are three file changes on the way (phases 5a, 6 and 7: the book outline; the calendar; the first
`generated` element, the week block) and one change of meaning (phase 4, done); the library backup gained two kinds, the favorites and the printer profile in phase 3 (done).

| # | Phase | What it does | What the owner can try after it |
|---|---|---|---|
| 1 | **Documents: pages and spreads** (done) | One Library store; the open page or spread autosaves; "Saved" mark; New starts Untitled with the name-it chip and asks before export, placing and saving as a section; built-ins read-only with Edit a copy; the open document is remembered; Open and Import add documents. The old drafts are no longer read (the owner exported first). | Draw a page, close the tab, come back: it is there. Open a built-in and tap Edit a copy. |
| 2 | **Documents: books and sections** (done) | Books and sections open and autosave the same way; Open and Import of a book make documents; Export exports the open document; the "can't keep documents" notice. The book view is otherwise unchanged. | Open two books and switch between them without losing either. Import a book twice and get two. |
| 3 | **Full backup** (done) ★ library file | Widgets and art become documents in the store (moved once from `localStorage`, D8, so nothing saved is lost); a book built from a template with options is a document at once; Back up and Restore carry every document, the favorites and the printer profile (offered, default No), and never replace or delete. Favorites stay in `localStorage` (they are a tap each). | Back up, clear the browser, restore: pages, spreads, books, widgets and art are all back. |
| 4 | **Token units and `@end`** (meaning change) (done) | `{month+1}`, `{year+1}`, `{week+1}` count in their own unit; week pages read their week; `@end`; the built-in Weekly reflection and the examples are rewritten; the editor shows the new samples. The one-time widget and art move from phase 3 is removed. Books still store dates, so they print as before. Until the calendar (phase 6) a page is a week page if it has `{week}`, any `@end`, or a day offset of 6 or more, and reads the week holding its stored date. At each start a notice lists the documents that use `{month±N}`, `{year±N}` or `{week±N}`, whose meaning changed (removed in phase 5a). | See `{month+1}` and `NOV 29 – DEC 5` on a week page in the editor. |
| C | **Cleanup** (done, this PR) | No back compatibility (the page v1 reader and converter, old-shape tests and the monthly-log book test are gone; the rule is in CLAUDE.md); the unit and e2e suites trimmed to rules and math plus one main path per feature; the owner's pages and spreads are built-ins; the gauge widgets; a printer-profile layout missing from a saved profile takes the defaults, and Reset this layout to defaults on the PDF tab. | Open the Library: Daily Log, Daily Log Spread, Book notes, Idea variations and the rest are there. |
| 5a | **★ The outline (undated)** (done) | The book becomes an outline: pages, spreads, simple groups with a repeat, and free pages; ×N and fill; pin to page; gap pages for spreads; Up / Down to move a block; the live "N of 52 pages". Links (`from`) are recorded but not used yet. Removes `pages`, `dates`, `recipe`, the Build, Dates and Apply windows. Old books and sections become "Old format" (Export and Delete). | Build a 52-page undated book as an outline on a phone: blank ×10, a group of an idea spread and a lined page ×6, free pages for the rest, a closing page pinned to the last page. Done: see **Phase 5a as built** below. |
| 6 | **★ The calendar and derived dates** | `calendar`, the "each day / week / month" repeats, "of the span", week start, week numbers by the book's year, the repeat suggested from a page's tokens and the "reads:" line on every row, spread coverage, short-repeat leave-out, dates on every page, the Page map. The book's dates reach the PDFs, previews and Flip through. Free pages that do not fit after a re-date are kept and marked. | Make a November 2026 book from ordinary pages (a week group: a tracker page, a daily log for each day, a review page), change the calendar to January 2027 and watch every date move. |
| 7 | **★ The week block and the monthly log book** | The first `generated` element in the page format, the **Week block** (placed from the widget picker, resizes to its box, sample data and a full / first / last preview in the editor; every weekday at the same row on every page). The built-in **Monthly log** template. Rebuilds the November book fixture as the Monthly log for November 2026 and its test. | Make the Monthly log for November 2026 (40 pages used, 11 free), then January 2027 (six weeks, partial first and last week pages), fill some free pages and re-date: your free pages stay, and the month review stays on page 52. |
| 8 | **Build November 2026 and print it** | No new code: the owner builds the book from the outline and the Monthly log, calibrates, prints and binds it. What goes wrong or is slow in that hour is what comes next. | A printed, bound November 2026 journal. |

### After November, decided from use

Not scheduled. Each is kept here so it is not forgotten, and none starts before the November book is printed and the owner says which one hurts most.

- **Outline extras:** drag to reorder, Duplicate, Group / Ungroup as separate actions, Collapse, save a group as a section, thumbnails on rows, Make the book N pages, Edit here / Split out.
- **Links and the updates list:** `from` is used: the update line, the list (Update this book, Choose, Make an updated copy, Keep, edited-here marks), Edit here / Edit the design, sections' own update line. No file change.
- **The three areas:** the Design / Plan / Print switcher, Library tabs per area, the Print screen (the PDF tab, Calibrate and Printer), settings per area.
- **Covers from the book:** the other `generated` kinds (Page index, Month tracker); cover tokens read the calendar; the templates' covers use them. ★ file change.
- **Book versions** (section 8): later, maybe.

The old code that goes away with the formats is removed in the phase that makes it unreachable: `dates`, the recipe, `findBuiltinSection`, `monthSpan` and the dead helpers listed in map §7. The version-1 page reader and its converter went in the cleanup.

### Phase 5a as built

Where the model left a choice, the simplest reading was taken. The book file is `docs/book-format.md`; the code is `src/book/outline.ts` (the layout), `outlineread.ts` (the reader) and `arranger.ts` (the Book view).

- **Repeat** is `{ "times": n }` or `{ "fill": true }`. A fill is on a top-level page, spread or group block; inside a group a block repeats a number of times only. **At most one top-level block takes what is left**: a fill, or the free-pages block. The Add window turns the free-pages card off, and the Fill switch off, while another block has it.
- **Free pages** are a block with a `pages` list. At the top level it takes every page the others leave and keeps the designs stored in `pages` (blank elsewhere); a stored page that does not fit is kept and the book is over. Inside a group it is exactly its stored pages (one blank page when empty) for each repeat. **There is no control yet to put a design on a free page**: the list is read, kept and laid out, and stays empty or whatever an imported file holds.
- **Pin** is a page number or "last page" on a top-level page, spread or group (not free pages, and not together with a fill). A pinned block is placed first and the others flow around it, skipping its pages; "last page" ends the block on the last page. A pinned spread or group that would start on a right page gets a gap page first.
- **Gap pages** are the Notes page, counted in the total. A gap before a block is its own dim row in the outline; gaps inside a group (between repeats) are counted in the group's row ("2 gap pages").
- **Over.** The total turns red with "over by N pages" and **Make the book N pages** (the next multiple of 4 that holds the blocks, within 400). **Print files… waits while the book is over** (the button is off, and the export window refuses): printing would drop pages.
- **Moving.** Up / Down move a block within its list (the top level, or a group's children) and a block is moved into a group (to its end) or out of it (right after it) from its settings. No drag yet.
- **Sections** are groups kept in the Library (`{ name, children }`). Built-in sections are groups; Add… lists them and places one as a group. **No control saves a group as a section yet.**
- **Covers** stay what they were: four pages, chosen with Choose design… on the cover itself.
- **Undated.** Date tokens print blank in every outline book. The monthly journal template builds its week texts as literal text, as before.
- **Templates** build outlines: the idea and plain books use fill and a pinned last page; the monthly journal builds a block per week from `monthlyLayout`, then patterns, questions, idea spreads to fill and three notes pages pinned to the end (its page index is made from the same layout, and a test pins that the outline reproduces its pages).

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

**Q5. Library backup contents.** Every document (pages, spreads, sections, books, widgets, art), the favorites, and the printer profile with both
layouts' calibration. Not the built-ins. The profile belongs to a printer, so Restore never replaces it silently: it
is offered separately ("Replace your printer settings with the backup's?", both sets of values shown, default No) and only when it differs.

**Q6. Moving and swapping pages.** Both are the outline (and pin to page for a block that must stay put): drag a row or use Up / Down, and Duplicate. Dates follow the block's repeat, so moving
never changes them (D10, D13). Swapping two blocks is dragging one past the other.
