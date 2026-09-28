# Changelog

All notable changes to **Oracle Clean Results** are documented in this file.

Oracle Clean Results is currently under active development. Early releases focus on building and refining the core query-results workflow.

## 0.1.1 - Oracle Error Handling

- Added rich Oracle error results with error code, message, location, cause and action.
- Added Oracle Error Help using Oracle-provided documentation links.
- Added View Query support to error results.
- Added Go to Error navigation to jump directly from an error result to the exact error location in the original SQL worksheet.
- Go to Error supports cursor-based execution, selected SQL, multiple selected statements, leading comments and whitespace, and retained error tabs.
- Added detailed Oracle diagnostics to the Oracle Clean Results Output channel.
- Added collapsible Display Info to keep result status information cleaner while retaining access to NULL and Oracle NLS formatting details.
- Display Info reflects the configured NULL display text and the NLS date and timestamp formats used by the result.

## 0.1.0 — First Public Release

Oracle Clean Results is now ready for its first public preview release.

## 0.0.18 — Settings

- Added configurable NULL display text.
- Added configurable Oracle fetch size.
- Added an option to enable or disable automatic fetching while scrolling.
- Added configurable maximum automatic column width.
- NULL display text remains presentation-only and does not alter the underlying database value used for sorting, filtering, copying, or exporting.

## 0.0.17 — Column Details

- Added column metadata directly from Oracle result-set metadata.
- Right-click a column header to view datatype, precision, scale, and nullable status.
- Added one-click copying of column details to the clipboard.
- Preserved normal context-menu behaviour for result cells.

## 0.0.16 — Multi-Column Sorting

- Added Shift-click multi-column sorting.
- Added visible sort priority indicators to column headers.
- Shift-clicking an existing sort cycles through ascending, descending, and removed.
- Normal sorting continues to behave as a single-column sort.

## 0.0.14 — Export Results and Query Provenance

- Added export to Excel Workbook (`.xlsx`), CSV, TSV, and clipboard text.
- Added generation of Oracle `INSERT` statements from result data.
- Added export scopes for Current Results, Selected Cells, and All Results.
- Added automatic fetching of remaining rows when exporting All Results.
- Excel exports now include a Results worksheet and an SQL worksheet with query context.
- Each result tab retains the exact SQL statement that produced it.
- Added **View Query** for inspecting and copying the SQL behind a result tab.

## 0.0.13 — Selection and Clipboard

- Added cell, rectangular, row, and column selection.
- Added keyboard navigation within the results grid.
- Added `Ctrl/Cmd+C` copying of selected values.
- Added `Ctrl/Cmd+Shift+C` copying with column headers.
- Added `Ctrl/Cmd+A` selection of the displayed result set.
- Added whole-column selection from column headers.
- Added Shift-selected column ranges and non-adjacent Ctrl/Cmd column selection.
- Database NULL values remain blank when copied.

## 0.0.12 — Filtering

- Added distinct-value filters for result columns.
- Filters operate on currently fetched rows.
- Added cascading filter values as the result set is narrowed.
- Filtering is applied before local sorting and display.

## 0.0.11 — Sorting

- Added local result sorting without rerunning the SQL query.
- Added datatype-aware comparisons.
- Added stable sorting.
- Database NULL values sort last.

## 0.0.10 — Resizable Columns

- Added manual column resizing.
- Added per-result-tab column widths.
- Added double-click auto-fit.
- Improved automatic sizing using rendered header content and result data.

## 0.0.9 — Virtualised Results

- Added virtualised grid rendering for improved performance with large result sets.
- Added automatic fetching when scrolling near the end of fetched rows.
- Improved column-width stability while navigating large results.

## 0.0.8 — Row Numbers

- Added row numbers to the results grid.
- Row numbers remain visible while navigating results.

## 0.0.7 — Multi-Query Execution and Ctrl+Enter

- Added `Ctrl+Enter` execution through Oracle Clean Results.
- Added execution of the statement at the cursor when no SQL is selected.
- Added execution of multiple selected SQL statements into separate result tabs.
- Improved SQL statement parsing for comments, quoted strings, quoted identifiers, and Oracle q-quoted strings.

## 0.0.6 — Large Result Sets

- Added paged result fetching.
- Added **Fetch More** and **Fetch All**.
- Added progress feedback while retrieving larger result sets.
- Improved result-set cleanup and lifecycle handling.

## 0.0.5 — Oracle NLS Formatting

- Added Oracle session-aware `NLS_DATE_FORMAT` handling.
- Added Oracle session-aware `NLS_TIMESTAMP_FORMAT` handling.
- Improved DATE and TIMESTAMP display consistency with the active Oracle session.

## 0.0.4 and Earlier — Initial Clean Results

- Introduced the Oracle Clean Results companion results viewer.
- Added execution through the active Oracle SQL Developer for VS Code worksheet and connection.
- Added a dedicated Oracle Results panel with multiple result tabs.
- Added clean display of database NULL values as blank cells.
- Established the core results-grid workflow that later releases build upon.
