# Oracle Clean Results

A companion results viewer for **Oracle SQL Developer for VS Code** that
makes Oracle query results cleaner and easier to work with.

Oracle Clean Results provides a streamlined results grid with clean NULL
handling, Oracle NLS-aware date and timestamp formatting, sorting,
filtering, large-result navigation, exports, query provenance, and
useful column metadata.

> Oracle Clean Results is a companion extension. It requires the
> **Oracle SQL Developer extension for Visual Studio Code**.

## Why Oracle Clean Results?

Oracle SQL Developer for VS Code is an excellent environment for working
with Oracle databases, but sometimes you just want a cleaner, more
practical results grid.

Oracle Clean Results was originally created to solve one simple
annoyance: displaying database `NULL` values as blank cells instead of
`(null)`.

It grew from there.

The goal remains the same: keep the SQL workflow familiar while making
query results easier to read, inspect, copy and export.

## Features

### Clean NULL display

Database `NULL` values are blank by default, reducing visual clutter in
result sets.

The displayed NULL text is configurable. Leave it blank for empty cells,
or choose your own value such as `(null)`, `NULL`, `-`, `<null>`, or
anything else you prefer.

This is display-only. The underlying value remains a genuine database
NULL for sorting, filtering and export behaviour.

### Oracle NLS-aware dates and timestamps

DATE and TIMESTAMP values are formatted using the Oracle session's
`NLS_DATE_FORMAT` and `NLS_TIMESTAMP_FORMAT`, keeping displayed values
consistent with your Oracle session.

### Sorting and filtering

Sort result sets locally without re-running the query. Single-column and
Shift-click multi-column sorting are supported, with datatype-aware
comparison and NULL values sorted last.

Individual columns can also be filtered using distinct values from the
currently fetched rows. Filters cascade as the result set is narrowed.

### Large result sets

Oracle Clean Results uses paged fetching and virtualised rendering to
keep large result sets usable.

Use **Fetch More**, **Fetch All**, or automatic fetching as you scroll.
Fetch size and automatic scroll fetching are configurable in VS Code
Settings.

### Selection and clipboard

The grid supports individual cells, rectangular selections, whole rows,
whole columns, Shift-selected column ranges, non-adjacent
Ctrl/Cmd-selected columns, and keyboard navigation.

**Ctrl/Cmd+C** copies values, **Ctrl/Cmd+Shift+C** copies values with
headers, and **Ctrl/Cmd+A** selects the currently displayed result set.

Database NULL values remain empty in copied data.

### Export results

Export results as:

-   Excel Workbook (`.xlsx`)
-   CSV (`.csv`)
-   TSV (`.tsv`)
-   Clipboard text
-   Oracle `INSERT` statements

Exports can use **Current Results**, **Selected Cells**, or **All
Results**. When exporting all results, the remaining rows can be fetched
first.

Excel exports contain a **Results** worksheet plus an **SQL** worksheet
containing the query and useful export context.

### Query provenance

Each result tab remembers the exact SQL statement that produced it.

Use **View Query** to inspect or copy that SQL, which is particularly
useful when working with several result tabs.

### Column details

Right-click a column header to view available Oracle metadata including
datatype, precision, scale and nullable status. Column details can also
be copied to the clipboard.

### Resizable columns

Columns are automatically sized using their header and result data. Drag
column dividers to resize manually or double-click a divider to
auto-fit.

The maximum automatic width is configurable. Manual resizing can exceed
that limit.

## Running a query

Oracle Clean Results integrates with the active Oracle SQL worksheet.

Use **Ctrl+Enter** or the **Run with Clean Results** command.

**Please note** hat you may need to check your shortcut keys in VS Code
for this to work as expected.

If SQL is selected, the selected SQL is executed. Without a selection,
Oracle Clean Results determines the statement at the cursor. Multiple
selected SQL statements can also be executed, with each result displayed
in its own result tab.

After execution, focus returns to the SQL editor so you can continue
working without clicking back into the worksheet.

## Result tabs

Each query result is displayed in the **Oracle Results** panel in
separate tabs such as **Results 1**, **Results 2**, and **Results 3**.

Tabs can be switched between and closed independently.

## Settings

Open VS Code Settings and search for **Oracle Clean Results**.

**NULL Display Text**\
Text displayed for database NULL values in the results grid. Default:
blank.

**Fetch Size**\
Number of rows requested in each Oracle result-set page. Default: `500`.
Changes apply to newly executed queries.

**Automatically Fetch on Scroll**\
Automatically fetch the next page when scrolling near the end of the
currently fetched rows. Default: enabled.

**Maximum Automatic Column Width**\
Maximum width used when Oracle Clean Results automatically sizes
columns. Default: `400` pixels. Manual resizing can exceed this value.

## Requirements

Oracle Clean Results requires Visual Studio Code, **Oracle SQL Developer
for VS Code**, and an Oracle database connection available through an
Oracle SQL worksheet.

Oracle Clean Results uses the active Oracle worksheet and connection
supplied by Oracle SQL Developer for VS Code. It does not implement its
own Oracle database connection.

## Installation

### Visual Studio Marketplace

Marketplace installation instructions will be added when Oracle Clean
Results is publicly released.

### VSIX

During development or private testing, Oracle Clean Results can be
installed from a `.vsix` package using VS Code's **Install from
VSIX...** command.

## Compatibility

Oracle Clean Results is designed as a companion to Oracle SQL Developer
for VS Code.

Because it relies on APIs provided by the Oracle extension, changes to
those APIs may require corresponding updates to Oracle Clean Results.

## Privacy and database access

Oracle Clean Results operates on query results returned through the
active Oracle SQL Developer for VS Code session.

The extension does not create a separate database connection. Export
features write data only when you explicitly choose an export action.

## Known limitations

Oracle Clean Results is under active development.

Some Oracle-specific datatypes may require additional specialised
display behaviour. Support for additional datatype and NLS scenarios
will be expanded as practical use cases are identified.

General SQL/PLSQL script execution is not currently a goal of the Clean
Results query runner; the extension is focused on query-result
workflows.

## Feedback and issues

Bug reports, feature suggestions and reproducible examples are welcome
through the project's GitHub repository.

When reporting a results-grid issue, including the relevant datatype,
query shape and expected behaviour is especially helpful.

## Licence

Oracle Clean Results is released under the **MIT License**.

See [LICENSE](LICENSE) for details.

## Disclaimer

Oracle Clean Results is an independent project and is not affiliated
with, endorsed by, or sponsored by Oracle Corporation.

Oracle and related product names are trademarks of Oracle Corporation
and/or its affiliates.
