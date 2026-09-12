# Oracle Clean Results

A small companion extension for **Oracle SQL Developer for VS Code**.

Version 0.0.1 has one purpose: run a query through the active Oracle worksheet session and display the results in a cleaner grid where database `NULL` values appear as blank cells.

## Current proof-of-concept behaviour

- Uses the active Oracle SQL Developer worksheet and its existing database session.
- If SQL is selected, executes the selection.
- If nothing is selected, executes the entire worksheet.
- Requests up to 500 rows for the first result page.
- Opens the results beside the worksheet.
- Displays true `null` / `undefined` values as blank cells.
- Does not alter the SQL just to change presentation.

## Prerequisites

- VS Code 1.101 or newer.
- Oracle SQL Developer Extension for VS Code installed and enabled.
- Node.js and npm for development.

## Build

Open this folder in VS Code, then in the integrated terminal run:

```bash
npm install
npm run compile
```

Then press **F5** to launch an Extension Development Host.

In the development VS Code window:

1. Open an Oracle SQL worksheet.
2. Connect it to your database normally.
3. Select a query (recommended for this first version).
4. Open the Command Palette.
5. Run **Oracle Clean Results: Oracle: Run Query with Clean Results**.

## Why selected SQL is recommended initially

This first proof of concept deliberately avoids trying to parse the SQL statement under the cursor. When nothing is selected it sends the entire worksheet to Oracle's single-query `executeQuery` API, so a worksheet containing multiple statements may fail.

A later version can use Oracle's `prepareSql()` API to identify the statement at the cursor, including binds/substitutions.

## Next likely improvements

- Execute the statement at the cursor using `prepareSql()`.
- Page through large result sets instead of showing only the first page.
- Sort and filter columns.
- Copy cells / rows with Excel-friendly behaviour.
- Export CSV / XLSX.
- Column formatting preferences.
- Adjustable NULL display (`blank`, `(null)`, custom text).
- Worksheet toolbar button / keyboard shortcut.
