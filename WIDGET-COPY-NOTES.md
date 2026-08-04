# Widget Copy — findings

Working notes from moving the signed-off Widget Library copy
(`Widget library redesign mockup.zip` → `widget-library-copy.ts`) into
`src/widgets/registry.ts` and `src/widgets/presets.ts`.

Every line was checked against the code that actually implements it. Most of it
held up. What follows is what didn't, split by what was done about it.

**Why this file exists:** these strings are the only promise a user gets before
adding a widget. A `feature` row naming something the widget doesn't do is a
bug, not a wording preference — so the false ones were corrected rather than
shipped, and the ambiguous ones are parked here rather than quietly "fixed" on
a guess.

---

## Corrected — verified false against the code

### 1. Meal Planner → Grocery List ingredient sending doesn't exist

Two widgets both claimed it, from opposite ends:

- `meal-planner`: *"Send the week's ingredients to a Grocery List"*
- `grocery-list`: *"Meal Planner can send a week's ingredients straight here"*

There is no such code path. `src/widgets/meal-planner/` and
`src/data-sources/meal-plan.ts` contain no reference to groceries, shopping, or
`ingredient-line.ts`; `src/data-sources/groceries.ts` is down to two path
helpers. Nothing writes from one to the other.

**Now reads:**
- Meal Planner → `{ feature } Extend a meal across days, duplicate it, or move it`
- Grocery List → `{ pairs } Same plain-markdown storage as Checklist — nothing is locked in`

**This is worth building.** It's the single most obvious gap the copy exposed —
two independent writers both assumed it already existed, which is usually a
sign the feature is the natural shape of the thing. `ingredient-line.ts` already
parses qty/unit/name, and Grocery List is a plain `checklist` source, so a
"Send week to…" action is mostly plumbing.

### 2. Time Period does not drive Expense Vs Income

`income-expense-bar` claimed: *"Time Period can set the range it charts."*

`ExpenseVsIncomeWidget.tsx:99` calls `useBudgetRecentMonthsEntries(app, budgetName)`
and never imports `useBudgetMonth`. The window is hardcoded to the last six
months (`budgetStore.ts:44`). Time Period has no effect on it at all.

**Now reads:** `{ feature } Always charts the last six months — nothing to configure`

### 3. Time Period is a month selector, not a date range

`time-period` claimed *"a small date-range control"* and *"the global date
range for all the finance widgets."*

Both halves are wrong. `TimePeriodWidget.tsx:23` writes a single
`selectedMonthKey` (`"YYYY-MM"`) via `BudgetMonthContext` — one month, not a
range. And only three of the seven Finance widgets read it: Month Review, Year
Review and Categorized Pie Chart. Expense Vs Income, Income & Expense Tracker
and Recurring Items ignore it.

**Now reads:** description *"A small month selector the Finance reviews read
from"*, and the `pairs` row names the three widgets that actually follow it.

### 4. The Categorized Pie Chart is expense-only

`expense-donut` claimed: *"Organize your expenses or income streams into a
categorized pie chart to visualize how you spend, **or how you earn**."*

The widget's only toggle is Month/Year (`CategorizedPieChartWidget.tsx:20`),
not expense/income. `DonutChart` reads `summary.byCategory`, which
`getMonthSummary` fills from expenses; its own empty state reads *"No expenses
for this period."* There is no income view.

**Now reads:** an expense-only paragraph, with the real Month/Year toggle
promoted to a `feature` row since that capability was going unmentioned.

---

## Parked — needs your call, left as-is

### TODO List: "Rename or reorder tabs"

I could only verify **moving a task between tabs** — `TodoRow`'s "Move to ▸"
menu (`TodoListWidget.tsx:41`). I found no tab rename and no tab reorder.

Left as `{ feature } Move any task to another tab from its own row menu`, which
is definitely true. If rename/reorder do exist somewhere I missed, put the
original line back. If they don't, this is the second-best build candidate on
this page.

### "Categorized Pie Chart" vs "the donut"

The copy calls this widget a donut throughout; the registry label is
**Categorized Pie Chart**, and that's what the library's card title and detail
pane will show. Not wrong, just two names for one thing. Renaming the widget to
"Expense Breakdown" or similar would settle it — but that's a label change with
its own blast radius, so it's yours to make, not a copy edit.

### Kanban's Task Manager link — verified TRUE, kept and promoted

*"Link buckets to the Task Manager"* is real: `AddBucketModal.tsx:71` has an
"Include in Task Manager" toggle. It was buried in the description; it's now
its own `pairs` row where someone deciding between Kanban and Task Manager will
actually see it.

---

## Copy defects left verbatim

Per your call, the signed-off wording ships as-is apart from the corrections
above. These are the mechanical defects I'd have cleaned in a copy pass:

| Where | Issue |
|---|---|
| `grocery-list` about | "for future integration with you recipies" → *your recipes* |
| `recipe-box` about | "just like Grandmas Recipe Box" → *Grandma's* |
| `meal-planner` about | "meals can be extended…" — sentence starts lowercase |
| ~10 strings | trailing whitespace (`record-table`, `data-table`, `meeting-log`, `task-manager`, `todo-list`, `my-classes`, `class-scheduler`, …) |

Note: the grocery-list and recipe-box sentences in question were **rewritten
anyway** as collateral of corrections #1 and the Recipe Box pass, so those two
are already clean in the code. The list is kept complete so you can see what
the original said.

---

## Verified true — no change needed

- Recipe Box AI URL import — `widgets/recipe-vault/useRecipeImport.ts`
- My Classes syllabus import — `widgets/my-classes/SyllabusImportModal.tsx`
- Income & Expense Tracker AI categorization — `widgets/income-expense/useBudgetCleanup.ts`
- Calendar's Google sync + full-screen day/week/month — `widgets/calendar-strip/CalendarFullscreen.tsx`
- Record Table is read-only — the `table` renderer never writes
- Data Table column resize persists — `columnWidths` via `onOptionsChange`
- Recipe List's full-screen reader — the `detail: 'recipe-fullscreen'` preset field
- **"28 widgets · 7 categories"** — 6 presets + 22 non-`classPageOnly` components.
  Correct, but the library derives both from the registry rather than printing
  the constant, so it can't go stale.
