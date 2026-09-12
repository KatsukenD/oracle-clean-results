import * as vscode from 'vscode';
import type {
  Api,
  ResultSet,
  Worksheet
} from '@oracle/sql-developer-api';

const ORACLE_EXTENSION_ID = 'Oracle.sql-developer';
const COMMAND_ID = 'oracleCleanResults.runQuery';

const RESULTS_VIEW_ID =
  'oracleCleanResults.resultsView';

const RESULTS_CONTAINER_ID =
  'oracleCleanResultsContainer';

const PAGE_SIZE = 500;

let resultsView:
  vscode.WebviewView | undefined;

let pendingHtml:
  string | undefined;


/*
 * Bottom results panel
 */
class ResultsViewProvider
  implements vscode.WebviewViewProvider {

  public static readonly viewType =
    RESULTS_VIEW_ID;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context:
      vscode.WebviewViewResolveContext,
    _token:
      vscode.CancellationToken
  ): void {

    resultsView =
      webviewView;

    webviewView.webview.options = {
      enableScripts: false
    };

    webviewView.webview.html =
      pendingHtml ??
      buildWelcomeHtml();

    webviewView.onDidDispose(() => {

      if (
        resultsView ===
        webviewView
      ) {
        resultsView =
          undefined;
      }

    });
  }
}


/*
 * Extension activation
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {

  /*
   * Register our bottom results view.
   */
  const provider =
    new ResultsViewProvider();

  context.subscriptions.push(
    vscode.window
      .registerWebviewViewProvider(
        ResultsViewProvider.viewType,
        provider
      )
  );


  /*
   * Get Oracle SQL Developer's API.
   */
  const oracleExtension =
    vscode.extensions
      .getExtension<Api>(
        ORACLE_EXTENSION_ID
      );

  if (!oracleExtension) {

    void vscode.window
      .showErrorMessage(
        'Oracle Clean Results: ' +
        'Oracle SQL Developer for VS Code ' +
        'is not installed or is disabled.'
      );

    return;
  }


  const api =
    oracleExtension.isActive
      ? oracleExtension.exports
      : await oracleExtension.activate();


  /*
   * Register our command through Oracle's
   * worksheet API.
   *
   * This gives the callback the actual
   * Oracle worksheet that invoked it.
   */
  const commandDisposable =
    api.worksheets()
      .registerCommand(
        COMMAND_ID,
        (worksheet: Worksheet) => {

          void runQueryWithCleanResults(
            worksheet
          ).catch(error => {

            const message =
              error instanceof Error
                ? error.message
                : String(error);

            void vscode.window
              .showErrorMessage(
                `Oracle Clean Results: ${message}`
              );

          });

        }
      );

  context.subscriptions.push(
    commandDisposable
  );
}


export function deactivate(): void {
  /*
   * Result sets are closed immediately
   * after reading.
   */
}


/*
 * Execute the query.
 */
async function runQueryWithCleanResults(
  worksheet: Worksheet
): Promise<void> {

  const editor =
    worksheet.editor;

  const session =
    worksheet.session;

  if (!session) {
    throw new Error(
      'The active Oracle worksheet ' +
      'is not connected to a database.'
    );
  }


  /*
   * Rule 1:
   *
   * If SQL is selected, execute exactly
   * what the user selected.
   */
  const selection =
    editor.selection;

  let sql: string;

  if (!selection.isEmpty) {

    sql =
      editor.document
        .getText(selection)
        .trim();

  } else {

    /*
     * Rule 2:
     *
     * Nothing selected.
     *
     * Ask Oracle SQL Developer itself
     * which SQL statement contains the
     * current cursor position.
     */
    const documentSql =
      editor.document.getText();

    const cursor =
      editor.selection.active;

    const prepared =
      await session.prepareSql(
        documentSql,
        {
          line:
            cursor.line,

          character:
            cursor.character
        }
      );

    sql =
      prepared.statementText
        ?.trim() ??
      '';

  }


  if (!sql) {
    throw new Error(
      'No SQL statement was found ' +
      'at the current cursor position.'
    );
  }


  let resultSet:
    ResultSet | undefined;

  try {

    /*
     * Execute through the connection already
     * attached to the Oracle worksheet.
     */
    resultSet =
      await session.executeQuery(
        { sql },
        {
          pageSize:
            PAGE_SIZE
        }
      );


    const rows =
      resultSet.rows();


    await showResults(
      rows
    );

  } finally {

    if (resultSet) {
      await resultSet.close();
    }

  }
}


/*
 * Show the bottom Oracle Results panel.
 */
async function showResults(
  rows: Array<Record<string, unknown>>
): Promise<void> {

  pendingHtml =
    buildResultsHtml(rows);


  /*
   * Reveal our VS Code bottom panel.
   */
  await vscode.commands
    .executeCommand(
      `workbench.view.extension.${RESULTS_CONTAINER_ID}`
    );


  if (resultsView) {

    resultsView.webview.html =
      pendingHtml;

    resultsView.show?.(true);

  }
}


/*
 * Initial message before anything has run.
 */
function buildWelcomeHtml(): string {

  return `
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<style>

  body {
    margin: 0;
    padding: 14px;

    font-family:
      var(--vscode-font-family);

    font-size:
      var(--vscode-font-size);

    color:
      var(--vscode-foreground);

    background:
      var(--vscode-panel-background);
  }

  .message {
    color:
      var(--vscode-descriptionForeground);
  }

</style>

</head>

<body>

  <div class="message">
    Run a query using
    <strong>
      Run with Clean Results
    </strong>
    to display results here.
  </div>

</body>

</html>
`;
}


/*
 * Build the query results grid.
 */
function buildResultsHtml(
  rows: Array<Record<string, unknown>>
): string {

  const columns =
    getColumns(rows);


  const headerHtml =
    columns
      .map(
        column =>
          `<th>${escapeHtml(column)}</th>`
      )
      .join('');


  const bodyHtml =
    rows.length === 0

      ? `
        <tr>
          <td
            class="empty"
            colspan="${Math.max(
              columns.length,
              1
            )}"
          >
            No rows returned
          </td>
        </tr>
      `

      : rows
          .map(row => {

            const cells =
              columns
                .map(column => {

                  const value =
                    row[column];

                  return `
                    <td>
                      ${formatCell(value)}
                    </td>
                  `;

                })
                .join('');

            return `
              <tr>
                ${cells}
              </tr>
            `;

          })
          .join('');


  return `
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
           initial-scale=1.0"
>

<title>
  Oracle Results
</title>

<style>

  :root {
    color-scheme:
      light dark;
  }

  body {
    margin: 0;
    padding: 0;

    font-family:
      var(--vscode-font-family);

    font-size:
      var(--vscode-font-size);

    color:
      var(--vscode-foreground);

    background:
      var(--vscode-panel-background);
  }


  .toolbar {
    display: flex;

    align-items:
      center;

    gap:
      14px;

    padding:
      6px 10px;

    border-bottom:
      1px solid
      var(--vscode-panel-border);

    color:
      var(
        --vscode-descriptionForeground
      );

    white-space:
      nowrap;
  }


  .grid-wrap {
    overflow:
      auto;

    width:
      100%;

    height:
      calc(100vh - 34px);
  }


  table {
    border-collapse:
      collapse;

    width:
      max-content;

    min-width:
      100%;
  }


  th,
  td {
    padding:
      4px 8px;

    border-right:
      1px solid
      var(--vscode-panel-border);

    border-bottom:
      1px solid
      var(--vscode-panel-border);

    white-space:
      nowrap;

    text-align:
      left;

    vertical-align:
      top;
  }


  th {
    position:
      sticky;

    top:
      0;

    z-index:
      1;

    font-weight:
      600;

    background:
      var(
        --vscode-editorGroupHeader-tabsBackground
      );
  }


  tr:last-child td {
    border-bottom:
      0;
  }


  th:last-child,
  td:last-child {
    border-right:
      0;
  }


  .empty {
    padding:
      20px;

    text-align:
      center;

    color:
      var(
        --vscode-descriptionForeground
      );
  }

</style>

</head>

<body>

  <div class="toolbar">

    <span>
      ${rows.length}
      row${rows.length === 1 ? '' : 's'}
    </span>

    <span>
      NULL values are blank
    </span>

  </div>


  <div class="grid-wrap">

    <table>

      <thead>
        <tr>
          ${headerHtml}
        </tr>
      </thead>

      <tbody>
        ${bodyHtml}
      </tbody>

    </table>

  </div>

</body>

</html>
`;
}


/*
 * Determine columns from the returned rows.
 */
function getColumns(
  rows: Array<Record<string, unknown>>
): string[] {

  const columns:
    string[] = [];

  const seen =
    new Set<string>();


  for (const row of rows) {

    for (
      const key of Object.keys(row)
    ) {

      if (!seen.has(key)) {

        seen.add(key);

        columns.push(key);

      }

    }

  }


  return columns;
}


/*
 * Format values for display.
 *
 * TRUE database NULL values become blank.
 */
function formatCell(
  value: unknown
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }


  if (
    value instanceof Date
  ) {

    return escapeHtml(
      value.toISOString()
    );

  }


  if (
    typeof value === 'object'
  ) {

    try {

      return escapeHtml(
        JSON.stringify(value)
      );

    } catch {

      return escapeHtml(
        String(value)
      );

    }

  }


  return escapeHtml(
    String(value)
  );
}


/*
 * Avoid values being interpreted as HTML.
 */
function escapeHtml(
  value: string
): string {

  return value

    .replaceAll(
      '&',
      '&amp;'
    )

    .replaceAll(
      '<',
      '&lt;'
    )

    .replaceAll(
      '>',
      '&gt;'
    )

    .replaceAll(
      '"',
      '&quot;'
    )

    .replaceAll(
      "'",
      '&#039;'
    );
}