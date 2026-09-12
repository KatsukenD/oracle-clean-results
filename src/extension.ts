import * as vscode from 'vscode';

import type {
  Api,
  ResultSet,
  Worksheet
} from '@oracle/sql-developer-api';


const ORACLE_EXTENSION_ID =
  'Oracle.sql-developer';

const COMMAND_ID =
  'oracleCleanResults.runQuery';

const RESULTS_VIEW_ID =
  'oracleCleanResults.resultsView';

const RESULTS_CONTAINER_ID =
  'oracleCleanResultsContainer';

const PAGE_SIZE =
  500;


/*
 * A single results tab.
 */
interface ResultTab {

  id: number;

  title: string;

  rows:
    Array<Record<string, unknown>>;

  pinned: boolean;

}


/*
 * Webview messages.
 */
interface WebviewMessage {

  command:
    | 'selectTab'
    | 'togglePin'
    | 'closeTab';

  id: number;

}


/*
 * Extension state.
 */
let resultsView:
  vscode.WebviewView | undefined;

let resultTabs:
  ResultTab[] = [];

let activeResultId:
  number | undefined;

let nextResultNumber =
  1;


/*
 * Bottom results panel.
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


    /*
     * JavaScript is now required because
     * the result tabs are interactive.
     */
    webviewView.webview.options = {
      enableScripts: true
    };


    renderResultsView();


    /*
     * Receive tab actions from the webview.
     */
    webviewView.webview
      .onDidReceiveMessage(
        async (
          message: WebviewMessage
        ) => {

          switch (
            message.command
          ) {

            case 'selectTab':

              selectResultTab(
                message.id
              );

              break;


            case 'togglePin':

              toggleResultPin(
                message.id
              );

              break;


            case 'closeTab':

              closeResultTab(
                message.id
              );

              break;

          }

        }
      );


    webviewView.onDidDispose(
      () => {

        if (
          resultsView ===
          webviewView
        ) {

          resultsView =
            undefined;

        }

      }
    );

  }

}


/*
 * Extension activation.
 */
export async function activate(
  context:
    vscode.ExtensionContext
): Promise<void> {


  /*
   * Register bottom results view.
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
   * Obtain Oracle SQL Developer API.
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
   * Register our worksheet command
   * through Oracle's own API.
   */
  const commandDisposable =
    api.worksheets()
      .registerCommand(

        COMMAND_ID,

        (
          worksheet:
            Worksheet
        ) => {

          void runQueryWithCleanResults(
            worksheet
          )
            .catch(
              error => {

                const message =
                  error instanceof Error
                    ? error.message
                    : String(error);


                void vscode.window
                  .showErrorMessage(
                    `Oracle Clean Results: ${message}`
                  );

              }
            );

        }

      );


  context.subscriptions.push(
    commandDisposable
  );

}


export function deactivate(): void {

  /*
   * Result sets are closed immediately
   * after their rows are read.
   */

}


/*
 * Execute selected SQL or SQL at cursor.
 */
async function runQueryWithCleanResults(
  worksheet:
    Worksheet
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


  const selection =
    editor.selection;


  let sql:
    string;


  /*
   * Explicit selection wins.
   */
  if (!selection.isEmpty) {

    sql =
      editor.document
        .getText(
          selection
        )
        .trim();

  } else {

    /*
     * Otherwise ask Oracle which
     * statement contains the cursor.
     */
    const documentSql =
      editor.document
        .getText();


    const cursor =
      editor.selection
        .active;


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
        ?.trim()
      ?? '';

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

    resultSet =
      await session.executeQuery(

        {
          sql
        },

        {
          pageSize:
            PAGE_SIZE
        }

      );


    const rows =
      resultSet.rows();


    /*
     * Hand the completed result
     * to the tab manager.
     */
    await addQueryResult(
      rows
    );


  } finally {

    if (resultSet) {

      await resultSet.close();

    }

  }

}


/*
 * Add a new query result.
 *
 * If the active result is NOT pinned,
 * reuse that tab.
 *
 * If it IS pinned, create a new tab.
 */
async function addQueryResult(
  rows:
    Array<Record<string, unknown>>
): Promise<void> {


  const activeTab =
    getActiveResultTab();


  if (
    activeTab &&
    !activeTab.pinned
  ) {

    /*
     * Reuse the current unpinned tab.
     */
    activeTab.rows =
      rows;

  } else {

    /*
     * Current tab is pinned,
     * or this is our first query.
     *
     * Create a fresh working result tab.
     */
    const newTab:
      ResultTab = {

        id:
          nextResultNumber,

        title:
          `Results ${nextResultNumber}`,

        rows,

        pinned:
          false

      };


    nextResultNumber++;


    resultTabs.push(
      newTab
    );


    activeResultId =
      newTab.id;

  }


  /*
   * Open/reveal the bottom panel.
   */
  await vscode.commands
    .executeCommand(
      `workbench.view.extension.${RESULTS_CONTAINER_ID}`
    );


  renderResultsView();

}


/*
 * Return the currently active tab.
 */
function getActiveResultTab():
  ResultTab | undefined {


  if (
    activeResultId ===
    undefined
  ) {

    return undefined;

  }


  return resultTabs
    .find(
      tab =>
        tab.id ===
        activeResultId
    );

}


/*
 * Switch between result tabs.
 */
function selectResultTab(
  id:
    number
): void {


  const exists =
    resultTabs.some(
      tab =>
        tab.id === id
    );


  if (!exists) {
    return;
  }


  activeResultId =
    id;


  renderResultsView();

}


/*
 * Pin or unpin a result.
 */
function toggleResultPin(
  id:
    number
): void {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {
    return;
  }


  tab.pinned =
    !tab.pinned;


  /*
   * Clicking the pin on a tab also
   * makes that tab active.
   */
  activeResultId =
    id;


  renderResultsView();

}


/*
 * Close a result tab.
 */
function closeResultTab(
  id:
    number
): void {


  const index =
    resultTabs
      .findIndex(
        tab =>
          tab.id === id
      );


  if (
    index === -1
  ) {

    return;

  }


  const wasActive =
    activeResultId === id;


  resultTabs.splice(
    index,
    1
  );


  /*
   * If the active tab was closed,
   * select a sensible neighbouring tab.
   */
  if (wasActive) {

    if (
      resultTabs.length ===
      0
    ) {

      activeResultId =
        undefined;

    } else {

      const newIndex =
        Math.min(
          index,
          resultTabs.length - 1
        );


      activeResultId =
        resultTabs[
          newIndex
        ].id;

    }

  }


  renderResultsView();

}


/*
 * Render the whole results panel.
 */
function renderResultsView(): void {


  if (!resultsView) {
    return;
  }


  resultsView.webview.html =
    buildResultsHtml();

}


/*
 * Construct the webview HTML.
 */
function buildResultsHtml():
  string {


  if (
    resultTabs.length ===
    0
  ) {

    return buildWelcomeHtml();

  }


  const activeTab =
    getActiveResultTab()
    ?? resultTabs[0];


  if (
    activeResultId ===
    undefined
  ) {

    activeResultId =
      activeTab.id;

  }


  const tabsHtml =
    resultTabs
      .map(
        tab =>
          buildTabHtml(
            tab,
            tab.id ===
              activeTab.id
          )
      )
      .join('');


  const gridHtml =
    buildGridHtml(
      activeTab
    );


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


  * {
    box-sizing:
      border-box;
  }


  body {
    margin:
      0;

    padding:
      0;

    overflow:
      hidden;

    font-family:
      var(--vscode-font-family);

    font-size:
      var(--vscode-font-size);

    color:
      var(--vscode-foreground);

    background:
      var(--vscode-panel-background);
  }


  /*
   * Results tab strip.
   */
  .tabs {
    display:
      flex;

    align-items:
      stretch;

    height:
      34px;

    overflow-x:
      auto;

    overflow-y:
      hidden;

    border-bottom:
      1px solid
      var(--vscode-panel-border);

    background:
      var(
        --vscode-editorGroupHeader-tabsBackground
      );
  }


  .tab {
    display:
      flex;

    align-items:
      center;

    flex:
      0 0 auto;

    min-width:
      120px;

    height:
      34px;

    padding-left:
      10px;

    border-right:
      1px solid
      var(--vscode-panel-border);

    color:
      var(
        --vscode-tab-inactiveForeground
      );

    background:
      var(
        --vscode-tab-inactiveBackground
      );

    cursor:
      pointer;

    user-select:
      none;
  }


  .tab:hover {
    background:
      var(
        --vscode-list-hoverBackground
      );
  }


  .tab.active {
    color:
      var(
        --vscode-tab-activeForeground
      );

    background:
      var(
        --vscode-tab-activeBackground
      );

    border-top:
      1px solid
      var(
        --vscode-focusBorder
      );
  }


  .tab-title {
    flex:
      1;

    white-space:
      nowrap;
  }


  .tab-pin,
  .tab-close {
    display:
      flex;

    align-items:
      center;

    justify-content:
      center;

    width:
      26px;

    height:
      100%;

    border:
      0;

    padding:
      0;

    color:
      inherit;

    background:
      transparent;

    cursor:
      pointer;

    font-family:
      inherit;
  }


  .tab-pin:hover,
  .tab-close:hover {
    background:
      var(
        --vscode-toolbar-hoverBackground
      );
  }


  .tab-pin.pinned {
    color:
      var(
        --vscode-focusBorder
      );
  }


  /*
   * Small result information bar.
   */
  .status {
    display:
      flex;

    align-items:
      center;

    gap:
      14px;

    height:
      30px;

    padding:
      0 10px;

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


  /*
   * Result grid.
   */
  .grid-wrap {
    overflow:
      auto;

    width:
      100%;

    height:
      calc(
        100vh - 64px
      );
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

  <div class="tabs">

    ${tabsHtml}

  </div>


  <div class="status">

    <span>
      ${activeTab.rows.length}
      row${activeTab.rows.length === 1 ? '' : 's'}
    </span>

    <span>
      NULL values are blank
    </span>

    ${
      activeTab.pinned
        ? '<span>Pinned</span>'
        : ''
    }

  </div>


  ${gridHtml}


<script>

  const vscode =
    acquireVsCodeApi();


  function selectTab(
    id
  ) {

    vscode.postMessage({
      command:
        'selectTab',

      id
    });

  }


  function togglePin(
    event,
    id
  ) {

    event.stopPropagation();

    vscode.postMessage({
      command:
        'togglePin',

      id
    });

  }


  function closeTab(
    event,
    id
  ) {

    event.stopPropagation();

    vscode.postMessage({
      command:
        'closeTab',

      id
    });

  }

</script>

</body>

</html>
`;

}


/*
 * Build one result tab.
 */
function buildTabHtml(
  tab:
    ResultTab,

  active:
    boolean
): string {


  return `
<div
  class="tab ${active ? 'active' : ''}"
  onclick="selectTab(${tab.id})"
>

  <span class="tab-title">
    ${escapeHtml(tab.title)}
  </span>


  <button
    class="tab-pin ${tab.pinned ? 'pinned' : ''}"
    title="${tab.pinned ? 'Unpin result' : 'Pin result'}"
    onclick="togglePin(event, ${tab.id})"
  >
    ${tab.pinned ? '📌' : '○'}
  </button>


  <button
    class="tab-close"
    title="Close result"
    onclick="closeTab(event, ${tab.id})"
  >
    ×
  </button>

</div>
`;

}


/*
 * Build the active result grid.
 */
function buildGridHtml(
  tab:
    ResultTab
): string {


  const columns =
    getColumns(
      tab.rows
    );


  const headerHtml =
    columns
      .map(
        column =>
          `<th>${escapeHtml(column)}</th>`
      )
      .join('');


  const bodyHtml =
    tab.rows.length ===
      0

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

      : tab.rows
          .map(
            row => {

              const cells =
                columns
                  .map(
                    column => {

                      const value =
                        row[column];


                      return `
                        <td>
                          ${formatCell(value)}
                        </td>
                      `;

                    }
                  )
                  .join('');


              return `
                <tr>
                  ${cells}
                </tr>
              `;

            }
          )
          .join('');


  return `
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
`;

}


/*
 * Initial message.
 */
function buildWelcomeHtml():
  string {


  return `
<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<style>

  body {
    margin:
      0;

    padding:
      14px;

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
      var(
        --vscode-descriptionForeground
      );
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
 * Determine grid columns.
 */
function getColumns(
  rows:
    Array<Record<string, unknown>>
): string[] {


  const columns:
    string[] = [];


  const seen =
    new Set<string>();


  for (
    const row of rows
  ) {

    for (
      const key of
        Object.keys(row)
    ) {

      if (
        !seen.has(key)
      ) {

        seen.add(key);

        columns.push(
          key
        );

      }

    }

  }


  return columns;

}


/*
 * Format individual values.
 *
 * Oracle NULL / undefined values
 * deliberately render as blank.
 */
function formatCell(
  value:
    unknown
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
    typeof value ===
    'object'
  ) {

    try {

      return escapeHtml(
        JSON.stringify(
          value
        )
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
 * Prevent returned values being
 * interpreted as HTML.
 */
function escapeHtml(
  value:
    string
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