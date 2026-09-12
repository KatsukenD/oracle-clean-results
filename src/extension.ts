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
 * Oracle NLS settings used for displaying
 * DATE and TIMESTAMP values.
 */
interface NlsSettings {

  dateFormat:
    string;

  timestampFormat:
    string;

}


/*
 * Metadata returned by the Oracle
 * SQL Developer ResultSet.
 */
interface ColumnMetadata {

  name:
    string;

  dataType:
    string;

  precision?:
    number;

  scale?:
    number;

  isNullable?:
    number;

}


/*
 * A single results tab.
 */
interface ResultTab {

  id:
    number;

  title:
    string;

  rows:
    Array<Record<string, unknown>>;

  metadata:
    ColumnMetadata[];

  pinned:
    boolean;

  nlsSettings:
    NlsSettings;

}


/*
 * Messages received from the results webview.
 */
interface WebviewMessage {

  command:
    | 'selectTab'
    | 'togglePin'
    | 'closeTab';

  id:
    number;

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
    webviewView:
      vscode.WebviewView,

    _context:
      vscode.WebviewViewResolveContext,

    _token:
      vscode.CancellationToken
  ): void {

    resultsView =
      webviewView;


    webviewView.webview.options = {
      enableScripts: true
    };


    renderResultsView();


    webviewView.webview
      .onDidReceiveMessage(
        (
          message:
            WebviewMessage
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


  const provider =
    new ResultsViewProvider();


  context.subscriptions.push(

    vscode.window
      .registerWebviewViewProvider(
        ResultsViewProvider.viewType,
        provider
      )

  );


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
   * after their rows and metadata are read.
   */

}


/*
 * Execute either:
 *
 * 1. selected SQL, or
 * 2. the statement containing the cursor.
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


  if (!selection.isEmpty) {

    sql =
      editor.document
        .getText(
          selection
        )
        .trim();

  } else {

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


  /*
   * Capture the current Oracle session
   * DATE and TIMESTAMP display formats.
   */
  const nlsSettings =
    await getNlsSettings(
      session
    );


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


      const metadata:
        ColumnMetadata[] =
          resultSet.metadata()
            .map(
              column => ({
                name:
                  String(
                    column.name ??
                    ''
                  ),

                dataType:
                  String(
                    column.dataType ??
                    'UNKNOWN'
                  ),

                precision:
                  typeof column.precision ===
                    'number'
                    ? column.precision
                    : undefined,

                scale:
                  typeof column.scale ===
                    'number'
                    ? column.scale
                    : undefined,

                isNullable:
                  typeof column.isNullable ===
                    'number'
                    ? column.isNullable
                    : undefined
              })
            );


      await addQueryResult(
        rows,
        metadata,
        nlsSettings
      );


  } finally {

    if (resultSet) {

      await resultSet.close();

    }

  }

}


/*
 * Read display-related NLS settings
 * from the current Oracle session.
 */
async function getNlsSettings(
  session:
    NonNullable<Worksheet['session']>
): Promise<NlsSettings> {


  let nlsResultSet:
    ResultSet | undefined;


  try {

    nlsResultSet =
      await session.executeQuery(

        {
          sql: `
            select parameter,
                   value
            from nls_session_parameters
            where parameter in (
              'NLS_DATE_FORMAT',
              'NLS_TIMESTAMP_FORMAT'
            )
          `
        },

        {
          pageSize:
            10
        }

      );


    const rows =
      nlsResultSet.rows();


    let dateFormat =
      'DD-MON-RR';

    let timestampFormat =
      'DD-MON-RR HH.MI.SSXFF AM';


    for (
      const row of rows
    ) {

      const parameter =
        getRowValue(
          row,
          'PARAMETER'
        );

      const value =
        getRowValue(
          row,
          'VALUE'
        );


      if (
        parameter ===
        undefined ||
        value ===
        undefined
      ) {

        continue;

      }


      const parameterName =
        String(
          parameter
        )
          .toUpperCase();


      const formatValue =
        String(
          value
        );


      if (
        parameterName ===
        'NLS_DATE_FORMAT'
      ) {

        dateFormat =
          formatValue;

      }


      if (
        parameterName ===
        'NLS_TIMESTAMP_FORMAT'
      ) {

        timestampFormat =
          formatValue;

      }

    }


    return {
      dateFormat,
      timestampFormat
    };


  } finally {

    if (nlsResultSet) {

      await nlsResultSet.close();

    }

  }

}


/*
 * Retrieve a row value without depending
 * on Oracle returning a particular case
 * for the column name.
 */
function getRowValue(
  row:
    Record<string, unknown>,

  columnName:
    string
): unknown {


  const matchingKey =
    Object.keys(row)
      .find(
        key =>
          key.toUpperCase() ===
          columnName.toUpperCase()
      );


  if (!matchingKey) {

    return undefined;

  }


  return row[
    matchingKey
  ];

}


/*
 * Add results to the tab manager.
 *
 * An unpinned active tab is reused.
 * A pinned active tab causes a new tab.
 */
async function addQueryResult(
  rows:
    Array<Record<string, unknown>>,

  metadata:
    ColumnMetadata[],

  nlsSettings:
    NlsSettings
): Promise<void> {


  const activeTab =
    getActiveResultTab();


  if (
    activeTab &&
    !activeTab.pinned
  ) {

    activeTab.rows =
      rows;

    activeTab.metadata =
      metadata;

    activeTab.nlsSettings =
      nlsSettings;

  } else {

    const newTab:
      ResultTab = {

        id:
          nextResultNumber,

        title:
          `Results ${nextResultNumber}`,

        rows,

        metadata,

        pinned:
          false,

        nlsSettings

      };


    nextResultNumber++;


    resultTabs.push(
      newTab
    );


    activeResultId =
      newTab.id;

  }


  await vscode.commands
    .executeCommand(
      `workbench.view.extension.${RESULTS_CONTAINER_ID}`
    );


  renderResultsView();

}


/*
 * Return the active results tab.
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
 * Switch result tabs.
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
 * Pin or unpin a result tab.
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
 * Render the complete results panel.
 */
function renderResultsView(): void {


  if (!resultsView) {

    return;

  }


  resultsView.webview.html =
    buildResultsHtml();

}


/*
 * Build the full webview HTML.
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

    overflow-x:
      auto;

    overflow-y:
      hidden;

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

    <span>
      NLS_DATE_FORMAT:
      ${escapeHtml(
        activeTab.nlsSettings.dateFormat
      )}
    </span>

    <span>
      NLS_TIMESTAMP_FORMAT:
      ${escapeHtml(
        activeTab.nlsSettings.timestampFormat
      )}
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
 *
 * Column order and datatype information
 * come directly from Oracle metadata.
 */
function buildGridHtml(
  tab:
    ResultTab
): string {


  const columns =
    getColumns(
      tab
    );


  const headerHtml =
    columns
      .map(
        column =>
          `<th>${escapeHtml(column.name)}</th>`
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
                        getRowValue(
                          row,
                          column.name
                        );


                      return `
                        <td>
                          ${formatCell(
                            value,
                            column,
                            tab.nlsSettings
                          )}
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
 * Return Oracle metadata when available.
 *
 * The fallback exists only as protection
 * in case a future ResultSet does not
 * provide metadata for some reason.
 */
function getColumns(
  tab:
    ResultTab
): ColumnMetadata[] {


  if (
    tab.metadata.length >
    0
  ) {

    return tab.metadata;

  }


  const columns:
    ColumnMetadata[] = [];

  const seen =
    new Set<string>();


  for (
    const row of tab.rows
  ) {

    for (
      const key of
        Object.keys(row)
    ) {

      if (
        !seen.has(key)
      ) {

        seen.add(
          key
        );


        columns.push({
          name:
            key,

          dataType:
            'UNKNOWN'
        });

      }

    }

  }


  return columns;

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
 * Format a database value according
 * to its actual Oracle datatype.
 */
function formatCell(
  value:
    unknown,

  column:
    ColumnMetadata,

  nlsSettings:
    NlsSettings
): string {


  /*
   * The original purpose of this extension:
   * genuine database NULLs display blank.
   */
  if (
    value === null ||
    value === undefined
  ) {

    return '';

  }


  const dataType =
    column.dataType
      ?.toUpperCase()
    ?? '';


  /*
   * Oracle DATE.
   */
  if (
    dataType ===
    'DATE'
  ) {

    if (
      typeof value ===
      'string'
    ) {

      return escapeHtml(
        formatOracleTemporalString(
          value,
          nlsSettings.dateFormat
        )
      );

    }


    if (
      value instanceof Date
    ) {

      return escapeHtml(
        formatTemporalParts(
          getPartsFromDate(
            value
          ),
          nlsSettings.dateFormat
        )
      );

    }

  }


  /*
   * Oracle TIMESTAMP.
   *
   * Using startsWith also gives sensible
   * behaviour if Oracle exposes a more
   * specific TIMESTAMP datatype name.
   */
  if (
    dataType.startsWith(
      'TIMESTAMP'
    )
  ) {

    if (
      typeof value ===
      'string'
    ) {

      return escapeHtml(
        formatOracleTemporalString(
          value,
          nlsSettings.timestampFormat
        )
      );

    }


    if (
      value instanceof Date
    ) {

      return escapeHtml(
        formatTemporalParts(
          getPartsFromDate(
            value
          ),
          nlsSettings.timestampFormat
        )
      );

    }

  }


  /*
   * Do not interpret VARCHAR2 or other
   * character values as dates simply
   * because they happen to look like one.
   */
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
 * Components of an Oracle DATE/TIMESTAMP.
 */
interface TemporalParts {

  year:
    number;

  month:
    number;

  day:
    number;

  hours:
    number;

  minutes:
    number;

  seconds:
    number;

  fractionalSeconds:
    string;

}


/*
 * Parse the ISO-style temporal strings
 * returned by Oracle SQL Developer.
 *
 * Examples:
 *
 * 2026-09-12T18:30
 * 2026-09-12T18:30:45
 * 2026-09-12T18:30:45.123456
 */
function parseOracleTemporalString(
  value:
    string
): TemporalParts | undefined {


  const match =
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
    );


  if (!match) {

    return undefined;

  }


  return {

    year:
      Number(
        match[1]
      ),

    month:
      Number(
        match[2]
      ),

    day:
      Number(
        match[3]
      ),

    hours:
      Number(
        match[4]
      ),

    minutes:
      Number(
        match[5]
      ),

    seconds:
      Number(
        match[6] ??
        '0'
      ),

    fractionalSeconds:
      match[7] ??
      ''

  };

}


/*
 * Apply the required NLS format to an
 * Oracle-returned temporal string.
 */
function formatOracleTemporalString(
  value:
    string,

  format:
    string
): string {


  const parts =
    parseOracleTemporalString(
      value
    );


  if (!parts) {

    return value;

  }


  return formatTemporalParts(
    parts,
    format
  );

}


/*
 * Fallback for a genuine JavaScript Date.
 */
function getPartsFromDate(
  value:
    Date
): TemporalParts {


  return {

    year:
      value.getFullYear(),

    month:
      value.getMonth() + 1,

    day:
      value.getDate(),

    hours:
      value.getHours(),

    minutes:
      value.getMinutes(),

    seconds:
      value.getSeconds(),

    fractionalSeconds:
      String(
        value.getMilliseconds()
      )
        .padStart(
          3,
          '0'
        )

  };

}


/*
 * Apply common Oracle DATE/TIMESTAMP
 * format-model tokens.
 *
 * Supported:
 *
 * YYYY
 * RRRR
 * YY
 * RR
 *
 * MM
 * MON
 *
 * DD
 *
 * HH24
 * HH12
 * HH
 *
 * MI
 * SS
 *
 * FF
 * FF1 through FF9
 *
 * X
 *
 * AM
 * PM
 */
function formatTemporalParts(
  parts:
    TemporalParts,

  format:
    string
): string {


  const monthNames = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC'
  ];


  const pad =
    (
      number:
        number,

      length =
        2
    ) =>
      String(
        number
      )
        .padStart(
          length,
          '0'
        );


  const hours12 =
    parts.hours %
      12 ===
      0
      ? 12
      : parts.hours %
        12;


  const meridiem =
    parts.hours <
      12
      ? 'AM'
      : 'PM';


  /*
   * Oracle fractional seconds can have
   * up to 9 digits.
   *
   * Pad to 9 so FF1-FF9 can be honoured
   * consistently.
   */
  const fractionalSeconds =
    parts.fractionalSeconds
      .padEnd(
        9,
        '0'
      )
      .slice(
        0,
        9
      );


  /*
   * Longest tokens appear first so
   * HH24 is not mistaken for HH, etc.
   */
  return format.replace(

    /HH24|HH12|YYYY|RRRR|FF[1-9]?|MON|MM|DD|MI|SS|AM|PM|RR|YY|HH|X/gi,

    token => {

      const upperToken =
        token.toUpperCase();


      switch (
        upperToken
      ) {

        case 'YYYY':
        case 'RRRR':

          return String(
            parts.year
          );


        case 'YY':
        case 'RR':

          return pad(
            parts.year %
              100
          );


        case 'MM':

          return pad(
            parts.month
          );


        case 'MON':

          return monthNames[
            parts.month - 1
          ];


        case 'DD':

          return pad(
            parts.day
          );


        case 'HH24':

          return pad(
            parts.hours
          );


        case 'HH12':
        case 'HH':

          return pad(
            hours12
          );


        case 'MI':

          return pad(
            parts.minutes
          );


        case 'SS':

          return pad(
            parts.seconds
          );


        case 'AM':
        case 'PM':

          return meridiem;


        /*
         * Oracle X represents the
         * local radix character.
         *
         * A decimal point is appropriate
         * for our current display purpose.
         */
        case 'X':

          return '.';


        case 'FF':

          /*
           * Bare FF displays the available
           * fractional second precision.
           *
           * If Oracle returned no fractional
           * seconds, display zero.
           */
          return parts.fractionalSeconds
            || '0';


        default:

          /*
           * FF1 through FF9.
           */
          if (
            upperToken.startsWith(
              'FF'
            )
          ) {

            const requestedDigits =
              Number(
                upperToken.substring(
                  2
                )
              );


            if (
              requestedDigits >=
                1 &&
              requestedDigits <=
                9
            ) {

              return fractionalSeconds
                .substring(
                  0,
                  requestedDigits
                );

            }

          }


          return token;

      }

    }

  );

}


/*
 * Prevent returned database values from
 * being interpreted as HTML.
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