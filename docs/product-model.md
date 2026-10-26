# Dotwork product model: how the app should work

This is the target. [product-map.md](product-map.md) says how the app works at commit `4366849`; this says how it should. Nothing
here is built yet. The printer, calibration and the page and spread drawing tools stay as they are (the editor, Advanced, layers,
properties, the print pipeline, creep, imposition and the PDFs): this model changes where things are kept, how they are saved,
how they are linked and how dates work.

Each decision has a **Why** and what it **Replaces** in the map (`map §n` is a section of the map; `map §7.n` is item *n* of its list of
things that disagree). Section 6 puts the decisions in order. Section 8 lists what I need the owner to decide.

## 1. Three areas, one Library

**D1. The app has three areas: Design, Plan and Print. They share one Library.** A segmented control in the top bar switches
between them (three buttons, 44 px high, fits 390 px). The Library is one place that holds every document; each area opens it on its
own tabs, and a search box searches all of it.

| Area | Is for | Documents it opens | Screens |
|---|---|---|---|
| **Design** | Drawing one page or one spread | Pages, spreads, widgets, art | Page view, Spread view, tool bar, Advanced, properties and layers, page/spread Settings, Library tabs Pages, Spreads, Widgets, Art |
| **Plan** | Putting designs into a book and dating it | Books, sections | Book view (the arranger), Choose design, Apply to more pages, Move and Swap, Updates, Calendar, Builder, Save as section, Section view, Flip through, Library tabs Books, Sections, Templates |
| **Print** | Getting a book onto paper | The open book (it opens nothing itself) | Print (what is now the PDF tab), Printer (the profile), Calibrate |

- **Widgets and art belong to Design.** They are drawn and saved there and placed from Advanced.
- **Sections belong to Plan.** A section is a run of book pages, so it is opened as a small book (Section view: the arranger without
  covers or calendar), not in the page editor.
- **The Export window stays** (Import, Export JSON, PNG), reachable from the **Export** button in every area. Its PDF tab goes away:
  the same fields and the Download live on the Print screen, because they are the printer's. The Export button on a book offers
  "Print…" which goes there.
- **Printer profile stays one profile in `localStorage`** (`dotwork.printer`), not a Library document: it belongs to a printer, not
  to a design, and a book must open the same everywhere. Several named profiles are a later idea, not part of this model.
- **Settings** is per area: the name and the page options in Design, the book options (name, pages, page numbers, signatures,
  calendar) in Plan, nothing new in Print.

**Why.** The map's top bar mixes three jobs (Page, Spread and Book are three views of one menu; the PDF tab hides the printer
inside an export window; the Library is a window you open from everywhere and it behaves differently for each kind). Three areas
match what the owner does in order: draw, assemble, print. A phone shows one area at a time, and the page being designed or the book
still gets most of the screen.

**Replaces.** The **Page ▾** menu as the way to move between Page, Spread and Book (map §3); the Library's tab set being the same
wherever it opens; Calibrate being reachable only from the PDF tab; widgets and art living outside the Library (map §2).

## 2. Documents

**D2. Everything in the Library is a document, and a document autosaves while you edit it.** Pages, spreads, sections, books,
widgets and art are all documents in one IndexedDB store. There are no drafts: what you are editing *is* the Library document, and
every committed change is written to it (after a 400 ms pause, and when the tab is hidden or closed). A small "Saved" mark
beside the name says so; "Not saved" with a retry appears if a write fails. There is no Save button and no unsaved-changes state.

**D3. Names.** A new document is named when it is created: **New** asks for a name before anything opens, and the field starts empty
(Create is disabled until there is a name). A document still called `Untitled` (anything coming from an old draft or import without
a name) asks for a real name the first time it is opened, exported or placed. A name is unique within its kind; typing a taken name
is refused with "already used". Renaming is done in Settings and in the Library, and it is the only copy of the name (the file gets it
when exported). There is no replace-on-save confirm any more because nothing is saved over anything.

**D4. Built-ins are read-only; editing makes a named copy.** A built-in opens with a quiet bar: "Built-in. Editing makes a copy."
Trying to change anything (or pressing the bar's **Edit a copy**) asks for a name, prefilled with `<name> copy`, creates the document
and carries on in it. The Library's **Duplicate** does the same from the list. "Save a copy" stops being how you save; it is only
Duplicate.

**D5. Opening never replaces anything.** The editor, the arranger and the Section view show the open document; opening another
(from the Library, a template, an import, or a link in a book) writes the current one first and switches. The app remembers the open
document (`dotwork.open`: its id) and comes back to it on reload. Because nothing is replaced, "Open and Import replace the book with
no confirm and no undo" cannot happen. Undo stays in memory per open document, as now.

**D6. Export always exports the open document.** Export JSON writes the open document as it is at that moment, in whatever area you
are in (today's rule, but with one open document instead of "the view you are in"). PNG is offered for pages and spreads; PDFs for
books. If the open document has no such export, the button says what to open, and the Library button is beside it.

**D7. Import makes a new document.** A `.json` page, spread, section or book becomes a new document named from the file (with `2`,
`3`... added if the name is taken) and opens. Restoring a backup adds every document that is not already there (same id and same
content is skipped; same id, different content comes in as `<name> (restored)`). Nothing is replaced.

**D8. If the browser cannot keep documents** (no IndexedDB, private mode), the app says so at the top, in words, and keeps working
from memory with Export prominent. It never silently looks like it saved.

**D9. Today's drafts and Library entries.**
- **Library entries stay as they are.** They are already `{ id, kind, name, updated, data }` in one IndexedDB store. Nothing converts.
  Two things change only when an entry is written next: `data.name` is dropped in favour of `name` (the map's "a name lives twice"), and
  names that collide inside a kind get ` 2`.
- **Widgets and art** (`dotwork.widgets` in `localStorage`) are copied once into the Library store as documents of kind `widget` and
  `art` on first start, then the `localStorage` key is removed. This is a move of the same objects, not a conversion, and it is needed so
  that one backup and one store hold everything.
- **Drafts** (`dotwork.page`, `dotwork.spread.left/right/name`, `dotwork.book`) are adopted once on first start: each one that
  holds something is stored as a document under its own name (`Untitled` ones ask for a name when opened, as D3 says), and the key is removed.
  This is needed so that updating the app does not throw away what the owner is working on. It is the only adoption code, it is removed
  one release later, and a draft that fails the format is kept as the existing `.bad.<time>` download, as now.
- Any later format change in section 6 is **not** carried over: a document that no longer reads shows in the Library as "Can't open
  (old format)" with Export so the file can be kept, and is otherwise left alone. That is the pre-release rule.

**Why.** The map has two parallel ways to keep work (a draft per view, and explicit Library saves) and no link between them: edits
to a page never reach its saved copy, "Untitled" collides, the book draft is replaced by Open without a word, and nothing says
whether anything is saved. One open document that saves itself removes all of that and makes "Export what I am looking at" true.

**Replaces.** Drafts and the `Save page / spread / left / right / book` buttons (map §2, §3, §5); `Save a copy` as the way to save;
the replace-on-save confirm; `Untitled` collisions (map §7.12); Open/Import replacing a draft silently (map §7.7); the false "Undo brings
the old one back" help text for New (map §7.6); the memory fallback hidden from the user (map §7.11); widgets in a second store
(map §7.10); `data.name` duplication (map §7 duplication list).

## 3. Links between designs and books

**D10. A page placed in a book is a full copy plus a link.** The book still embeds every page, so a book file is the whole book and
prints with no Library. Each placed page also carries `from`: the design's Library id and a fingerprint of the design as it was
placed. A spread placed in a book links both of its pages (the spread's id, which half). A section placed in a book links each page
(the section's id, the page's position in it). Chosen from a built-in, the id is the built-in's name and its fingerprint is of the
built-in as it is in the app.

**D11. The fingerprint** is a short hash of the page's `identity`, `grid` and `elements`, in the order stored. It leaves out the
name, `side` and `page_number`, because placing a page turns those to fit the slot. The same function describes the design now and the
copy in the book, so it answers both questions:

- *Has the design changed since?* Its fingerprint now is not the one in the link.
- *Was the page edited by hand in the book?* The copy's fingerprint is not the one in the link.

No version history is stored. A link remembers one fingerprint, not the old design; "update" always means "take the design as it is now".

**D12. Opening a book checks the links** and, if any need attention, shows one line at the top: "4 pages use designs that changed" (the
Plan area also has a **Check for updates** button). Tapping it opens a list (thumbnail, page number, design name, a mark if the
copy was edited by hand, a mark if the design was deleted) with:

- **Update all**: replaces each listed page with the design as it is now, turned to its slot as placing does. Pages edited by hand
  are **not** included unless their box is ticked; the list says "edited here" next to them first, so nothing hand-made is lost
  by surprise.
- **Choose**: a tick per page, then **Update ticked**.
- **Keep**: leaves the pages and stores the design's current fingerprint in their links, so the line goes away until the design
  changes again. A design that was deleted is also cleared this way (the page stays as a plain copy).
- **Make an updated copy of the book**: a new book document `<name> updated` with all updates applied (hand-edited ones follow
  the ticks), the original untouched. This is the safe route before a print run.

Updating is one undo step. It never touches the book's calendar, parts or covers' other content.

**D13. One hop at a time.** A section holds copies of pages with links to the designs; a book page placed from a section links to
the section, not to the design behind it. So a change in a design reaches a section when the section is opened (its own update line,
the same list) and reaches a book when the section changes. If a section gets longer or shorter, its pages are updated by position
and the list says "this section is now 13 pages, was 12; pages 13 and later are not added", and **Make an updated copy** is not offered
for it; the owner re-places the section from the Builder. Simple beats clever here.

**D14. Editing a page that sits in a book.** The page's menu has **Edit here** (opens the editor on the book's copy; the page is then
"edited here", and Back returns to the book) and **Edit the design** (opens the linked design; the book was already saved, so Back
returns to it, and the Updates line is waiting). Neither is a new editor.

**Why.** The owner redraws a page once and wants every book to follow, but also wants a printed book to stay exactly as designed
until he says so. A copy plus a link gives both, keeps every book file self-contained and printable, and needs no history store.

**Replaces.** "Nothing refers to anything else; everything is copied" (map §1): the rule stays for the file, with links added;
`Apply to more pages` and `Choose design…` now also write the link; the dead `carry` rule "dates travel with their pages" (map §7).

## 4. Dated books

### Calendar, units and tokens

**D15. A book may have a calendar.** In Plan → Settings → **Calendar**: *none* (the default, an undated book) or

- a **month**: choose a month and year (the picker opens on next month as a suggestion; nothing is set until Set is tapped),
- **months**: a first month and a number of months, or
- **dates**: from and to, for anything else.

and **Week starts on**: Sunday by default, any weekday. The book stores `calendar: { start, end, week_starts }` (two real days and
a number). The calendar is the only place a book says what time it covers. **The recipe's `month` goes away** (the builder reads the
calendar), and with it the map's "the month a book is lives in two places" (map §7.1).

**D16. Pages never store dates.** A page is a design, wherever it is. What a *slot in a book* stands for is stated by the section
(or by the loose run of pages) it sits in, and the book works every date out. In the file, a section lists for each of its pages what
it **stands for**: `day`, `week`, `month` or `none` (undated), and the section has one **unit**, what one repeat of it covers:
`day`, `week`, `month` or `none`. In the book, `parts` lists the runs of pages: each part says which pages it holds and which unit
it covers (a copy of the section's, so the book is self-contained).

**D17. How a date is worked out.** Walk the parts in book order with a cursor that starts at the calendar's start. A part with
unit `week` begins at the start of the week holding the cursor and moves the cursor to the next week start when it ends; `month`
begins on the 1st and moves to the 1st of the next month; `day` covers the cursor's day and moves to the next day; `none` has no
dates and does not move the cursor. Inside a part, the *n*-th page that stands for a day gets the part's first day plus *n*-1 days;
the *n*-th page that stands for a week gets the *n*-th week from the part's first week; the same for months; `none` pages are
undated. Rules:

- **A day page exists only for a day inside the calendar's range.** A day outside it is dropped from the part when the part is
  built (the first week of a month that starts on a Monday, with weeks starting on Sunday, has no Sunday page).
- **A week page covers the whole week**, even when part of it is outside the range, so its tokens read the full week.
- **A month page covers the month holding its first day.**
- A part that would start after the calendar's end is listed as "outside the calendar" and printed undated, and the book says how
  many pages that is. Nothing is hidden.
- Moving a part (D24) changes its dates, because the dates come from position. Nothing else holds a date.

**D18. Token offsets count in the token's own unit.** `{day+1}` is the next day, `{month+1}` is the next *month*, `{year+1}` the next
year, `{week+1}` the next week; `{weekday+1}` is the next day. `{months}` takes no offset. This replaces the map's rule that every offset
is in days (so `{month+1}` was "the month of tomorrow"). **A week page's tokens read its week:** `{weekday}`, `{day}`, `{month}`,
`{year}` are the week's first day, `{week}` is its number, `{day+6}` is its last day, and `{months}` is `NOV / DEC` when the week reaches into
the next month. A **day page** reads its day; a **month page** reads the 1st of its month. Weeks number from the week holding January 1,
counting from the book's week start. The built-in Weekly reflection becomes `WEEK {week}  {months} {day}-{day+6}`, because its old
`{month+6}` would now mean six months on.

**D19. Covers can use tokens and generated content from the book.** The covers read the calendar as a month page for its first
month (`{monthname}`, `{year}`, `{month+1}`...) so a cover can say `NOVEMBER 2027`. The generated pieces come with a new element type
in the page format, `generated`: a **Page index** (one line per part with its dates and page number, replacing the literal text the
templates draw today) and a **Month tracker** (one row per day of the first month). Both are drawn at print time from the book; in
the editor they show sample rows. Outside covers may use them too. Nothing is re-typed when the dates change.

### The builder, and where a step starts

**D20. The builder lays out steps; the book keeps them.** A step is a section and *how many times*: **each day / week / month of the
calendar** (what the section's unit says), **a number of times**, or **fill what's left** (as many whole repeats as fit the pages
and the calendar, at most one). The steps are stored in the book (`plan`), with the sections embedded (as in the recipe today), so
the book can be laid out again after the calendar changes. Building replaces the interior pages and parts as one undo step; covers
are untouched. Pages edited by hand are flagged first, with the same list as D12.

**D21. Where a step starts.** Right after the previous step ends (its cursor); the first step starts at the calendar's start. A
step may say **Start on** a date, stored in the step, to skip ahead. There is no default of "the 1st of the recipe's month" any more,
so two steps never start on the same day by accident (map §7.2 and the cause of the owner's finding 3).

**D22. A short last repeat.** When the calendar ends mid-week, the last repeat keeps only the day pages inside it, and the week and
other pages follow D17. A step has **In a short repeat, leave out** with a tick per page of the section, empty by default, for pages
that make no sense for a part-week. The builder always shows pages used and left ("52 of 52"), and when the steps need more than the
book has it says by how many and offers **Make the book N pages** (the next multiple of 4).

**D23. Presets.** Books made from templates set a calendar and steps, and use token pages, so they can be re-dated by changing the
calendar. This replaces templates that write literal text (map §7.14) and templates that read the clock once at load (map §7.13).
**Week log** and **Month log** are presets of steps.

**D24. Loose pages and the Dates window.** The Dates window is removed. In its place: **Calendar** (D15) and, for any selected
run of pages, **These pages stand for: a day each / a week each / a month each / undated**. The default is read from the page
designs' own tokens (a page with `{weekday}` or `{day}` and no week tokens stands for a day; `{week}` or `{day+6}` or `{months}` a week;
`{monthname}` a month; none: undated), never "a week" by default (the map's finding that daily pages ended a week apart, §7.3). The
selection becomes a part. **Save pages as a section** (Plan) saves a part: its unit and what each page stands for are read off the
part, not guessed from dates (map §7.5).

### Moving and swapping pages

**D25. Two operations, both with touch buttons.** **Swap designs**: pick a page, tap **Swap with…**, tap another slot (or enter its
number): the two pages trade places and each slot keeps what it stands for and, therefore, its date, so "Tuesday's page" stays
Tuesday's. **Move part**: pick a part, then **Earlier** / **Later** (or **Move to page…**): the whole part, with its pages, moves and
its dates are worked out again. The arranger inserts a gap page where a part would land on the wrong side of the spine, as the builder
does. Both are one undo step. Arrow keys and drag stay as desktop shortcuts.

**Why.** Dates stored on pages were copied from three places (the Dates window, the builder, a template), could disagree with the
recipe, and turned out wrong in the owner's own book (a week apart, a hole, hand-edited pages). Derived dates cannot disagree, and
re-dating a book is changing the calendar.

**Replaces.** `book.dates[]`, `recipe.month`, section `days` / `weekday` / `move`, the Dates window, `guessMove`, `only_in_month` (a
day page outside the range is simply dropped), the *times/fill/weeks* difference in how `move` is honoured, the Build-by-week special
case (map §4, §7), the dead `swapPages` / `movePage` / `carry` getting a UI (map §7), and the covers being literal-text only (map §6).

### The owner's November log book

Setup, in the new model (`tests/fixtures/monthly-log-book.json` has the pages; the dates and the recipe are what change):

1. **Calendar:** *dates* 1 Nov 2027 to 30 Nov 2027, **week starts on Monday**. (1 Nov 2027 is a Monday. The fixture's section starts
   on a Monday and its tracker lists SUN first, so the owner may prefer a Sunday start. See the open questions.)
2. **Section "Week log"** (12 pages, unit **week**, starts on a right page), what each page stands for: tracker *week*; seven Daily Log
   pages *day*; Weekly reflection *week*; Book notes setup, Book notes and Notes *none*. The reflection's identity is
   `WEEK {week}  {months} {day}-{day+6}` (D18). Daily Log keeps `{weekday} {month} {day}`.
3. **Section "Month review"** (1 page, unit **month**, a left page): Patterns & takeaways, `{monthname} REVIEW`.
4. **Steps:** *Week log: each week of the calendar*, with "In a short repeat, leave out": Weekly reflection, Book notes setup, Book
   notes, Notes. Then *Month review: 1 time*. The second step starts right after the first (D21).
5. **Covers:** the front is the Monthly tracker with a Month tracker element and `{monthname} {year}`; the back is the Monthly page index
   as a Page index element (D19).

What it builds and prints (52 pages, 13 sheets, one signature):

| Pages | Part | What each page prints |
|---|---|---|
| 1-12 | Week log, week 45 (1-7 Nov) | Tracker; Daily Log MON NOV 1 through SUN NOV 7 (pages 2-8); `WEEK 45  NOV 1-7`; Book notes setup, Book notes, Notes |
| 13-24 | Week 46 (8-14 Nov) | the same, MON NOV 8 ... SUN NOV 14, `WEEK 46  NOV 8-14` |
| 25-36 | Week 47 (15-21 Nov) | MON NOV 15 ... SUN NOV 21, `WEEK 47  NOV 15-21` |
| 37-48 | Week 48 (22-28 Nov) | MON NOV 22 ... SUN NOV 28, `WEEK 48  NOV 22-28` |
| 49-51 | Week 49 (29 Nov-5 Dec), short | Tracker; Daily Log MON NOV 29, TUE NOV 30. The other five days are outside the range and the four left-out pages are not placed |
| 52 | Month review | `NOVEMBER REVIEW` |

This is the owner's current book, page for page (the tracker, two daily pages and the review at the end), but every date is derived: no
page is undated by accident, nothing is a week apart, nothing is hand-fixed, and changing the calendar to December re-dates it. Without
the leave-out ticks the last week would also place the reflection and three notes pages, and the builder would report "56 of 52 used,
4 too many" and offer a 56-page book. The fixture and its test are rewritten in step 10 of section 6.

## 5. Undated books

**D26. Undated books work exactly as now.** A book with no calendar has no dates; every token prints blank, as it does today; a
book can still be made of a repeated section with *a number of times* or *fill what's left*; the leave-out and calendar steps are
not offered. The calendar section of Settings says "No calendar. Pages print their date tokens blank." with a **Set a calendar**
button. Nothing about page numbers, covers, imposition or export changes for them.

## 6. Phases

Each phase leaves the app working and deployable, passes the unit and e2e suites, and updates the docs it touches in place.
**★** marks a phase that changes a page or book file. There are three file changes (6, 8 and 11) and one change of meaning
for existing tokens (7); everything else keeps the files as they are.

| # | Phase | What it does | What the owner can try after it |
|---|---|---|---|
| 1 | **Documents for pages and spreads** | One Library store; the open document autosaves; New asks for a name; built-ins open read-only with Edit a copy; the open document is remembered; current page and spread drafts adopted once; "Saved" mark. Removes the Save buttons for pages and spreads. | Draw a page, close the tab, come back: it is there under its name. Open a built-in and tap Edit a copy. |
| 2 | **Documents for books and sections** | Books and sections open and autosave the same way; the book draft is adopted; Open and Import make documents instead of replacing; Export exports the open document; "can't keep documents" notice. | Open two books and switch between them without losing either. Import a book twice and get two. |
| 3 | **Widgets, art and a full backup** | Widgets and art become documents (the one-time move); favorites ride along; Back up and Restore carry every document, favorite, widget and art; restore never replaces. | Back up, clear the browser, restore: pages, widgets and art are all back. |
| 4 | **Three areas** | The Design / Plan / Print switcher, Library tabs per area, the Section view, the Print screen (the PDF tab moves there, Calibrate and Printer beside it), Settings per area, help entries. | On a phone, go draw → arrange → print without opening a menu to change views. |
| 5 | **Swap and move pages** | Swap two pages, or move a page or a run of pages earlier or later, in the Book view with touch buttons, using the existing `swapPages` / `movePage` (dates are still stored on pages, so they travel with the page as the code does today). | Fix a book's page order on a phone without redoing it. |
| 6 | **★ Links** (file change 1) | `from` (id, fingerprint) on placed pages, spread halves and section pages; the Updates line and list (update all, choose, keep, updated copy, hand-edit marks); Edit here / Edit the design. | Change a page design, open the book that uses it, update just the pages you pick. |
| 7 | **Token units** (meaning change, no new fields) | `{month+1}` is next month, `{year+1}`, `{week+1}`; week pages read their week; the built-in Weekly reflection and the examples are rewritten; the editor shows the changed samples. Existing dated books still work, since dates are still stored. | See `{month+1}` and a week page's range on a page. |
| 8 | **★ Calendar, parts and derived dates** (file change 2) | `calendar`, `parts`, section `unit` and `stands_for`, `plan` steps; dates derived; the Dates window replaced by Calendar and "These pages stand for"; the minimal builder (a number of times, fill, starting after the previous step); sections saved from parts. Removes `dates`, `recipe.month`, `days`, `weekday`, `move`. | Set a calendar on an existing book, choose "a day each" for a run of pages, and see the dates. Change the month and watch them all move. |
| 9 | **Moving a part** | Move part earlier / later or to a page, with gap pages; Swap designs now leaves each slot's date where it is, as D25 says (in phase 5 dates still travel with the page). | Move a section of the book and see its dates follow. |
| 10 | **The builder on the calendar** | Each day / week / month of the calendar, Start on, leave-out in a short repeat, "N of M used" with Make the book N pages, presets (Week log, Month log) and templates that set a calendar. Rebuilds the November log book fixture and its test. No file change: the step shape is in phase 8. | Rebuild the November log book from the section in 2 minutes; change the calendar to December and rebuild. |
| 11 | **★ Covers from the book** (file change 3) | The `generated` element (Page index, Month tracker); cover tokens; the templates' covers use them. | The cover and the page index follow the calendar. |

The only code that goes away with the formats is old (version-1 pages and their converters, the old-book tolerance in `readBook` and
`readPrinter`, `dates`, the recipe's `month`, `findBuiltinSection`, `monthSpan`); it is removed in the phase that makes it
unreachable, with the dead helpers in map §7. Phase 5 works on stored dates and 9 on derived ones, which is why moving a part waits for 8.

## 7. The PR #29 open questions

**Q1. The recipe's month against the page dates (D15, D17).** Dates are derived; the only stored time is the book's calendar. No
recipe month, so they cannot disagree.

**Q2. Where a builder step starts (D21).** After the previous step; the first at the calendar's start; "Start on" overrides it and is
stored in the step.

**Q3. The Dates window's default mode (D24).** The window is gone. Selected runs of pages get "stands for" from their own tokens (day for
`{weekday}` / `{day}` pages, week for week tokens, month for `{monthname}`, undated otherwise), and the Calendar says which dates exist.
The default is never "a week" for a daily page.

**Q4. PNG date and page number (D6).** A PNG is what is on screen: a page or spread document has no date and no page number of its own,
so it shows the sample (Mon 26 Oct 2026, page 47), and the PNG tab says so in one line ("Sample date and page number"). The book's
`preview.png` and Flip through already show the book's real dates and numbers, and keep doing so; PNG for one book page is not added
(no new export options).

**Q5. Library backup contents (D7, D9).** Everything the Library holds: pages, spreads, sections, books, widgets, art, and favorites.
Not the built-ins (they come with the app) and not the printer profile (it belongs to a printer).

**Q6. Moving and swapping pages (D25).** Yes, with visible touch buttons: Swap designs, and Move part earlier / later or to a page.
Dates follow the slot, not the design, for a swap, and follow position for a part.

## 8. Open questions for the owner

1. **Week start for the November book.** The fixture's section starts on a Monday but its tracker lists SUN first and the app's weeks
   are Sunday-based. Do you want the book's weeks to start on Monday (as set up above, with the tracker's labels changed), or Sunday
   (the first week then has no Sunday page, and the tracker as it is is right)?
2. **Short last week.** Leaving out the reflection and notes pages in the last short week is a tick list on the step. Is that
   what you want, or should a short week keep every page and let the builder offer a 56-page book?
3. **Week numbers.** The week holding 1 January is week 1, counted from the book's week start (as journal-system does for Sundays). With
   Monday weeks that can differ from journal-system's number by one for some weeks. Which should win?
4. **The `{months}` label on a week page.** `WEEK 49  NOV / DEC 29-5` is what the old tokens can give without a new token. Is that
   acceptable, or do you want a token for the last day's month (`{month_end}` or similar)?
5. **Names.** Creating a document asks for a name up front and refuses a name that is taken in its kind. If you would rather have `Untitled`
   with a number appended and rename later, say so; the cost is the collisions the map lists.
6. **One hop for sections (D13).** A design reaches a book through its section. Is it all right that updating a design does not reach the book
   until the section is updated first?
7. **Adopting today's drafts (D9).** The one-time adoption of drafts and widgets is the only conversion code. If the current drafts are
   not worth keeping, it can be dropped and the first start will begin empty.
8. **Covers outside a one-month calendar.** For a calendar of several months, cover tokens read the first month. Should the cover say the
   whole range (`NOV 2027 - JAN 2028`)?
