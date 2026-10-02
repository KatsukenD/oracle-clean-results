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

const COPY_WITH_HEADERS_COMMAND_ID =
  'oracleCleanResults.copyWithHeaders';

const RESULTS_VIEW_ID =
  'oracleCleanResults.resultsView';

const RESULTS_CONTAINER_ID =
  'oracleCleanResultsContainer';

const DEFAULT_FETCH_SIZE =
  500;

const DEFAULT_MAX_AUTO_COLUMN_WIDTH =
  400;

function getCleanResultsConfiguration():
  vscode.WorkspaceConfiguration {

  return vscode.workspace.getConfiguration(
    'oracleCleanResults'
  );
}

function getNullDisplayText(): string {

  return getCleanResultsConfiguration().get<string>(
    'nullDisplayText',
    ''
  );
}

function getFetchSize(): number {

  return getCleanResultsConfiguration().get<number>(
    'fetchSize',
    DEFAULT_FETCH_SIZE
  );
}

function getAutoFetchOnScroll(): boolean {

  return getCleanResultsConfiguration().get<boolean>(
    'autoFetchOnScroll',
    true
  );
}

function getMaxAutoColumnWidth(): number {

  return getCleanResultsConfiguration().get<number>(
    'maxAutoColumnWidth',
    DEFAULT_MAX_AUTO_COLUMN_WIDTH
  );
}

interface NlsSettings {

  dateFormat:
    string;

  timestampFormat:
    string;

}


interface ColumnMetadata {

  name:
    string;

  rowKey:
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


type SortDirection =
  'asc' |
  'desc';


interface SortState {

  columnIndex:
    number;

  direction:
    SortDirection;

}


interface FilterOption {

  key:
    string;

  label:
    string;

}


interface GridSelection {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

interface OracleQueryError {

  code?:
    string;

  message:
    string;

  action?:
    string;

  causeMessage?:
    string;

  uri?:
    string;

  line?:
    number;

  column?:
    number;

}


interface ResultTab {

  id:
    number;

  title:
    string;

  sql:
    string;

  rows:
    Array<Record<string, unknown>>;

  metadata:
    ColumnMetadata[];

  pinned:
    boolean;

  nlsSettings:
    NlsSettings;

  resultSet?:
    ResultSet;

  hasMore:
    boolean;

  isFetching:
    boolean;

  elapsedMs:
    number;

  columnWidths:
    number[];

  sortState?:
    SortState[];

  displayRowsCache?:
    Array<Record<string, unknown>>;

  filters?:
    Map<number, Set<string>>;

  filterKeyCache?:
    Map<number, string[]>;

  selection?:
    GridSelection;

  selectedColumns?:
    number[];

  error?:
    OracleQueryError;

  sourceDocumentUri?:
    string;

  sourceStartOffset?:
    number;

}


interface WebviewMessage {

  command:
    | 'selectTab'
    | 'togglePin'
    | 'closeTab'
    | 'fetchMore'
    | 'fetchAll'
    | 'requestRows'
    | 'resizeColumn'
    | 'autoFitColumn'
    | 'sortColumn'
    | 'requestColumnDetails'
    | 'requestFilterOptions'
    | 'applyFilter'
    | 'setSelection'
    | 'copySelection'
    | 'copyQuery'
    | 'openErrorHelp'
    | 'goToError'
    | 'exportResults';

  id:
    number;

  start?:
    number;

  end?:
    number;

  columnIndex?:
    number;

  width?:
    number;

  selectedKeys?:
    string[];

  startRow?: number;
  endRow?: number;
  startColumn?: number;
  endColumn?: number;
  includeHeaders?: boolean;
  selectedColumns?: number[];
  multiSort?: boolean;

}


let resultsView:
  vscode.WebviewView | undefined;

let resultTabs:
  ResultTab[] = [];

let activeResultId:
  number | undefined;

let nextResultNumber =
  1;

const outputChannel =
  vscode.window.createOutputChannel(
    'Oracle Clean Results'
  );

function diagnosticTimestamp(): string {
  return new Date().toISOString();
}

function diagnosticElapsed(startTime: number): string {
  return `${Date.now() - startTime} ms`;
}

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

          void handleWebviewMessage(
            message
          );

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


async function handleWebviewMessage(
  message:
    WebviewMessage
): Promise<void> {


  try {

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

        await closeResultTab(
          message.id
        );

        break;


      case 'fetchMore':

        await fetchMoreRows(
          message.id
        );

        break;


      case 'fetchAll':

        await fetchAllRows(
          message.id
        );

        break;


      case 'requestRows':

        await sendVirtualRows(
          message.id,
          message.start ?? 0,
          message.end ?? 0
        );

        break;


      case 'resizeColumn':

        resizeResultColumn(
          message.id,
          message.columnIndex ?? -1,
          message.width ?? 0
        );

        break;


      case 'autoFitColumn':

        await autoFitResultColumn(
          message.id,
          message.columnIndex ?? -1
        );

        break;


      case 'sortColumn':

        await sortResultColumn(
          message.id,
          message.columnIndex ?? -1,
          message.multiSort ?? false
        );

        break;


      case 'requestColumnDetails':

        await sendColumnDetails(
          message.id,
          message.columnIndex ?? -1
        );

        break;


      case 'requestFilterOptions':

        await sendFilterOptions(
          message.id,
          message.columnIndex ?? -1
        );

        break;


      case 'applyFilter':

        await applyResultFilter(
          message.id,
          message.columnIndex ?? -1,
          message.selectedKeys ?? []
        );

        break;

      case 'setSelection':

        setResultSelection(
          message.id,
          message.startRow ?? -1,
          message.endRow ?? -1,
          message.startColumn ?? -1,
          message.endColumn ?? -1,
          message.selectedColumns
        );

        break;

      case 'copySelection':

        await copyResultSelection(
          message.id,
          Boolean(message.includeHeaders)
        );

        break;


      case 'copyQuery':

        await copyResultQuery(
          message.id
        );

        break;


      case 'openErrorHelp':

        await openResultErrorHelp(
          message.id
        );

        break;


      case 'goToError':

        await goToResultError(
          message.id
        );

        break;


      case 'exportResults':

        await exportResults(
          message.id
        );

        break;

    }

  } catch (
    error
  ) {

    const messageText =
      error instanceof Error
        ? error.message
        : String(error);


    void vscode.window
      .showErrorMessage(
        `Oracle Clean Results: ${messageText}`
      );

  }

}


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


  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      event => {

        if (
          event.affectsConfiguration(
            'oracleCleanResults'
          )
        ) {

          renderResultsView();

        }

      }
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


  const copyWithHeadersDisposable =
    vscode.commands.registerCommand(
      COPY_WITH_HEADERS_COMMAND_ID,
      async () => {

        if (
          activeResultId ===
          undefined
        ) {

          return;

        }


        await copyResultSelection(
          activeResultId,
          true
        );

      }
    );


  context.subscriptions.push(
    copyWithHeadersDisposable
  );

}


export async function deactivate():
  Promise<void> {


  for (
    const tab of resultTabs
  ) {

    await closeTabResultSet(
      tab
    );

  }

}


/*
 * Main execution entry point.
 *
 * No selection:
 *   Run the statement containing the cursor.
 *
 * Selection:
 *   Split selected SELECT statements and run
 *   each one into its own results tab.
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


  /*
   * Existing behaviour:
   *
   * No selection means ask Oracle which
   * statement contains the cursor.
   */
if (
  selection.isEmpty
) {

  const documentSql =
    editor.document
      .getText();


  const cursorOffset =
    editor.document
      .offsetAt(
        editor.selection.active
      );


  const sql =
    findStatementAtOffset(
      documentSql,
      cursorOffset
    );


  if (!sql) {

    throw new Error(
      'No SQL statement was found ' +
      'at the current cursor position.'
    );

  }


  if (
    !isSelectStatement(
      sql
    )
  ) {

    throw new Error(
      'The current statement is not a SELECT query. ' +
      'Clean Results currently supports SELECT and WITH queries only.'
    );

  }


  const statementOffset =
    findStatementSourceOffset(
      documentSql,
      sql,
      cursorOffset
    );


  await executeCleanQuery(
    session,
    sql,
    false,
    editor.document.uri.toString(),
    statementOffset
  );


  await vscode.window.showTextDocument(
    editor.document,
    {
      viewColumn:
        editor.viewColumn,

      preserveFocus:
        false,

      preview:
        false
    }
  );


  return;

}


  /*
   * New v0.0.7 behaviour:
   *
   * A selection may contain one or
   * several SELECT statements.
   */
  const selectedSql =
    editor.document
      .getText(
        selection
      );


  const statements =
    splitSelectedStatements(
      selectedSql
    );

  if (
    statements.length ===
    0
  ) {

    throw new Error(
      'No SQL statements were found ' +
      'in the selected text.'
    );

  }


  /*
   * v0.0.7 deliberately supports
   * SELECT / WITH queries only.
   */
  for (
    let index = 0;
    index < statements.length;
    index++
  ) {

    const statement =
      statements[
        index
      ];


    if (
      !isSelectStatement(
        statement
      )
    ) {

      throw new Error(
        `Statement ${index + 1} of ` +
        `${statements.length} is not a SELECT query. ` +
        'Multiple-statement Clean Results currently ' +
        'supports SELECT and WITH queries only.'
      );

    }

  }


  /*
   * Execute sequentially.
   *
   * First query behaves normally and may
   * replace the active unpinned tab.
   *
   * Every subsequent query is forced into
   * a new results tab.
   */
  let selectionSearchOffset =
    0;


  for (
    let index = 0;
    index < statements.length;
    index++
  ) {

    const statement =
      statements[index];

    const relativeOffset =
      selectedSql.indexOf(
        statement,
        selectionSearchOffset
      );

    const statementOffset =
      relativeOffset >= 0
        ? editor.document.offsetAt(selection.start) + relativeOffset
        : undefined;

    if (relativeOffset >= 0) {
      selectionSearchOffset =
        relativeOffset + statement.length;
    }

    await executeCleanQuery(
      session,
      statement,
      index > 0,
      editor.document.uri.toString(),
      statementOffset
    );

  }


  await vscode.window.showTextDocument(
    editor.document,
    {
      viewColumn:
        editor.viewColumn,

      preserveFocus:
        false,

      preview:
        false
    }
  );

}


/*
 * Execute one SELECT and create/update
 * its Clean Results tab.
 */
async function executeCleanQuery(
  session:
    NonNullable<Worksheet['session']>,

  sql:
    string,

  forceNewTab:
    boolean,

  sourceDocumentUri?:
    string,

  sourceStatementOffset?:
    number
): Promise<void> {


  const executionDiagnosticStart = Date.now();

  outputChannel.appendLine(
    `[${diagnosticTimestamp()}] Clean Results execution started`
  );

  const nlsDiagnosticStart = Date.now();

  outputChannel.appendLine(
    `[${diagnosticTimestamp()}] Getting NLS settings...`
  );

  const nlsSettings =
    await getNlsSettings(
      session
    );

  outputChannel.appendLine(
    `[${diagnosticTimestamp()}] NLS settings returned (${diagnosticElapsed(nlsDiagnosticStart)})`
  );


  let resultSet:
    ResultSet | undefined;


  const startTime =
    Date.now();


  const executableSql =
    removeLeadingComments(
      sql
    )
      .trim();


  const executableOffsetWithinStatement =
    sql.indexOf(
      executableSql
    );

  const sourceStartOffset =
    sourceStatementOffset !== undefined &&
    executableOffsetWithinStatement >= 0
      ? sourceStatementOffset + executableOffsetWithinStatement
      : undefined;


  try {

    const executeQueryDiagnosticStart = Date.now();

    outputChannel.appendLine(
      `[${diagnosticTimestamp()}] Calling session.executeQuery()...`
    );

    resultSet =
      await session.executeQuery(

        {
          sql:
            executableSql
        },

        {
          pageSize:
            getFetchSize()
        }

      );

    outputChannel.appendLine(
      `[${diagnosticTimestamp()}] session.executeQuery() returned (${diagnosticElapsed(executeQueryDiagnosticStart)})`
    );

    const rowsDiagnosticStart = Date.now();

    const rows =
      resultSet.rows();

    outputChannel.appendLine(
      `[${diagnosticTimestamp()}] Initial rows returned: ${rows.length} (${diagnosticElapsed(rowsDiagnosticStart)})`
    );

const rowKeys =
  rows.length > 0
    ? Object.keys(rows[0])
    : [];


const metadata:
  ColumnMetadata[] =
    resultSet.metadata()
      .map(
        (
          column,
          columnIndex
        ) => ({

          name:
            rowKeys[columnIndex] ??
            String(
              column.name ??
              ''
            ),

          rowKey:
            rowKeys[columnIndex] ??
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


    const hasNextDiagnosticStart = Date.now();

    const hasMore =
      await resultSet.hasNext();

    outputChannel.appendLine(
      `[${diagnosticTimestamp()}] hasNext() returned ${hasMore} (${diagnosticElapsed(hasNextDiagnosticStart)})`
    );

    const elapsedMs =
      Date.now() -
      startTime;

    outputChannel.appendLine(
      `[${diagnosticTimestamp()}] Query execution pipeline complete (${diagnosticElapsed(executionDiagnosticStart)} total)`
    );


    if (!hasMore) {

      await resultSet.close();

      resultSet =
        undefined;

    }


    await addQueryResult(
      rows,
      metadata,
      nlsSettings,
      resultSet,
      hasMore,
      elapsedMs,
      executableSql,
      forceNewTab
    );


    /*
     * ResultTab now owns the open
     * ResultSet if additional rows exist.
     */
    resultSet =
      undefined;


  } catch (error) {

    outputChannel.appendLine(
      '--- Oracle executeQuery error ---'
    );

    outputChannel.appendLine(
      `Type: ${typeof error}`
    );

    outputChannel.appendLine(
      `String: ${String(error)}`
    );

    if (
      error &&
      typeof error === 'object'
    ) {

      const properties =
        Object.getOwnPropertyNames(error);

      outputChannel.appendLine(
        `Properties: ${properties.join(', ')}`
      );

      for (
        const property of properties
      ) {

        let value:
          unknown;

        try {

          value =
            (error as Record<string, unknown>)[
              property
            ];

        } catch {

          value =
            '[Unable to read property]';

        }

        outputChannel.appendLine(
          `${property}: ${
            typeof value === 'object'
              ? JSON.stringify(value)
              : String(value)
          }`
        );

      }

    }

    outputChannel.appendLine(
      '-------------------------------'
    );


    const oracleError =
      getOracleQueryError(
        error
      );


    if (oracleError) {

      await addQueryError(
        executableSql,
        oracleError,
        forceNewTab,
        sourceDocumentUri,
        sourceStartOffset,
        nlsSettings
      );

      return;

    }


    throw error;

  } finally {

    if (resultSet) {

      await resultSet.close();

    }

  }

}


function getOracleQueryError(
  error:
    unknown
): OracleQueryError | undefined {


  if (
    !error ||
    typeof error !== 'object'
  ) {

    return undefined;

  }


  const candidate =
    error as Record<string, unknown>;


  if (
    typeof candidate.message !== 'string'
  ) {

    return undefined;

  }


  const code =
    typeof candidate.code === 'string'
      ? candidate.code
      : undefined;


  if (
    !code?.startsWith('ORA-')
  ) {

    return undefined;

  }


  return {
    code,
    message:
      candidate.message,
    action:
      typeof candidate.action === 'string'
        ? candidate.action
        : undefined,
    causeMessage:
      typeof candidate.causeMessage === 'string'
        ? candidate.causeMessage
        : undefined,
    uri:
      typeof candidate.uri === 'string'
        ? candidate.uri
        : undefined,
    line:
      typeof candidate.line === 'number'
        ? candidate.line
        : undefined,
    column:
      typeof candidate.column === 'number'
        ? candidate.column
        : undefined
  };

}


async function addQueryError(
  sql:
    string,

  error:
    OracleQueryError,

  forceNewTab:
    boolean,

  sourceDocumentUri?:
    string,

  sourceStartOffset?:
    number,

  nlsSettings?:
    NlsSettings
): Promise<void> {


  const activeTab =
    getActiveResultTab();


  const errorTabValues = {
    sql,
    rows:
      [] as Array<Record<string, unknown>>,
    metadata:
      [] as ColumnMetadata[],
    nlsSettings:
      nlsSettings ?? {
        dateFormat:
          'DD-MON-RR',
        timestampFormat:
          'DD-MON-RR HH.MI.SSXFF AM'
      },
    resultSet:
      undefined,
    hasMore:
      false,
    isFetching:
      false,
    elapsedMs:
      0,
    columnWidths:
      [] as number[],
    sortState:
      undefined,
    displayRowsCache:
      undefined,
    filters:
      undefined,
    filterKeyCache:
      undefined,
    selection:
      undefined,
    selectedColumns:
      undefined,
    error,
    sourceDocumentUri,
    sourceStartOffset
  };


  if (
    activeTab &&
    !activeTab.pinned &&
    !forceNewTab
  ) {

    await closeTabResultSet(
      activeTab
    );

    Object.assign(
      activeTab,
      errorTabValues
    );

    activeTab.title =
      `Error ${activeTab.id}`;

  } else {

    const id =
      nextResultNumber++;

    const newTab:
      ResultTab = {
        id,
        title:
          `Error ${id}`,
        pinned:
          false,
        ...errorTabValues
      };

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


async function openResultErrorHelp(
  id:
    number
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  const uri =
    tab?.error?.uri;


  if (!uri) {
    return;
  }


  await vscode.env.openExternal(
    vscode.Uri.parse(uri)
  );

}


async function goToResultError(
  id:
    number
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (
    !tab?.error ||
    !tab.sourceDocumentUri ||
    tab.sourceStartOffset === undefined ||
    tab.error.line === undefined ||
    tab.error.column === undefined
  ) {

    void vscode.window.showInformationMessage(
      'Oracle Clean Results: The source location for this error is not available.'
    );

    return;

  }


  const document =
    await vscode.workspace.openTextDocument(
      vscode.Uri.parse(
        tab.sourceDocumentUri
      )
    );


  const sqlLines =
    tab.sql.split(/\r?\n/);

  const errorLineIndex =
    Math.max(
      0,
      Math.min(
        tab.error.line - 1,
        sqlLines.length - 1
      )
    );

  let relativeOffset =
    0;

  for (
    let index = 0;
    index < errorLineIndex;
    index++
  ) {
    relativeOffset +=
      sqlLines[index].length + 1;
  }

  relativeOffset +=
    Math.max(
      0,
      tab.error.column - 1
    );


  const absoluteOffset =
    Math.min(
      tab.sourceStartOffset + relativeOffset,
      document.getText().length
    );

  const position =
    document.positionAt(
      absoluteOffset
    );

  const editor =
    await vscode.window.showTextDocument(
      document,
      {
        preserveFocus: false,
        preview: false
      }
    );

  editor.selection =
    new vscode.Selection(
      position,
      position
    );

  editor.revealRange(
    new vscode.Range(
      position,
      position
    ),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );

}


/*
 * Split SELECT statements in a selection.
 *
 * We intentionally do not simply use:
 *
 *   text.split(';')
 *
 * because semicolons may legitimately
 * appear inside strings or comments.
 *
 * This parser understands:
 *
 *   'single quoted strings'
 *   "quoted identifiers"
 *   -- line comments
 *   /* block comments * /
 *   Oracle q'[...]' quoting
 *
 * PL/SQL execution is deliberately not
 * supported by the multi-query feature yet.
 */

function findStatementAtOffset(
  text:
    string,

  cursorOffset:
    number
): string | undefined {


  let statementStart =
    0;

  let inSingleQuote =
    false;

  let inDoubleQuote =
    false;

  let inLineComment =
    false;

  let inBlockComment =
    false;

  let inQQuote =
    false;

  let qQuoteEnd =
    '';

  let index =
    0;


  while (
    index <
    text.length
  ) {

    const char =
      text[index];

    const nextChar =
      index + 1 <
        text.length
        ? text[index + 1]
        : '';


    /*
     * Line comment.
     */
    if (
      inLineComment
    ) {

      if (
        char === '\n'
      ) {

        inLineComment =
          false;

      }


      index++;

      continue;

    }


    /*
     * Block comment.
     */
    if (
      inBlockComment
    ) {

      if (
        char === '*' &&
        nextChar === '/'
      ) {

        index +=
          2;

        inBlockComment =
          false;

        continue;

      }


      index++;

      continue;

    }


    /*
     * Oracle q-quoted string.
     */
    if (
      inQQuote
    ) {

      if (
        char === qQuoteEnd &&
        nextChar === "'"
      ) {

        index +=
          2;

        inQQuote =
          false;

        qQuoteEnd =
          '';

        continue;

      }


      index++;

      continue;

    }


    /*
     * Standard single-quoted string.
     */
    if (
      inSingleQuote
    ) {

      if (
        char === "'"
      ) {

        if (
          nextChar === "'"
        ) {

          index +=
            2;

          continue;

        }


        inSingleQuote =
          false;

      }


      index++;

      continue;

    }


    /*
     * Double-quoted identifier.
     */
    if (
      inDoubleQuote
    ) {

      if (
        char === '"'
      ) {

        if (
          nextChar === '"'
        ) {

          index +=
            2;

          continue;

        }


        inDoubleQuote =
          false;

      }


      index++;

      continue;

    }


    /*
     * Start line comment.
     */
    if (
      char === '-' &&
      nextChar === '-'
    ) {

      inLineComment =
        true;

      index +=
        2;

      continue;

    }


    /*
     * Start block comment.
     */
    if (
      char === '/' &&
      nextChar === '*'
    ) {

      inBlockComment =
        true;

      index +=
        2;

      continue;

    }


    /*
     * Start Oracle q quote.
     */
    if (
      (
        char === 'q' ||
        char === 'Q'
      ) &&
      nextChar === "'" &&
      index + 2 <
        text.length
    ) {

      const delimiter =
        text[
          index + 2
        ];


      qQuoteEnd =
        getQQuoteEndDelimiter(
          delimiter
        );


      inQQuote =
        true;

      index +=
        3;

      continue;

    }


    /*
     * Start single quote.
     */
    if (
      char === "'"
    ) {

      inSingleQuote =
        true;

      index++;

      continue;

    }


    /*
     * Start quoted identifier.
     */
    if (
      char === '"'
    ) {

      inDoubleQuote =
        true;

      index++;

      continue;

    }


    /*
     * Statement terminator.
     */
    if (
      char === ';'
    ) {

      const statementEnd =
        index;


      /*
       * Treat the semicolon itself as part
       * of the statement for cursor-location
       * purposes.
       */
      if (
        cursorOffset >=
          statementStart &&
        cursorOffset <=
          index
      ) {

        const statement =
          text
            .substring(
              statementStart,
              statementEnd
            )
            .trim();


        return statement ||
          undefined;

      }


      statementStart =
        index + 1;

    }


    index++;

  }


  /*
   * Final statement may not have a
   * terminating semicolon.
   */
  if (
    cursorOffset >=
      statementStart &&
    cursorOffset <=
      text.length
  ) {

    const statement =
      text
        .substring(
          statementStart
        )
        .trim();


    return statement ||
      undefined;

  }


  return undefined;

}

function findStatementSourceOffset(
  documentSql:
    string,

  sql:
    string,

  cursorOffset:
    number
): number | undefined {


  const beforeCursor =
    documentSql.lastIndexOf(
      sql,
      cursorOffset
    );


  if (beforeCursor >= 0) {
    return beforeCursor;
  }


  const anywhere =
    documentSql.indexOf(
      sql
    );


  return anywhere >= 0
    ? anywhere
    : undefined;

}


function splitSelectedStatements(
  text:
    string
): string[] {


  const statements:
    string[] = [];

  let current =
    '';

  let inSingleQuote =
    false;

  let inDoubleQuote =
    false;

  let inLineComment =
    false;

  let inBlockComment =
    false;

  let inQQuote =
    false;

  let qQuoteEnd =
    '';

  let index =
    0;


  while (
    index <
    text.length
  ) {

    const char =
      text[index];

    const nextChar =
      index + 1 <
        text.length
        ? text[index + 1]
        : '';


    /*
     * Line comment.
     */
    if (
      inLineComment
    ) {

      current +=
        char;


      if (
        char === '\n'
      ) {

        inLineComment =
          false;

      }


      index++;

      continue;

    }


    /*
     * Block comment.
     */
    if (
      inBlockComment
    ) {

      current +=
        char;


      if (
        char === '*' &&
        nextChar === '/'
      ) {

        current +=
          nextChar;

        index +=
          2;

        inBlockComment =
          false;

        continue;

      }


      index++;

      continue;

    }


    /*
     * Oracle q-quoted string.
     *
     * Examples:
     *
     * q'[hello; world]'
     * q'{hello; world}'
     * q'(hello; world)'
     * q'<hello; world>'
     * q'!hello; world!'
     */
    if (
      inQQuote
    ) {

      current +=
        char;


      if (
        char === qQuoteEnd &&
        nextChar === "'"
      ) {

        current +=
          nextChar;

        index +=
          2;

        inQQuote =
          false;

        qQuoteEnd =
          '';

        continue;

      }


      index++;

      continue;

    }


    /*
     * Standard single-quoted string.
     */
    if (
      inSingleQuote
    ) {

      current +=
        char;


      if (
        char === "'"
      ) {

        /*
         * Oracle escaped quote:
         *
         * 'That''s okay'
         */
        if (
          nextChar === "'"
        ) {

          current +=
            nextChar;

          index +=
            2;

          continue;

        }


        inSingleQuote =
          false;

      }


      index++;

      continue;

    }


    /*
     * Double-quoted Oracle identifier.
     */
    if (
      inDoubleQuote
    ) {

      current +=
        char;


      if (
        char === '"'
      ) {

        if (
          nextChar === '"'
        ) {

          current +=
            nextChar;

          index +=
            2;

          continue;

        }


        inDoubleQuote =
          false;

      }


      index++;

      continue;

    }


    /*
     * Start line comment.
     */
    if (
      char === '-' &&
      nextChar === '-'
    ) {

      current +=
        char;

      current +=
        nextChar;

      index +=
        2;

      inLineComment =
        true;

      continue;

    }


    /*
     * Start block comment.
     */
    if (
      char === '/' &&
      nextChar === '*'
    ) {

      current +=
        char;

      current +=
        nextChar;

      index +=
        2;

      inBlockComment =
        true;

      continue;

    }


    /*
     * Start Oracle q quote.
     */
    if (
      (
        char === 'q' ||
        char === 'Q'
      ) &&
      nextChar === "'" &&
      index + 2 <
        text.length
    ) {

      const delimiter =
        text[
          index + 2
        ];


      const matchingDelimiter =
        getQQuoteEndDelimiter(
          delimiter
        );


      current +=
        char;

      current +=
        nextChar;

      current +=
        delimiter;


      qQuoteEnd =
        matchingDelimiter;

      inQQuote =
        true;

      index +=
        3;

      continue;

    }


    /*
     * Start regular single quote.
     */
    if (
      char === "'"
    ) {

      current +=
        char;

      inSingleQuote =
        true;

      index++;

      continue;

    }


    /*
     * Start quoted identifier.
     */
    if (
      char === '"'
    ) {

      current +=
        char;

      inDoubleQuote =
        true;

      index++;

      continue;

    }


    /*
     * Statement terminator.
     *
     * We only treat semicolon as a
     * terminator when outside all quoted
     * strings and comments.
     */
    if (
      char === ';'
    ) {

      const statement =
        current.trim();


      if (
        statement
      ) {

        statements.push(
          statement
        );

      }


      current =
        '';

      index++;

      continue;

    }


    current +=
      char;

    index++;

  }


  /*
   * Last statement does not require
   * a terminating semicolon.
   */
  const finalStatement =
    current.trim();


  if (
    finalStatement
  ) {

    statements.push(
      finalStatement
    );

  }


  return statements;

}


/*
 * Oracle q-quote closing delimiter.
 */
function getQQuoteEndDelimiter(
  delimiter:
    string
): string {


  switch (
    delimiter
  ) {

    case '[':

      return ']';


    case '{':

      return '}';


    case '(':

      return ')';


    case '<':

      return '>';


    default:

      return delimiter;

  }

}


/*
 * Remove leading whitespace/comments
 * sufficiently to determine whether the
 * statement begins SELECT or WITH.
 */
function isSelectStatement(
  sql:
    string
): boolean {


  const cleaned =
    removeLeadingComments(
      sql
    )
      .trimStart();


  return (
    /^select\b/i.test(
      cleaned
    ) ||
    /^with\b/i.test(
      cleaned
    )
  );

}


/*
 * Ignore comments before a SELECT.
 *
 * Example:
 *
 * -- Employee query
 * select ...
 */
function removeLeadingComments(
  sql:
    string
): string {


  let remaining =
    sql;


  while (true) {

    const trimmed =
      remaining.trimStart();


    /*
     * Leading line comment.
     */
    if (
      trimmed.startsWith(
        '--'
      )
    ) {

      const newline =
        trimmed.indexOf(
          '\n'
        );


      if (
        newline ===
        -1
      ) {

        return '';

      }


      remaining =
        trimmed.substring(
          newline + 1
        );

      continue;

    }


    /*
     * Leading block comment.
     */
    if (
      trimmed.startsWith(
        '/*'
      )
    ) {

      const end =
        trimmed.indexOf(
          '*/'
        );


      if (
        end ===
        -1
      ) {

        return '';

      }


      remaining =
        trimmed.substring(
          end + 2
        );

      continue;

    }


    return trimmed;

  }

}


async function getNlsSettings(
  session:
    NonNullable<Worksheet['session']>
): Promise<NlsSettings> {


  let nlsResultSet:
    ResultSet | undefined;

    try {

      const nlsExecuteDiagnosticStart = Date.now();

      outputChannel.appendLine(
        `[${diagnosticTimestamp()}] NLS session.executeQuery() starting...`
      );

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

      outputChannel.appendLine(
        `[${diagnosticTimestamp()}] NLS session.executeQuery() returned (${diagnosticElapsed(nlsExecuteDiagnosticStart)})`
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

    if (
      nlsResultSet
    ) {

      await nlsResultSet.close();

    }

  }

}


function getRowValue(
  row:
    Record<string, unknown>,

  columnName:
    string
): unknown {


  if (
    Object.prototype.hasOwnProperty.call(
      row,
      columnName
    )
  ) {

    return row[
      columnName
    ];

  }


  const upperColumnName =
    columnName.toUpperCase();


  const matchingKey =
    Object.keys(row)
      .find(
        key =>
          key.toUpperCase() ===
          upperColumnName
      );


  if (!matchingKey) {

    return undefined;

  }


  return row[
    matchingKey
  ];

}


function getColumnValue(
  row:
    Record<string, unknown>,

  column:
    ColumnMetadata
): unknown {

  return getRowValue(
    row,
    column.rowKey
  );

}


async function addQueryResult(
  rows:
    Array<Record<string, unknown>>,

  metadata:
    ColumnMetadata[],

  nlsSettings:
    NlsSettings,

  resultSet:
    ResultSet | undefined,

  hasMore:
    boolean,

  elapsedMs:
    number,

  sql:
    string,

  forceNewTab =
    false
): Promise<void> {


  const activeTab =
    getActiveResultTab();


  if (
    activeTab &&
    !activeTab.pinned &&
    !forceNewTab
  ) {

    await closeTabResultSet(
      activeTab
    );


    activeTab.title =
      `Results ${activeTab.id}`;

    activeTab.error =
      undefined;

    activeTab.sourceDocumentUri =
      undefined;

    activeTab.sourceStartOffset =
      undefined;

    activeTab.sql =
      sql;

    activeTab.rows =
      rows;

    activeTab.metadata =
      metadata;

    activeTab.nlsSettings =
      nlsSettings;

    activeTab.resultSet =
      resultSet;

    activeTab.hasMore =
      hasMore;

    activeTab.isFetching =
      false;

    activeTab.elapsedMs =
      elapsedMs;

    activeTab.columnWidths =
      calculateColumnWidths(
        rows,
        metadata,
        nlsSettings
      );

    activeTab.sortState =
      undefined;

    activeTab.displayRowsCache =
      undefined;

    activeTab.filters =
      undefined;

    activeTab.filterKeyCache =
      undefined;

    activeTab.selection =
      undefined;

    activeTab.selectedColumns =
      undefined;

  } else {

    const newTab:
      ResultTab = {

        id:
          nextResultNumber,

        title:
          `Results ${nextResultNumber}`,

        sql,

        rows,

        metadata,

        pinned:
          false,

        nlsSettings,

        resultSet,

        hasMore,

        isFetching:
          false,

        elapsedMs,

        columnWidths:
          calculateColumnWidths(
            rows,
            metadata,
            nlsSettings
          )

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


async function fetchMoreRows(
  id:
    number
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (
    !tab ||
    tab.isFetching ||
    !tab.hasMore ||
    !tab.resultSet
  ) {

    return;

  }


  tab.isFetching =
    true;


  await sendFetchState(
    tab
  );


  const startTime =
    Date.now();


  try {

    await tab.resultSet.next();


    const nextRows =
      tab.resultSet.rows();


    tab.rows.push(
      ...nextRows
    );


    
    invalidateFetchedRowCaches(
      tab
    );

tab.hasMore =
      await tab.resultSet.hasNext();


    tab.elapsedMs +=
      Date.now() -
      startTime;


    if (
      !tab.hasMore
    ) {

      await closeTabResultSet(
        tab
      );

    }

  } catch (
    error
  ) {

    await closeTabResultSet(
      tab
    );


    throw error;

  } finally {

    tab.isFetching =
      false;


    await sendFetchState(
      tab
    );

  }

}


async function fetchAllRows(
  id:
    number
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (
    !tab ||
    tab.isFetching ||
    !tab.hasMore ||
    !tab.resultSet
  ) {

    return;

  }


  tab.isFetching =
    true;


  await sendFetchState(
    tab
  );


  const startTime =
    Date.now();

  let pageCount =
    0;


  try {

    while (
      tab.hasMore &&
      tab.resultSet
    ) {

      await tab.resultSet.next();


      const nextRows =
        tab.resultSet.rows();


      tab.rows.push(
        ...nextRows
      );


      
    invalidateFetchedRowCaches(
      tab
    );

tab.hasMore =
        await tab.resultSet.hasNext();


      pageCount++;


      if (
        pageCount % 5 ===
        0
      ) {

        await sendFetchProgress(
          tab
        );

      }

    }


    tab.elapsedMs +=
      Date.now() -
      startTime;


    if (
      !tab.hasMore
    ) {

      await closeTabResultSet(
        tab
      );

    }

  } catch (
    error
  ) {

    await closeTabResultSet(
      tab
    );


    throw error;

  } finally {

    tab.isFetching =
      false;


    await sendFetchState(
      tab
    );

  }

}


async function sendFetchProgress(
  tab:
    ResultTab
): Promise<void> {


  if (!resultsView) {

    return;

  }


  if (
    activeResultId !==
    tab.id
  ) {

    return;

  }


  await resultsView.webview
    .postMessage({

      command:
        'fetchProgress',

      id:
        tab.id,

      rowCount:
        tab.rows.length,

      hasMore:
        tab.hasMore,

      isFetching:
        tab.isFetching

    });

}


async function sendFetchState(
  tab:
    ResultTab
): Promise<void> {


  if (!resultsView) {

    return;

  }


  if (
    activeResultId !==
    tab.id
  ) {

    return;

  }


  await resultsView.webview
    .postMessage({

      command:
        'fetchState',

      id:
        tab.id,

      rowCount:
        tab.rows.length,

      displayRowCount:
        getDisplayRows(tab).length,

      hasMore:
        tab.hasMore,

      isFetching:
        tab.isFetching,

      elapsedText:
        formatElapsedTime(
          tab.elapsedMs
        )

    });

}


async function sendVirtualRows(
  id:
    number,

  start:
    number,

  end:
    number
): Promise<void> {


  if (!resultsView) {

    return;

  }


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {

    return;

  }


  const columns =
    getColumns(
      tab
    );


  /*
   * v0.0.11 display pipeline.
   *
   * tab.rows always remains the fetched/source
   * dataset. Sorting changes display order only.
   * v0.0.12 filtering can plug in before sorting.
   */
  const displayRows =
    getDisplayRows(
      tab
    );


  const safeStart =
    Math.max(
      0,
      Math.min(
        start,
        displayRows.length
      )
    );


  const safeEnd =
    Math.max(
      safeStart,
      Math.min(
        end,
        displayRows.length
      )
    );


  const rowsHtml =
    displayRows
      .slice(
        safeStart,
        safeEnd
      )
      .map(
        (
          row,
          sliceIndex
        ) => {

          const rowIndex =
            safeStart +
            sliceIndex;


          const cells =
            columns
              .map(
                column => {

                  const value =
                    getColumnValue(
                      row,
                      column
                    );


                  return `
                    <td
                      class="data-cell"
                      data-row="${rowIndex}"
                      data-column="${columns.indexOf(column)}"
                    >
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
            <tr class="virtual-data-row">

              <td
                class="row-number"
                data-row="${rowIndex}"
                data-row-selector="true"
              >
                ${rowIndex + 1}
              </td>

              ${cells}

            </tr>
          `;

        }
      )
      .join('');


  await resultsView.webview
    .postMessage({

      command:
        'virtualRows',

      id:
        tab.id,

      start:
        safeStart,

      end:
        safeEnd,

      totalRows:
        displayRows.length,

      columnCount:
        Math.max(
          columns.length + 1,
          1
        ),

      selection:
        tab.selection ?? null,

      selectedColumns:
        tab.selectedColumns ?? [],

      rowsHtml

    });

}


function invalidateDisplayRows(
  tab:
    ResultTab
): void {


  tab.displayRowsCache =
    undefined;

}


function invalidateFetchedRowCaches(
  tab:
    ResultTab
): void {


  invalidateDisplayRows(
    tab
  );

  tab.filterKeyCache =
    undefined;

}


function getFilterKey(
  value:
    unknown
): string {


  if (
    value === null ||
    value === undefined
  ) {

    return 'null:';

  }


  if (
    value instanceof Date
  ) {

    return 'date:' +
      value.toISOString();

  }


  if (
    typeof value ===
    'object'
  ) {

    try {

      return 'object:' +
        JSON.stringify(value);

    } catch {

      return 'object:' +
        String(value);

    }

  }


  return typeof value +
    ':' +
    String(value);

}


function formatFilterLabel(
  value:
    unknown,

  column:
    ColumnMetadata,

  nlsSettings:
    NlsSettings
): string {


  if (
    value === null ||
    value === undefined
  ) {

    return '(blank)';

  }


  const dataType =
    column.dataType
      ?.toUpperCase()
    ?? '';


  if (
    dataType === 'DATE' ||
    dataType.startsWith(
      'TIMESTAMP'
    )
  ) {

    const temporalValue =
      getOracleTemporalValue(
        value
      );

    const format =
      dataType === 'DATE'
        ? nlsSettings.dateFormat
        : nlsSettings.timestampFormat;


    if (
      typeof temporalValue ===
      'string'
    ) {

      return formatOracleTemporalString(
        temporalValue,
        format
      );

    }


    if (
      temporalValue instanceof Date
    ) {

      return formatTemporalParts(
        getPartsFromDate(
          temporalValue
        ),
        format
      );

    }

  }


  if (
    typeof value ===
    'object'
  ) {

    try {

      return JSON.stringify(value);

    } catch {

      return String(value);

    }

  }


  return String(value);

}


function getFilterKeysForColumn(
  tab:
    ResultTab,

  columnIndex:
    number,

  column:
    ColumnMetadata
): string[] {


  if (!tab.filterKeyCache) {

    tab.filterKeyCache =
      new Map<number, string[]>();

  }


  const cached =
    tab.filterKeyCache.get(
      columnIndex
    );


  if (cached) {

    return cached;

  }


  const keys =
    tab.rows.map(
      row =>
        getFilterKey(
          getColumnValue(
            row,
            column
          )
        )
    );


  tab.filterKeyCache.set(
    columnIndex,
    keys
  );


  return keys;

}


function rowMatchesOtherFilters(
  tab:
    ResultTab,

  rowIndex:
    number,

  excludedColumnIndex:
    number,

  columns:
    ColumnMetadata[]
): boolean {


  for (
    const [
      columnIndex,
      selectedKeys
    ] of tab.filters ?? []
  ) {

    if (
      columnIndex ===
      excludedColumnIndex
    ) {

      continue;

    }


    const column =
      columns[
        columnIndex
      ];


    if (!column) {

      continue;

    }


    const keys =
      getFilterKeysForColumn(
        tab,
        columnIndex,
        column
      );


    if (
      !selectedKeys.has(
        keys[
          rowIndex
        ]
      )
    ) {

      return false;

    }

  }


  return true;

}


function getDistinctFilterOptions(
  tab:
    ResultTab,

  columnIndex:
    number
): FilterOption[] {


  const columns =
    getColumns(tab);

  const column =
    columns[columnIndex];


  if (!column) {

    return [];

  }


  const options =
    new Map<string, string>();


  const filterKeys =
    getFilterKeysForColumn(
      tab,
      columnIndex,
      column
    );


  for (
    let rowIndex = 0;
    rowIndex < tab.rows.length;
    rowIndex++
  ) {

    if (
      !rowMatchesOtherFilters(
        tab,
        rowIndex,
        columnIndex,
        columns
      )
    ) {

      continue;

    }


    const key =
      filterKeys[
        rowIndex
      ];


    if (
      !options.has(key)
    ) {

    const value =
      getColumnValue(
        tab.rows[rowIndex],
        column
      );


      options.set(
        key,
        formatFilterLabel(
          value,
          column,
          tab.nlsSettings
        )
      );

    }

  }


  return Array.from(
    options.entries()
  )
    .map(
      ([key, label]) => ({
        key,
        label
      })
    )
    .sort(
      (left, right) =>
        left.label.localeCompare(
          right.label,
          undefined,
          {
            numeric: true,
            sensitivity: 'base'
          }
        )
    );

}


function getDisplayRows(
  tab:
    ResultTab
): Array<Record<string, unknown>> {


  const hasFilters =
    Boolean(
      tab.filters &&
      tab.filters.size > 0
    );

  const sortState =
    tab.sortState;


  if (
    !hasFilters &&
    (!sortState || sortState.length === 0)
  ) {

    return tab.rows;

  }


  if (
    tab.displayRowsCache
  ) {

    return tab.displayRowsCache;

  }


  const columns =
    getColumns(tab);


  let displayRows:
    Array<Record<string, unknown>>;


  if (hasFilters) {

    const activeFilters =
      Array.from(
        tab.filters ?? []
      )
        .map(
          (
            [
              columnIndex,
              selectedKeys
            ]
          ) => {

            const column =
              columns[
                columnIndex
              ];


            if (!column) {

              return undefined;

            }


            return {
              selectedKeys,
              keys:
                getFilterKeysForColumn(
                  tab,
                  columnIndex,
                  column
                )
            };

          }
        )
        .filter(
          (
            item
          ): item is {
            selectedKeys:
              Set<string>;
            keys:
              string[];
          } =>
            item !== undefined
        );


    displayRows =
      tab.rows.filter(
        (
          _row,
          rowIndex
        ) => {

          for (
            const filter of
              activeFilters
          ) {

            if (
              !filter.selectedKeys.has(
                filter.keys[
                  rowIndex
                ]
              )
            ) {

              return false;

            }

          }


          return true;

        }
      );

  } else {

    displayRows =
      tab.rows.slice();

  }


  if (sortState && sortState.length > 0) {

    displayRows =
      displayRows
        .map(
          (
            row,
            originalIndex
          ) => ({
            row,
            originalIndex
          })
        )
        .sort(
          (left, right) => {

            for (const sort of sortState) {

              const column =
                columns[sort.columnIndex];

              if (!column) {
                continue;
              }

              const leftValue =
                getColumnValue(
                  left.row,
                  column
                );

              const rightValue =
                getColumnValue(
                  right.row,
                  column
                );

              const comparison =
                compareSortValues(
                  leftValue,
                  rightValue,
                  column
                );

              if (comparison !== 0) {

                const hasBlank =
                  leftValue === null ||
                  leftValue === undefined ||
                  rightValue === null ||
                  rightValue === undefined;

                return hasBlank
                  ? comparison
                  : sort.direction === 'asc'
                    ? comparison
                    : -comparison;
              }
            }

            return left.originalIndex -
              right.originalIndex;
          }
        )
        .map(
          item =>
            item.row
        );
  }


  tab.displayRowsCache =
    displayRows;


  return displayRows;

}


async function sendColumnDetails(
  id:
    number,

  columnIndex:
    number
): Promise<void> {


  if (!resultsView) {

    return;

  }


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {

    return;

  }


  const columns =
    getColumns(
      tab
    );


  if (
    columnIndex < 0 ||
    columnIndex >= columns.length
  ) {

    return;

  }


  const column =
    columns[
      columnIndex
    ];


  await resultsView.webview
    .postMessage({

      command:
        'columnDetails',

      id,

      columnIndex,

      column: {
        name:
          column.name,

        dataType:
          column.dataType,

        precision:
          column.precision,

        scale:
          column.scale,

        isNullable:
          column.isNullable
      }

    });

}


async function sendFilterOptions(
  id:
    number,

  columnIndex:
    number
): Promise<void> {


  if (!resultsView) {

    return;

  }


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {

    return;

  }


  const columns =
    getColumns(tab);


  if (
    columnIndex < 0 ||
    columnIndex >= columns.length
  ) {

    return;

  }


  const options =
    getDistinctFilterOptions(
      tab,
      columnIndex
    );

  const activeFilter =
    tab.filters?.get(
      columnIndex
    );


  await resultsView.webview
    .postMessage({

      command:
        'filterOptions',

      id,

      columnIndex,

      columnName:
        columns[columnIndex].name,

      options,

      selectedKeys:
        activeFilter
          ? Array.from(
              activeFilter
            )
          : options.map(
              option =>
                option.key
            ),

      filterActive:
        Boolean(activeFilter)

    });

}


async function applyResultFilter(
  id:
    number,

  columnIndex:
    number,

  selectedKeys:
    string[]
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {

    return;

  }


  const columns =
    getColumns(tab);


  if (
    columnIndex < 0 ||
    columnIndex >= columns.length
  ) {

    return;

  }


  const allKeys =
    getDistinctFilterOptions(
      tab,
      columnIndex
    )
      .map(
        option =>
          option.key
      );

  const selected =
    new Set(selectedKeys);

  const allSelected =
    selected.size ===
      allKeys.length &&
    allKeys.every(
      key =>
        selected.has(key)
    );


  if (!tab.filters) {

    tab.filters =
      new Map<number, Set<string>>();

  }


  if (allSelected) {

    tab.filters.delete(
      columnIndex
    );

  } else {

    tab.filters.set(
      columnIndex,
      selected
    );

  }


  if (
    tab.filters.size === 0
  ) {

    tab.filters =
      undefined;

  }


  invalidateDisplayRows(
    tab
  );


  if (
    resultsView &&
    activeResultId === id
  ) {

    await resultsView.webview
      .postMessage({

        command:
          'filterState',

        id,

        columnIndex,

        filterActive:
          Boolean(
            tab.filters?.has(
              columnIndex
            )
          ),

        displayRowCount:
          getDisplayRows(tab).length,

        fetchedRowCount:
          tab.rows.length

      });

  }

}


function normaliseGridSelection(selection: GridSelection, rowCount: number, columnCount: number): GridSelection | undefined {
  if (rowCount <= 0 || columnCount <= 0) return undefined;
  return {
    startRow: Math.max(0, Math.min(selection.startRow, selection.endRow, rowCount - 1)),
    endRow: Math.max(0, Math.min(Math.max(selection.startRow, selection.endRow), rowCount - 1)),
    startColumn: Math.max(0, Math.min(selection.startColumn, selection.endColumn, columnCount - 1)),
    endColumn: Math.max(0, Math.min(Math.max(selection.startColumn, selection.endColumn), columnCount - 1))
  };
}

function setResultSelection(
  id: number,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  selectedColumns?: number[]
): void {
  const tab = resultTabs.find(item => item.id === id);
  if (!tab) return;

  const columnCount = getColumns(tab).length;

  tab.selection = normaliseGridSelection(
    { startRow, endRow, startColumn, endColumn },
    getDisplayRows(tab).length,
    columnCount
  );

  const validColumns = (selectedColumns ?? [])
    .filter((column, index, values) =>
      Number.isInteger(column) &&
      column >= 0 &&
      column < columnCount &&
      values.indexOf(column) === index
    )
    .sort((left, right) => left - right);

  tab.selectedColumns = validColumns.length > 0
    ? validColumns
    : undefined;
}

function clipboardCellText(value: unknown, column: ColumnMetadata, nlsSettings: NlsSettings): string {
  if (value === null || value === undefined) return '';
  return formatCell(value, column, nlsSettings)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ');
}

async function copyResultSelection(id: number, includeHeaders: boolean): Promise<void> {
  const tab = resultTabs.find(item => item.id === id);
  if (!tab || !tab.selection) return;

  const columns = getColumns(tab);
  const rows = getDisplayRows(tab);
  const s = normaliseGridSelection(tab.selection, rows.length, columns.length);
  if (!s) return;

  const columnIndexes =
    tab.selectedColumns && tab.selectedColumns.length > 0
      ? tab.selectedColumns
      : Array.from(
          { length: s.endColumn - s.startColumn + 1 },
          (_item, offset) => s.startColumn + offset
        );

  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(columnIndexes.map(index => columns[index].name).join('\t'));
  }

  for (let r = s.startRow; r <= s.endRow; r++) {
    const values: string[] = [];
    for (const c of columnIndexes) {
      const column = columns[c];
      values.push(clipboardCellText(getColumnValue(rows[r], column), column, tab.nlsSettings));
    }
    lines.push(values.join('\t'));
  }

  await vscode.env.clipboard.writeText(lines.join('\n'));
}



async function copyResultQuery(
  id: number
): Promise<void> {

  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );

  if (!tab) {
    return;
  }

  await vscode.env.clipboard.writeText(
    tab.sql
  );

  void vscode.window.showInformationMessage(
    'Oracle Clean Results: Query copied to the clipboard.'
  );

}


type ExportFormat =
  'xlsx' |
  'csv' |
  'tsv' |
  'clipboardText' |
  'insertStatements';

type ExportScope =
  'current' |
  'selection' |
  'all';

interface ExportData {
  columns: ColumnMetadata[];
  rows: Array<Record<string, unknown>>;
}


async function exportResults(
  id: number
): Promise<void> {

  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );

  if (!tab) {
    return;
  }


  const formatPick =
    await vscode.window.showQuickPick(
      [
        {
          label: '$(file) Excel Workbook (.xlsx)',
          description: 'Formatted Excel workbook',
          value: 'xlsx' as ExportFormat
        },
        {
          label: '$(file-text) CSV (.csv)',
          description: 'Comma-separated values',
          value: 'csv' as ExportFormat
        },
        {
          label: '$(file-text) TSV (.tsv)',
          description: 'Tab-separated values',
          value: 'tsv' as ExportFormat
        },
        {
          label: '$(clippy) Clipboard: Text',
          description: 'Tab-delimited text with headers',
          value: 'clipboardText' as ExportFormat
        },
        {
          label: '$(code) Clipboard: Insert Statements',
          description: 'Oracle INSERT statements',
          value: 'insertStatements' as ExportFormat
        }
      ],
      {
        title: 'Export Results',
        placeHolder: 'Choose an export format'
      }
    );

  if (!formatPick) {
    return;
  }


  const displayRows =
    getDisplayRows(tab);

  const selection =
    tab.selection
      ? normaliseGridSelection(
          tab.selection,
          displayRows.length,
          getColumns(tab).length
        )
      : undefined;

  const scopeItems = [
    {
      label: '$(list-flat) Current Results',
      description:
        `${displayRows.length} displayed row${displayRows.length === 1 ? '' : 's'}; current filters and sorting`,
      value: 'current' as ExportScope
    }
  ];

  if (selection) {
    const selectedRows =
      selection.endRow -
      selection.startRow +
      1;

    const selectedColumns =
      tab.selectedColumns?.length ??
      (selection.endColumn -
      selection.startColumn +
      1);

    scopeItems.push({
      label: '$(selection) Selected Cells',
      description:
        `${selectedRows} row${selectedRows === 1 ? '' : 's'} × ${selectedColumns} column${selectedColumns === 1 ? '' : 's'}`,
      value: 'selection' as ExportScope
    });
  }

  scopeItems.push({
    label: '$(database) All Results',
    description:
      tab.hasMore
        ? `${tab.rows.length} rows fetched; remaining rows will be fetched before export`
        : `${tab.rows.length} total row${tab.rows.length === 1 ? '' : 's'}; ignores filters and sorting`,
    value: 'all' as ExportScope
  });


  const scopePick =
    await vscode.window.showQuickPick(
      scopeItems,
      {
        title: 'Export Results',
        placeHolder: 'Choose what to export'
      }
    );

  if (!scopePick) {
    return;
  }


  if (
    scopePick.value === 'all' &&
    tab.hasMore
  ) {

    const confirmation =
      await vscode.window.showInformationMessage(
        'More rows are available. Fetch all remaining rows before exporting?',
        {
          modal: true
        },
        'Fetch All and Export'
      );

    if (
      confirmation !==
      'Fetch All and Export'
    ) {
      return;
    }

    await fetchAllRows(
      tab.id
    );
  }


  const exportData =
    getExportData(
      tab,
      scopePick.value
    );

  if (
    exportData.columns.length === 0
  ) {

    void vscode.window.showInformationMessage(
      'Oracle Clean Results: There are no columns to export.'
    );

    return;
  }


  switch (
    formatPick.value
  ) {

    case 'clipboardText':

      await vscode.env.clipboard.writeText(
        buildDelimitedText(
          exportData,
          '\t',
          tab.nlsSettings
        )
      );

      void vscode.window.showInformationMessage(
        `Oracle Clean Results: ${exportData.rows.length} row${exportData.rows.length === 1 ? '' : 's'} copied to the clipboard.`
      );

      return;


    case 'insertStatements':

      await exportInsertStatementsToClipboard(
        tab,
        exportData
      );

      return;


    case 'csv':

      await saveDelimitedExport(
        tab,
        exportData,
        ',',
        'csv'
      );

      return;


    case 'tsv':

      await saveDelimitedExport(
        tab,
        exportData,
        '\t',
        'tsv'
      );

      return;


    case 'xlsx':

      await saveExcelExport(
        tab,
        exportData
      );

      return;

  }

}


function getExportData(
  tab: ResultTab,
  scope: ExportScope
): ExportData {

  const columns =
    getColumns(tab);


  if (
    scope === 'all'
  ) {

    return {
      columns,
      rows:
        tab.rows.slice()
    };

  }


  const displayRows =
    getDisplayRows(tab);


  if (
    scope === 'selection' &&
    tab.selection
  ) {

    const selection =
      normaliseGridSelection(
        tab.selection,
        displayRows.length,
        columns.length
      );

    if (selection) {

      const selectedColumns =
        tab.selectedColumns && tab.selectedColumns.length > 0
          ? tab.selectedColumns.map(index => columns[index])
          : columns.slice(
              selection.startColumn,
              selection.endColumn + 1
            );

      return {
        columns:
          selectedColumns,
        rows:
          displayRows.slice(
            selection.startRow,
            selection.endRow + 1
          )
      };

    }

  }


  return {
    columns,
    rows:
      displayRows.slice()
  };

}


function exportCellText(
  value: unknown,
  column: ColumnMetadata,
  nlsSettings: NlsSettings
): string {

  return clipboardCellText(
    value,
    column,
    nlsSettings
  );

}


function quoteDelimitedValue(
  value: string,
  delimiter: string
): string {

  if (
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(delimiter)
  ) {

    return '"' +
      value.replace(
        /"/g,
        '""'
      ) +
      '"';

  }


  return value;

}


function buildDelimitedText(
  data: ExportData,
  delimiter: string,
  nlsSettings?: NlsSettings
): string {

  const settings =
    nlsSettings ?? {
      dateFormat: 'DD-MON-RR',
      timestampFormat: 'DD-MON-RR HH.MI.SSXFF AM'
    };

  const lines: string[] = [];

  lines.push(
    data.columns
      .map(
        column =>
          quoteDelimitedValue(
            column.name,
            delimiter
          )
      )
      .join(delimiter)
  );


  for (
    const row of data.rows
  ) {

    lines.push(
      data.columns
        .map(
          column =>
            quoteDelimitedValue(
              exportCellText(
                getColumnValue(
                  row,
                  column
                ),
                column,
                settings
              ),
              delimiter
            )
        )
        .join(delimiter)
    );

  }


  return lines.join(
    '\n'
  );

}


async function saveDelimitedExport(
  tab: ResultTab,
  data: ExportData,
  delimiter: string,
  extension: 'csv' | 'tsv'
): Promise<void> {

  const uri =
    await vscode.window.showSaveDialog({
      title:
        `Export Results as ${extension.toUpperCase()}`,
      defaultUri:
        vscode.Uri.file(
          `oracle-results-${tab.id}.${extension}`
        ),
      filters:
        extension === 'csv'
          ? {
              'CSV files': ['csv']
            }
          : {
              'TSV files': ['tsv']
            }
    });

  if (!uri) {
    return;
  }


  const text =
    buildDelimitedText(
      data,
      delimiter,
      tab.nlsSettings
    );

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(
      text,
      'utf8'
    )
  );


  await showExportSuccessMessage(
    uri,
    data.rows.length
  );

}


async function showExportSuccessMessage(
  uri: vscode.Uri,
  rowCount: number
): Promise<void> {

  const action =
    await vscode.window.showInformationMessage(
      `Oracle Clean Results: Exported ${rowCount} row${rowCount === 1 ? '' : 's'} to ${uri.fsPath}.`,
      'Open File'
    );

  if (
    action === 'Open File'
  ) {

    const opened =
      await vscode.env.openExternal(
        uri
      );

    if (!opened) {

      void vscode.window.showWarningMessage(
        `Oracle Clean Results: The exported file could not be opened automatically: ${uri.fsPath}`
      );

    }

  }

}


function excelCellValue(
  value: unknown,
  column: ColumnMetadata
): unknown {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const dataType =
    column.dataType
      ?.toUpperCase()
      ?? '';


  if (
    isNumericDataType(
      dataType
    )
  ) {

    if (
      typeof value ===
      'number'
    ) {
      return value;
    }

    const numericValue =
      Number(value);

    if (
      Number.isFinite(
        numericValue
      )
    ) {
      return numericValue;
    }

  }


  if (
    dataType === 'DATE' ||
    dataType.startsWith(
      'TIMESTAMP'
    )
  ) {

    const temporalValue =
      getOracleTemporalValue(
        value
      );

    const parts =
      typeof temporalValue === 'string'
        ? parseOracleTemporalString(
            temporalValue
          )
        : temporalValue instanceof Date
          ? getPartsFromDate(
              temporalValue
            )
          : undefined;

    if (parts) {

      return new Date(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hours,
        parts.minutes,
        parts.seconds,
        Number(
          (
            parts.fractionalSeconds +
            '000'
          )
            .substring(
              0,
              3
            )
        )
      );

    }

  }


  if (
    typeof value ===
    'object'
  ) {

    try {
      return JSON.stringify(
        value
      );
    } catch {
      return String(
        value
      );
    }

  }


  return value;

}


async function saveExcelExport(
  tab: ResultTab,
  data: ExportData
): Promise<void> {

  const uri =
    await vscode.window.showSaveDialog({
      title:
        'Export Results as Excel Workbook',
      defaultUri:
        vscode.Uri.file(
          `oracle-results-${tab.id}.xlsx`
        ),
      filters: {
        'Excel Workbook': ['xlsx']
      }
    });

  if (!uri) {
    return;
  }


  /*
   * exceljs is deliberately loaded here rather than
   * at extension activation so CSV/clipboard exports
   * do not pay the startup cost.
   */
  const ExcelJS =
    require(
      'exceljs'
    );

  const workbook =
    new ExcelJS.Workbook();

  const worksheet =
    workbook.addWorksheet(
      'Results'
    );


  worksheet.columns =
    data.columns.map(
      (
        column,
        index
      ) => ({
        header:
          column.name,
        key:
          `column_${index}`,
        width:
          Math.max(
            10,
            Math.min(
              60,
              Math.round(
                (
                  tab.columnWidths[index] ??
                  120
                ) / 7
              )
            )
          )
      })
    );


  for (
    const row of data.rows
  ) {

    worksheet.addRow(
      data.columns.map(
        column =>
          excelCellValue(
            getColumnValue(
              row,
              column
            ),
            column
          )
      )
    );

  }


  worksheet.views = [
    {
      state: 'frozen',
      ySplit: 1
    }
  ];


  if (
    data.columns.length > 0 &&
    data.rows.length > 0
  ) {

    worksheet.autoFilter = {
      from: {
        row: 1,
        column: 1
      },
      to: {
        row: 1,
        column:
          data.columns.length
      }
    };

  }


  const headerRow =
    worksheet.getRow(1);

  headerRow.font = {
    bold: true
  };


  const sqlWorksheet =
    workbook.addWorksheet(
      'SQL'
    );

  sqlWorksheet.getColumn(1).width =
    24;

  sqlWorksheet.getColumn(2).width =
    100;

  sqlWorksheet.getCell('A1').value =
    'SQL Statement';

  sqlWorksheet.getCell('A1').font = {
    bold: true
  };

  sqlWorksheet.getCell('A3').value =
    tab.sql;

  sqlWorksheet.getCell('A3').alignment = {
    vertical: 'top',
    wrapText: true
  };

  sqlWorksheet.mergeCells(
    'A3:B3'
  );

  sqlWorksheet.getCell('A5').value =
    'Rows exported';

  sqlWorksheet.getCell('B5').value =
    data.rows.length;

  sqlWorksheet.getCell('A6').value =
    'Exported';

  sqlWorksheet.getCell('B6').value =
    new Date();

  sqlWorksheet.getCell('B6').numFmt =
    'yyyy-mm-dd hh:mm:ss';

  sqlWorksheet.getCell('A7').value =
    'NLS_DATE_FORMAT';

  sqlWorksheet.getCell('B7').value =
    tab.nlsSettings.dateFormat;

  sqlWorksheet.getCell('A8').value =
    'NLS_TIMESTAMP_FORMAT';

  sqlWorksheet.getCell('B8').value =
    tab.nlsSettings.timestampFormat;

  for (
    const rowNumber of [5, 6, 7, 8]
  ) {
    sqlWorksheet.getCell(
      rowNumber,
      1
    ).font = {
      bold: true
    };
  }


  const buffer =
    await workbook.xlsx
      .writeBuffer();


  await vscode.workspace.fs.writeFile(
    uri,
    new Uint8Array(
      buffer
    )
  );


  await showExportSuccessMessage(
    uri,
    data.rows.length
  );

}


function oracleIdentifier(
  name: string
): string {

  if (
    /^[A-Z][A-Z0-9_$#]*$/.test(
      name
    )
  ) {
    return name;
  }


  return '"' +
    name.replace(
      /"/g,
      '""'
    ) +
    '"';

}


function oracleInsertValue(
  value: unknown,
  column: ColumnMetadata
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return 'null';
  }


  const dataType =
    column.dataType
      ?.toUpperCase()
      ?? '';


  if (
    isNumericDataType(
      dataType
    )
  ) {
    return String(
      value
    );
  }


  const temporalValue =
    getOracleTemporalValue(
      value
    );

  const temporalParts =
    typeof temporalValue === 'string'
      ? parseOracleTemporalString(
          temporalValue
        )
      : temporalValue instanceof Date
        ? getPartsFromDate(
            temporalValue
          )
        : undefined;


  if (
    dataType === 'DATE' &&
    temporalParts
  ) {

    const yyyy =
      String(
        temporalParts.year
      )
        .padStart(
          4,
          '0'
        );

    const mm =
      String(
        temporalParts.month
      )
        .padStart(
          2,
          '0'
        );

    const dd =
      String(
        temporalParts.day
      )
        .padStart(
          2,
          '0'
        );

    const hh =
      String(
        temporalParts.hours
      )
        .padStart(
          2,
          '0'
        );

    const mi =
      String(
        temporalParts.minutes
      )
        .padStart(
          2,
          '0'
        );

    const ss =
      String(
        temporalParts.seconds
      )
        .padStart(
          2,
          '0'
        );

    return `to_date('${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}', 'YYYY-MM-DD HH24:MI:SS')`;

  }


  if (
    dataType.startsWith(
      'TIMESTAMP'
    ) &&
    temporalParts
  ) {

    const yyyy =
      String(
        temporalParts.year
      )
        .padStart(
          4,
          '0'
        );

    const mm =
      String(
        temporalParts.month
      )
        .padStart(
          2,
          '0'
        );

    const dd =
      String(
        temporalParts.day
      )
        .padStart(
          2,
          '0'
        );

    const hh =
      String(
        temporalParts.hours
      )
        .padStart(
          2,
          '0'
        );

    const mi =
      String(
        temporalParts.minutes
      )
        .padStart(
          2,
          '0'
        );

    const ss =
      String(
        temporalParts.seconds
      )
        .padStart(
          2,
          '0'
        );

    const fraction =
      temporalParts.fractionalSeconds
        ? `.${temporalParts.fractionalSeconds}`
        : '';

    return `timestamp '${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}${fraction}'`;

  }


  const text =
    typeof value === 'object'
      ? JSON.stringify(
          value
        )
      : String(
          value
        );


  return "'" +
    text.replace(
      /'/g,
      "''"
    ) +
    "'";

}


async function exportInsertStatementsToClipboard(
  tab: ResultTab,
  data: ExportData
): Promise<void> {

  const tableName =
    await vscode.window.showInputBox({
      title:
        'Export Insert Statements',
      prompt:
        'Enter the target table name',
      placeHolder:
        'SCHEMA.TABLE_NAME',
      ignoreFocusOut:
        true,
      validateInput:
        value =>
          value.trim()
            ? undefined
            : 'Enter a table name.'
    });

  if (!tableName) {
    return;
  }


  const trimmedTableName =
    tableName.trim();

  const columnList =
    data.columns
      .map(
        column =>
          oracleIdentifier(
            column.name
          )
      )
      .join(
        ',\n    '
      );


  const statements =
    data.rows.map(
      row => {

        const values =
          data.columns
            .map(
              column =>
                oracleInsertValue(
                  getColumnValue(
                    row,
                    column
                  ),
                  column
                )
            )
            .join(
              ',\n    '
            );


        return (
          `insert into ${trimmedTableName} (\n` +
          `    ${columnList}\n` +
          `) values (\n` +
          `    ${values}\n` +
          `);`
        );

      }
    );


  await vscode.env.clipboard.writeText(
    statements.join(
      '\n\n'
    )
  );


  void vscode.window.showInformationMessage(
    `Oracle Clean Results: ${statements.length} INSERT statement${statements.length === 1 ? '' : 's'} copied to the clipboard.`
  );

}


function compareSortValues(
  left:
    unknown,

  right:
    unknown,

  column:
    ColumnMetadata
): number {


  const leftBlank =
    left === null ||
    left === undefined;

  const rightBlank =
    right === null ||
    right === undefined;


  if (
    leftBlank &&
    rightBlank
  ) {

    return 0;

  }


  /*
   * NULLs are always placed last. The direction
   * is applied to non-NULL values below.
   */
  if (leftBlank) {

    return 1;

  }

  if (rightBlank) {

    return -1;

  }


  const dataType =
    column.dataType
      ?.toUpperCase()
    ?? '';


  if (
    isNumericDataType(
      dataType
    )
  ) {

    const leftNumber =
      Number(left);

    const rightNumber =
      Number(right);


    if (
      Number.isFinite(leftNumber) &&
      Number.isFinite(rightNumber)
    ) {

      return leftNumber -
        rightNumber;

    }

  }


  if (
    dataType === 'DATE' ||
    dataType.startsWith(
      'TIMESTAMP'
    )
  ) {

    const leftTime =
      getSortableTemporalValue(
        left
      );

    const rightTime =
      getSortableTemporalValue(
        right
      );


    if (
      leftTime !== undefined &&
      rightTime !== undefined
    ) {

      return leftTime -
        rightTime;

    }

  }


  return String(left)
    .localeCompare(
      String(right),
      undefined,
      {
        numeric: true,
        sensitivity:
          'base'
      }
    );

}


function isNumericDataType(
  dataType:
    string
): boolean {


  return (
    dataType === 'NUMBER' ||
    dataType === 'FLOAT' ||
    dataType === 'BINARY_FLOAT' ||
    dataType === 'BINARY_DOUBLE' ||
    dataType === 'INTEGER' ||
    dataType === 'DECIMAL' ||
    dataType.startsWith(
      'NUMBER('
    )
  );

}


function getSortableTemporalValue(
  value:
    unknown
): number | undefined {


  const temporalValue =
    getOracleTemporalValue(
      value
    );


  if (
    temporalValue instanceof Date
  ) {

    return temporalValue.getTime();

  }


  if (
    typeof temporalValue !==
    'string'
  ) {

    return undefined;

  }


  const parts =
    parseOracleTemporalString(
      temporalValue
    );


  if (!parts) {

    return undefined;

  }


  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds,
    Number(
      (
        parts.fractionalSeconds +
        '000'
      ).substring(
        0,
        3
      )
    )
  );

}


async function sortResultColumn(
  id:
    number,

  columnIndex:
    number,

  multiSort:
    boolean = false
): Promise<void> {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (!tab) {
    return;
  }


  const columns =
    getColumns(tab);


  if (
    columnIndex < 0 ||
    columnIndex >= columns.length
  ) {
    return;
  }


  const currentSorts =
    tab.sortState ?? [];

  const existingIndex =
    currentSorts.findIndex(
      sort =>
        sort.columnIndex === columnIndex
    );


  if (!multiSort) {

    /*
     * Normal click always returns to a single-column sort.
     * If that column is already the only sort, retain the
     * familiar asc -> desc -> unsorted cycle.
     */
    if (
      currentSorts.length === 1 &&
      existingIndex === 0
    ) {

      const existing =
        currentSorts[0];

      if (existing.direction === 'asc') {
        tab.sortState = [{
          columnIndex,
          direction: 'desc'
        }];
      } else {
        tab.sortState = undefined;
      }

    } else {

      tab.sortState = [{
        columnIndex,
        direction: 'asc'
      }];
    }

  } else {

    /*
     * Shift-click adds a sort level, or cycles just that
     * level asc -> desc -> removed while preserving the rest.
     */
    const nextSorts =
      currentSorts.map(
        sort => ({ ...sort })
      );

    if (existingIndex < 0) {
      nextSorts.push({
        columnIndex,
        direction: 'asc'
      });
    } else if (
      nextSorts[existingIndex].direction === 'asc'
    ) {
      nextSorts[existingIndex] = {
        columnIndex,
        direction: 'desc'
      };
    } else {
      nextSorts.splice(
        existingIndex,
        1
      );
    }

    tab.sortState =
      nextSorts.length > 0
        ? nextSorts
        : undefined;
  }


  invalidateDisplayRows(tab);


  if (
    resultsView &&
    activeResultId === id
  ) {

    await resultsView.webview
      .postMessage({
        command: 'sortState',
        id,
        sorts: tab.sortState ?? []
      });
  }
}


function resizeResultColumn(
  id:
    number,

  columnIndex:
    number,

  width:
    number
): void {

  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );

  if (
    !tab ||
    columnIndex < 0 ||
    columnIndex >= tab.columnWidths.length
  ) {
    return;
  }

  tab.columnWidths[columnIndex] =
    Math.max(
      60,
      Math.round(width)
    );
}


async function autoFitResultColumn(
  id:
    number,

  columnIndex:
    number
): Promise<void> {

  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );

  if (!tab) {
    return;
  }

  const columns =
    getColumns(tab);

  if (
    columnIndex < 0 ||
    columnIndex >= columns.length
  ) {
    return;
  }

  const width =
    calculateColumnWidth(
      tab.rows,
      columns[columnIndex],
      tab.nlsSettings
    );

  tab.columnWidths[columnIndex] =
    width;

  if (
    resultsView &&
    activeResultId === id
  ) {
    await resultsView.webview.postMessage({
      command:
        'columnWidth',
      id,
      columnIndex,
      width
    });
  }
}


async function closeTabResultSet(
  tab:
    ResultTab
): Promise<void> {


  const resultSet =
    tab.resultSet;


  tab.resultSet =
    undefined;


  if (!resultSet) {

    return;

  }


  await resultSet.close();

}


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


function toggleResultPin(
  id:
    number
): void {


  const tab =
    resultTabs.find(
      item =>
        item.id === id
    );


  if (
    !tab ||
    tab.isFetching
  ) {

    return;

  }


  tab.pinned =
    !tab.pinned;


  activeResultId =
    id;


  renderResultsView();

}


async function closeResultTab(
  id:
    number
): Promise<void> {


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


  const tab =
    resultTabs[
      index
    ];


  if (
    tab.isFetching
  ) {

    return;

  }


  const wasActive =
    activeResultId ===
    id;


  await closeTabResultSet(
    tab
  );


  resultTabs.splice(
    index,
    1
  );


  if (
    wasActive
  ) {

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


function renderResultsView(): void {


  if (!resultsView) {

    return;

  }


  resultsView.webview.html =
    buildResultsHtml();

}


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


  const fetchControlsHtml =
    buildFetchControlsHtml(
      activeTab
    );


  const fetchStatusHtml =
    activeTab.isFetching

      ? `
        <span class="fetching-status" id="fetch-status">

          <span class="spinner"></span>

          Fetching...

        </span>
      `

      : `
        <span id="fetch-status">
          ${
            activeTab.error
              ? 'Query failed'
              : activeTab.hasMore
                ? 'More rows available'
                : 'All rows fetched'
          }
        </span>
      `;


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

    /*
     * Grid selection is model-driven. Disable the webview's native text
     * selection everywhere except editable controls, so Ctrl/Cmd+A cannot
     * highlight status text, buttons or headers.
     */
    html,
    body {
      user-select: none;
    }

    input,
    textarea,
    [contenteditable="true"] {
      user-select: text;
    }


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


  button:disabled {
    opacity:
      0.5;

    cursor:
      default;
  }


  .status {
    display:
      flex;

    align-items:
      center;

    gap:
      14px;

    height:
      32px;

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


  .display-info-toggle {
    border:
      0;

    padding:
      0;

    color:
      var(--vscode-textLink-foreground);

    background:
      transparent;

    font:
      inherit;

    cursor:
      pointer;
  }


  .display-info-toggle:hover {
    color:
      var(--vscode-textLink-activeForeground);

    text-decoration:
      underline;
  }


  .display-info {
    display:
      none;

    padding:
      8px 10px;

    border-bottom:
      1px solid
      var(--vscode-panel-border);

    color:
      var(--vscode-descriptionForeground);

    background:
      var(--vscode-editorGroupHeader-tabsBackground);
  }


  .display-info.open {
    display:
      grid;

    grid-template-columns:
      max-content minmax(0, 1fr);

    column-gap:
      18px;

    row-gap:
      5px;
  }


  .display-info-label {
    font-weight:
      600;

    color:
      var(--vscode-foreground);
  }


  .display-info-value {
    min-width:
      0;

    overflow-wrap:
      anywhere;
  }


  .spinner {
    display:
      inline-block;

    width:
      12px;

    height:
      12px;

    border:
      2px solid
      var(--vscode-descriptionForeground);

    border-top-color:
      transparent;

    border-radius:
      50%;

    animation:
      spin 0.8s linear infinite;
  }


  .fetching-status {
    display:
      inline-flex;

    align-items:
      center;

    gap:
      6px;
  }


  @keyframes spin {

    to {
      transform:
        rotate(360deg);
    }

  }


  .fetch-controls {
    display:
      flex;

    align-items:
      center;

    gap:
      6px;
  }


  .fetch-button {
    border:
      0;

    border-radius:
      2px;

    padding:
      3px 8px;

    color:
      var(
        --vscode-button-foreground
      );

    background:
      var(
        --vscode-button-background
      );

    cursor:
      pointer;

    font-family:
      inherit;

    font-size:
      inherit;
  }


  .fetch-button:hover:not(:disabled) {
    background:
      var(
        --vscode-button-hoverBackground
      );
  }


  .fetch-button.secondary {
    color:
      var(
        --vscode-button-secondaryForeground
      );

    background:
      var(
        --vscode-button-secondaryBackground
      );
  }


  .fetch-button.secondary:hover:not(:disabled) {
    background:
      var(
        --vscode-button-secondaryHoverBackground
      );
  }


  .query-dialog {
    width: min(900px, 85vw);
    max-height: 75vh;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 0;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }

  .query-dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  .query-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-weight: 600;
  }

  .query-dialog-body {
    margin: 0;
    padding: 14px;
    max-height: 55vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: normal;
    user-select: text;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.45;
  }

  .query-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--vscode-panel-border);
  }


  .grid-wrap {
    overflow:
      auto;

    width:
      100%;

    height:
      calc(
        100vh - 66px
      );
  }


  table {
    border-collapse:
      collapse;

    table-layout:
      fixed;

    width:
      max-content;
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

    overflow:
      hidden;

    text-overflow:
      ellipsis;

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

  .column-header {
    position:
      sticky;

    top:
      0;

    z-index:
      1;
  }


  .column-header {
    cursor:
      default;
  }

  .sort-indicator {
    cursor:
      pointer;
  }


  .column-header:hover {
    background:
      var(
        --vscode-list-hoverBackground
      );
  }


  .sort-indicator {
    display:
      inline-block;

    min-width:
      14px;

    margin-left:
      6px;

    color:
      var(--vscode-descriptionForeground);

    font-size:
      10px;

    vertical-align:
      middle;
  }


  .column-title {
    vertical-align:
      middle;
  }


  .column-header-menu {
    position:
      fixed;

    z-index:
      10000;

    min-width:
      170px;

    padding:
      4px;

    border:
      1px solid
      var(--vscode-panel-border);

    border-radius:
      4px;

    color:
      var(--vscode-menu-foreground);

    background:
      var(--vscode-menu-background);

    box-shadow:
      0 4px 14px rgba(0, 0, 0, 0.28);
  }


  .column-header-menu-item {
    padding:
      5px 8px;

    border-radius:
      3px;

    cursor:
      default;

    white-space:
      nowrap;
  }


  .column-header-menu-item:hover {
    color:
      var(--vscode-menu-selectionForeground);

    background:
      var(--vscode-menu-selectionBackground);
  }


  .column-details-card {
    position:
      fixed;

    z-index:
      10000;

    min-width:
      240px;

    padding:
      12px;

    border:
      1px solid
      var(--vscode-panel-border);

    border-radius:
      4px;

    color:
      var(--vscode-foreground);

    background:
      var(--vscode-editorWidget-background);

    box-shadow:
      0 4px 14px rgba(0, 0, 0, 0.28);
  }


  .column-details-heading {
    margin-bottom:
      8px;

    font-weight:
      600;
  }


  .column-details-name {
    margin-bottom:
      10px;

    font-weight:
      600;
  }


  .column-details-row {
    display:
      grid;

    grid-template-columns:
      90px 1fr;

    gap:
      12px;

    padding:
      2px 0;
  }


  .column-details-label {
    color:
      var(--vscode-descriptionForeground);
  }


  .column-details-copy {
    margin-top:
      12px;

    padding:
      4px 8px;

    border:
      1px solid
      var(--vscode-button-border, transparent);

    border-radius:
      2px;

    color:
      var(--vscode-button-foreground);

    background:
      var(--vscode-button-background);

    cursor:
      pointer;
  }


  .column-details-copy:hover {
    background:
      var(--vscode-button-hoverBackground);
  }


  .filter-button {
    display:
      inline-flex;

    align-items:
      center;

    justify-content:
      center;

    width:
      20px;

    height:
      20px;

    margin-left:
      2px;

    padding:
      0;

    border:
      0;

    border-radius:
      2px;

    color:
      var(--vscode-descriptionForeground);

    background:
      transparent;

    cursor:
      pointer;

    vertical-align:
      middle;
  }


  .filter-button:hover,
  .filter-button.active {
    color:
      var(--vscode-foreground);

    background:
      var(--vscode-toolbar-hoverBackground);
  }


  .filter-button.active {
    outline:
      1px solid var(--vscode-focusBorder);
  }


  .filter-popup {
    position:
      fixed;

    z-index:
      1000;

    width:
      300px;

    max-height:
      420px;

    display:
      flex;

    flex-direction:
      column;

    border:
      1px solid var(--vscode-widget-border);

    border-radius:
      3px;

    background:
      var(--vscode-menu-background);

    color:
      var(--vscode-menu-foreground);

    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.25);
  }


  .filter-popup-header {
    padding:
      8px 10px 4px;

    font-weight:
      600;
  }


  .filter-search {
    margin:
      4px 8px 6px;

    padding:
      5px 7px;

    border:
      1px solid var(--vscode-input-border);

    color:
      var(--vscode-input-foreground);

    background:
      var(--vscode-input-background);

    font-family:
      inherit;
  }


  .filter-actions {
    display:
      flex;

    gap:
      6px;

    padding:
      0 8px 6px;
  }


  .filter-link {
    border:
      0;

    padding:
      2px 4px;

    color:
      var(--vscode-textLink-foreground);

    background:
      transparent;

    cursor:
      pointer;

    font-family:
      inherit;
  }


  .filter-values {
    overflow-y:
      auto;

    min-height:
      0;

    max-height:
      280px;

    flex:
      1 1 auto;

    border-top:
      1px solid var(--vscode-menu-separatorBackground);

    border-bottom:
      1px solid var(--vscode-menu-separatorBackground);

    padding:
      4px 0;
  }


  .filter-option {
    display:
      flex;

    align-items:
      center;

    gap:
      6px;

    padding:
      3px 10px;

    white-space:
      nowrap;
  }


  .filter-option:hover {
    background:
      var(--vscode-list-hoverBackground);
  }


  .filter-option span {
    overflow:
      hidden;

    text-overflow:
      ellipsis;
  }


  .filter-footer {
    display:
      flex;

    justify-content:
      flex-end;

    gap:
      6px;

    padding:
      8px;
  }


  .filter-apply,
  .filter-cancel {
    border:
      0;

    border-radius:
      2px;

    padding:
      4px 10px;

    font-family:
      inherit;

    cursor:
      pointer;
  }


  .filter-apply {
    color:
      var(--vscode-button-foreground);

    background:
      var(--vscode-button-background);
  }


  .filter-cancel {
    color:
      var(--vscode-button-secondaryForeground);

    background:
      var(--vscode-button-secondaryBackground);
  }


  .column-resizer {
    position:
      absolute;

    top:
      0;

    right:
      -3px;

    width:
      7px;

    height:
      100%;

    cursor:
      col-resize;

    z-index:
      4;

    user-select:
      none;
  }


  .column-resizer:hover {
    border-right:
      1px solid
      var(--vscode-focusBorder);
  }


  body.column-resizing,
  body.column-resizing * {
    cursor:
      col-resize !important;

    user-select:
      none !important;
  }

  .row-number {
    position:
      sticky;

    left:
      0;

    z-index:
      2;

    min-width:
      48px;

    text-align:
      right;

    overflow:
      visible;

    text-overflow:
      clip;

    color:
      var(--vscode-descriptionForeground);

    background:
      var(
        --vscode-editorGroupHeader-tabsBackground
      );

    user-select:
      none;
  }

  th.row-number {
    z-index:
      3;
  }


  #grid-wrap:focus,
  #grid-wrap:focus-visible {
    outline: none;
  }

  .data-cell,
  .row-number[data-row-selector="true"] {
    cursor: default;
    user-select: none;
  }

  .data-cell.grid-selected,
  .row-number.grid-selected,
  .column-header.grid-selected {
    background: var(--vscode-list-activeSelectionBackground) !important;
    color: var(--vscode-list-activeSelectionForeground) !important;
  }

  .virtual-data-row {
    height:
      27px;
  }


  .virtual-spacer td {
    height:
      0;

    padding:
      0;

    border:
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

    ${
      activeTab.error
        ? ''
        : `
    <span id="row-count">
      ${activeTab.rows.length}
      row${activeTab.rows.length === 1 ? '' : 's'}
      fetched
    </span>
        `
    }

    ${fetchStatusHtml}

    ${fetchControlsHtml}

    <span id="elapsed-time">
      ${formatElapsedTime(
        activeTab.elapsedMs
      )}
    </span>

    <button
      class="display-info-toggle"
      id="display-info-toggle"
      type="button"
      onclick="toggleDisplayInfo()"
      aria-expanded="false"
      aria-controls="display-info"
    >
      Display Info ▸
    </button>

    ${
      activeTab.pinned
        ? '<span>Pinned</span>'
        : ''
    }

  </div>


  <div
    class="display-info"
    id="display-info"
  >
    <span class="display-info-label">NULL display</span>
    <span class="display-info-value">
      ${escapeHtml(
        getNullDisplayText() || 'blank'
      )}
    </span>

    <span class="display-info-label">Date format</span>
    <span class="display-info-value">
      ${escapeHtml(
        activeTab.nlsSettings.dateFormat
      )}
    </span>

    <span class="display-info-label">Timestamp format</span>
    <span class="display-info-value">
      ${escapeHtml(
        activeTab.nlsSettings.timestampFormat
      )}
    </span>
  </div>


  ${gridHtml}


<dialog
  class="query-dialog"
  id="query-dialog"
>
  <div class="query-dialog-header">
    <span>${escapeHtml(activeTab.title)} — SQL</span>
  </div>

  <pre class="query-dialog-body">${escapeHtml(activeTab.sql)}</pre>

  <div class="query-dialog-actions">
    <button
      class="fetch-button secondary"
      onclick="copyQuery(${activeTab.id})"
    >
      Copy Query
    </button>

    <button
      class="fetch-button"
      onclick="closeQuery()"
    >
      Close
    </button>
  </div>
</dialog>

<script>

  const vscode =
    acquireVsCodeApi();


  const activeResultId =
    ${activeTab.id};


  const autoFetchOnScroll =
    ${getAutoFetchOnScroll()};


  const webviewState =
    vscode.getState() ?? {};


  let displayInfoOpen =
    Boolean(
      webviewState.displayInfoOpen
    );


  function applyDisplayInfoState() {

    const panel =
      document.getElementById(
        'display-info'
      );

    const toggle =
      document.getElementById(
        'display-info-toggle'
      );


    if (!panel || !toggle) {
      return;
    }


    panel.classList.toggle(
      'open',
      displayInfoOpen
    );

    toggle.textContent =
      displayInfoOpen
        ? 'Display Info ▾'
        : 'Display Info ▸';

    toggle.setAttribute(
      'aria-expanded',
      String(displayInfoOpen)
    );

  }


  function toggleDisplayInfo() {

    displayInfoOpen =
      !displayInfoOpen;

    vscode.setState({
      ...webviewState,
      displayInfoOpen
    });

    applyDisplayInfoState();

  }


  applyDisplayInfoState();


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


  function fetchMore(
    id
  ) {

    vscode.postMessage({
      command:
        'fetchMore',

      id
    });

  }


  function fetchAll(
    id
  ) {

    vscode.postMessage({
      command:
        'fetchAll',

      id
    });

  }


  function showQuery() {

    const dialog =
      document.getElementById(
        'query-dialog'
      );

    if (dialog) {
      dialog.showModal();
    }

  }


  function closeQuery() {

    const dialog =
      document.getElementById(
        'query-dialog'
      );

    if (dialog) {
      dialog.close();
    }

  }


  function copyQuery(
    id
  ) {

    vscode.postMessage({
      command:
        'copyQuery',

      id
    });

  }


  function openErrorHelp(
    id
  ) {

    vscode.postMessage({
      command:
        'openErrorHelp',

      id
    });

  }


  function goToError(
    id
  ) {

    vscode.postMessage({
      command:
        'goToError',

      id
    });

  }


  function exportResults(
    id
  ) {

    vscode.postMessage({
      command:
        'exportResults',

      id
    });

  }


  let openFilterColumn =
    undefined;

  let filterOptions =
    [];

  let filterSelection =
    new Set();


  function closeFilterMenu() {

    const popup =
      document.getElementById(
        'filter-popup'
      );


    if (popup) {

      popup.remove();

    }


    openFilterColumn =
      undefined;

    filterOptions =
      [];

    filterSelection =
      new Set();

  }


  function openFilterMenu(
    event,
    columnIndex
  ) {

    event.preventDefault();
    event.stopPropagation();


    closeFilterMenu();


    openFilterColumn =
      columnIndex;


    vscode.postMessage({
      command:
        'requestFilterOptions',

      id:
        activeResultId,

      columnIndex
    });

  }


  function renderFilterOptions() {

    const values =
      document.getElementById(
        'filter-values'
      );

    const search =
      document.getElementById(
        'filter-search'
      );


    if (!values) {

      return;

    }


    const searchText =
      String(
        search?.value ?? ''
      )
        .toLocaleLowerCase();


    values.innerHTML =
      '';


    for (
      const option of filterOptions
    ) {

      if (
        searchText &&
        !option.label
          .toLocaleLowerCase()
          .includes(searchText)
      ) {

        continue;

      }


      const label =
        document.createElement(
          'label'
        );

      label.className =
        'filter-option';


      const checkbox =
        document.createElement(
          'input'
        );

      checkbox.type =
        'checkbox';

      checkbox.checked =
        filterSelection.has(
          option.key
        );

      checkbox.addEventListener(
        'change',
        () => {

          if (checkbox.checked) {

            filterSelection.add(
              option.key
            );

          } else {

            filterSelection.delete(
              option.key
            );

          }

        }
      );


      const text =
        document.createElement(
          'span'
        );

      text.textContent =
        option.label;

      text.title =
        option.label;


      label.appendChild(
        checkbox
      );

      label.appendChild(
        text
      );

      values.appendChild(
        label
      );

    }

  }


  function setVisibleFilterSelection(
    selected
  ) {

    const search =
      document.getElementById(
        'filter-search'
      );

    const searchText =
      String(
        search?.value ?? ''
      )
        .toLocaleLowerCase();


    for (
      const option of filterOptions
    ) {

      if (
        searchText &&
        !option.label
          .toLocaleLowerCase()
          .includes(searchText)
      ) {

        continue;

      }


      if (selected) {

        filterSelection.add(
          option.key
        );

      } else {

        filterSelection.delete(
          option.key
        );

      }

    }


    renderFilterOptions();

  }


  function applyOpenFilter() {

    if (
      openFilterColumn ===
      undefined
    ) {

      return;

    }


    vscode.postMessage({
      command:
        'applyFilter',

      id:
        activeResultId,

      columnIndex:
        openFilterColumn,

      selectedKeys:
        Array.from(
          filterSelection
        )
    });


    closeFilterMenu();

  }


  function positionFilterPopup() {

    const popup =
      document.getElementById(
        'filter-popup'
      );

    if (
      !popup ||
      openFilterColumn ===
        undefined
    ) {

      return;

    }


    const button =
      document.querySelector(
        '[data-filter-column="' +
        openFilterColumn +
        '"]'
      );


    if (!button) {

      return;

    }


    const rect =
      button.getBoundingClientRect();

    const popupWidth =
      300;

    const margin =
      4;

    const top =
      rect.bottom + 2;

    const availableHeight =
      Math.max(
        0,
        window.innerHeight -
          top -
          margin
      );


    const left =
      Math.max(
        margin,
        Math.min(
          rect.left,
          window.innerWidth -
            popupWidth -
            margin
        )
      );


    popup.style.left =
      left + 'px';

    popup.style.top =
      top + 'px';

    popup.style.maxHeight =
      Math.min(
        420,
        availableHeight
      ) + 'px';

  }


  function showFilterPopup(
    message
  ) {

    if (
      openFilterColumn !==
      message.columnIndex
    ) {

      return;

    }


    filterOptions =
      message.options ?? [];

    filterSelection =
      new Set(
        message.selectedKeys ?? []
      );


    const button =
      document.querySelector(
        '[data-filter-column="' +
        message.columnIndex +
        '"]'
      );


    if (!button) {

      return;

    }


    const popup =
      document.createElement(
        'div'
      );

    popup.id =
      'filter-popup';

    popup.className =
      'filter-popup';


    const header =
      document.createElement(
        'div'
      );

    header.className =
      'filter-popup-header';

    header.textContent =
      message.columnName;


    const search =
      document.createElement(
        'input'
      );

    search.id =
      'filter-search';

    search.className =
      'filter-search';

    search.type =
      'text';

    search.placeholder =
      'Search values';

    search.addEventListener(
      'input',
      renderFilterOptions
    );


    const actions =
      document.createElement(
        'div'
      );

    actions.className =
      'filter-actions';


    const selectAll =
      document.createElement(
        'button'
      );

    selectAll.className =
      'filter-link';

    selectAll.textContent =
      'Select All';

    selectAll.onclick =
      () =>
        setVisibleFilterSelection(
          true
        );


    const clearAll =
      document.createElement(
        'button'
      );

    clearAll.className =
      'filter-link';

    clearAll.textContent =
      'Clear All';

    clearAll.onclick =
      () =>
        setVisibleFilterSelection(
          false
        );


    actions.appendChild(
      selectAll
    );

    actions.appendChild(
      clearAll
    );


    const values =
      document.createElement(
        'div'
      );

    values.id =
      'filter-values';

    values.className =
      'filter-values';


    const footer =
      document.createElement(
        'div'
      );

    footer.className =
      'filter-footer';


    const cancel =
      document.createElement(
        'button'
      );

    cancel.className =
      'filter-cancel';

    cancel.textContent =
      'Cancel';

    cancel.onclick =
      closeFilterMenu;


    const apply =
      document.createElement(
        'button'
      );

    apply.className =
      'filter-apply';

    apply.textContent =
      'Apply';

    apply.onclick =
      applyOpenFilter;


    footer.appendChild(
      cancel
    );

    footer.appendChild(
      apply
    );


    popup.appendChild(
      header
    );

    popup.appendChild(
      search
    );

    popup.appendChild(
      actions
    );

    popup.appendChild(
      values
    );

    popup.appendChild(
      footer
    );

    document.body.appendChild(
      popup
    );


    positionFilterPopup();


    renderFilterOptions();

    search.focus();

  }


  let pendingColumnDetailsPosition =
    undefined;


  function closeColumnHeaderMenu() {

    document
      .getElementById(
        'column-header-menu'
      )
      ?.remove();

  }


  function closeColumnDetailsCard() {

    document
      .getElementById(
        'column-details-card'
      )
      ?.remove();

  }


  function openColumnHeaderMenu(
    event,
    columnIndex
  ) {

    closeColumnHeaderMenu();
    closeColumnDetailsCard();


    pendingColumnDetailsPosition = {
      x:
        event.clientX + 12,

      y:
        event.clientY + 12
    };


    vscode.postMessage({
      command:
        'requestColumnDetails',

      id:
        activeResultId,

      columnIndex
    });

  }

  function showColumnDetailsCard(
    column
  ) {

    closeColumnDetailsCard();


    const card =
      document.createElement(
        'div'
      );

    card.id =
      'column-details-card';

    card.className =
      'column-details-card';


    const heading =
      document.createElement(
        'div'
      );

    heading.className =
      'column-details-heading';

    heading.textContent =
      'Column Details';

    card.appendChild(
      heading
    );


    const name =
      document.createElement(
        'div'
      );

    name.className =
      'column-details-name';

    name.textContent =
      column.name;

    card.appendChild(
      name
    );


    const details = [
      [
        'Datatype',
        column.dataType || 'UNKNOWN'
      ]
    ];


    if (
      typeof column.precision ===
      'number'
    ) {

      details.push([
        'Precision',
        String(
          column.precision
        )
      ]);

    }


    if (
      typeof column.scale ===
      'number'
    ) {

      details.push([
        'Scale',
        String(
          column.scale
        )
      ]);

    }


    if (
      typeof column.isNullable ===
      'number'
    ) {

      details.push([
        'Nullable',
        column.isNullable !== 0
          ? 'Yes'
          : 'No'
      ]);

    }


    for (
      const [
        labelText,
        valueText
      ] of details
    ) {

      const row =
        document.createElement(
          'div'
        );

      row.className =
        'column-details-row';


      const label =
        document.createElement(
          'div'
        );

      label.className =
        'column-details-label';

      label.textContent =
        labelText;


      const value =
        document.createElement(
          'div'
        );

      value.textContent =
        valueText;


      row.appendChild(
        label
      );

      row.appendChild(
        value
      );

      card.appendChild(
        row
      );

    }


    const copyButton =
      document.createElement(
        'button'
      );

    copyButton.className =
      'column-details-copy';

    copyButton.textContent =
      'Copy to Clipboard';


    copyButton.addEventListener(
      'click',
      async clickEvent => {

        clickEvent.preventDefault();
        clickEvent.stopPropagation();


        const clipboardText = [
          column.name,
          ...details.map(
            detail =>
              detail[0] +
              ': ' +
              detail[1]
          )
        ]
          .join(
            '\\n'
          );


        await navigator.clipboard
          .writeText(
            clipboardText
          );


        copyButton.textContent =
          'Copied!';


        window.setTimeout(
          () => {

            if (
              document.body.contains(
                copyButton
              )
            ) {

              copyButton.textContent =
                'Copy to Clipboard';

            }

          },
          1200
        );

      }
    );


    card.appendChild(
      copyButton
    );


    document.body.appendChild(
      card
    );


    const position =
      pendingColumnDetailsPosition ?? {
        x: 12,
        y: 12
      };

    const rect =
      card.getBoundingClientRect();


    card.style.left =
      Math.max(
        4,
        Math.min(
          position.x,
          window.innerWidth -
            rect.width -
            4
        )
      ) + 'px';

    card.style.top =
      Math.max(
        4,
        Math.min(
          position.y,
          window.innerHeight -
            rect.height -
            4
        )
      ) + 'px';


    pendingColumnDetailsPosition =
      undefined;

  }


  function sortColumn(
    event,
    columnIndex
  ) {

    event.stopPropagation();

    if (
      event.target &&
      event.target.classList &&
      event.target.classList.contains(
        'column-resizer'
      )
    ) {

      return;

    }


    vscode.postMessage({
      command:
        'sortColumn',

      id:
        activeResultId,

      columnIndex,

      multiSort:
        event.shiftKey
    });

  }


  const MIN_RESIZABLE_COLUMN_WIDTH =
    60;

  let activeResize =
    undefined;


  function getResultTable() {
    return document.getElementById(
      'result-table'
    );
  }


  function calculateRowNumberWidth(
    rowCount
  ) {
    const digits =
      Math.max(
        1,
        String(
          Math.max(
            1,
            rowCount
          )
        ).length
      );

    return Math.max(
      48,
      (digits * 8) + 24
    );
  }


  function ensureRowNumberWidth(
    rowCount
  ) {
    const table =
      getResultTable();

    const col =
      document.getElementById(
        'row-number-col'
      );

    if (
      !table ||
      !col
    ) {
      return;
    }

    const oldWidth =
      Number(
        col.dataset.width ??
        '48'
      );

    const requiredWidth =
      calculateRowNumberWidth(
        rowCount
      );

    if (
      requiredWidth <=
      oldWidth
    ) {
      return;
    }

    col.style.width =
      requiredWidth + 'px';

    col.dataset.width =
      String(
        requiredWidth
      );

    const currentTableWidth =
      Number(
        table.dataset.tableWidth ??
        table.offsetWidth
      );

    const newTableWidth =
      currentTableWidth -
      oldWidth +
      requiredWidth;

    table.style.width =
      newTableWidth + 'px';

    table.dataset.tableWidth =
      String(
        newTableWidth
      );
  }


  function setColumnWidth(
    columnIndex,
    width
  ) {
    const table =
      getResultTable();

    const col =
      document.getElementById(
        'result-col-' + columnIndex
      );

    if (
      !table ||
      !col
    ) {
      return;
    }

    const oldWidth =
      Number(
        col.dataset.width ??
        col.style.width.replace('px', '') ??
        '0'
      );

    const newWidth =
      Math.max(
        MIN_RESIZABLE_COLUMN_WIDTH,
        Math.round(width)
      );

    col.style.width =
      newWidth + 'px';

    col.dataset.width =
      String(newWidth);

    const currentTableWidth =
      Number(
        table.dataset.tableWidth ??
        table.offsetWidth
      );

    const newTableWidth =
      currentTableWidth -
      oldWidth +
      newWidth;

    table.style.width =
      newTableWidth + 'px';

    table.dataset.tableWidth =
      String(newTableWidth);
  }


  function ensureHeaderColumnWidths() {

    const MAX_AUTO_COLUMN_WIDTH =
      ${getMaxAutoColumnWidth()};

    const headers =
      document.querySelectorAll(
        '.column-header'
      );


    headers.forEach(
      header => {

        if (!(header instanceof HTMLElement)) {

          return;

        }


        const columnIndex =
          Number(
            header.dataset.columnIndex
          );

        const col =
          document.getElementById(
            'result-col-' + columnIndex
          );

        const title =
          header.querySelector(
            '.column-title'
          );

        const sortIndicator =
          header.querySelector(
            '.sort-indicator'
          );

        const filterButton =
          header.querySelector(
            '.filter-button'
          );


        if (
          !col ||
          !(title instanceof HTMLElement)
        ) {

          return;

        }


        /*
         * Measure the actual rendered header pieces instead
         * of estimating from character count. This uses the
         * current VS Code font and webview rendering.
         */
        const headerStyle =
          window.getComputedStyle(
            header
          );

        const titleStyle =
          window.getComputedStyle(
            title
          );

        const canvas =
          document.createElement(
            'canvas'
          );

        const context =
          canvas.getContext(
            '2d'
          );


        if (!context) {

          return;

        }


        context.font =
          titleStyle.font;

        const titleWidth =
          context.measureText(
            title.textContent ?? ''
          ).width;

        const horizontalPadding =
          (
            Number.parseFloat(
              headerStyle.paddingLeft
            ) || 0
          ) +
          (
            Number.parseFloat(
              headerStyle.paddingRight
            ) || 0
          );

        const sortWidth =
          sortIndicator instanceof HTMLElement
            ? sortIndicator.getBoundingClientRect().width
            : 0;

        const filterWidth =
          filterButton instanceof HTMLElement
            ? filterButton.getBoundingClientRect().width
            : 0;

        /*
         * Include the sort indicator margin and a small amount
         * of breathing room before the resize handle.
         */
        const requiredWidth =
          Math.min(
            MAX_AUTO_COLUMN_WIDTH,
            Math.ceil(
              titleWidth +
              horizontalPadding +
              sortWidth +
              filterWidth +
              14
            )
          );

        const currentWidth =
          Number(
            col.dataset.width ??
            col.style.width.replace('px', '') ??
            '0'
          );


        if (
          requiredWidth <=
          currentWidth
        ) {

          return;

        }


        setColumnWidth(
          columnIndex,
          requiredWidth
        );

        /*
         * Persist the corrected width in the extension-side
         * ResultTab so subsequent renders keep it.
         */
        vscode.postMessage({
          command:
            'resizeColumn',
          id:
            activeResultId,
          columnIndex,
          width:
            requiredWidth
        });

      }
    );

  }


  function startColumnResize(
    event,
    columnIndex
  ) {
    event.preventDefault();
    event.stopPropagation();

    const col =
      document.getElementById(
        'result-col-' + columnIndex
      );

    if (!col) {
      return;
    }

    activeResize = {
      columnIndex,
      startX:
        event.clientX,
      startWidth:
        Number(
          col.dataset.width ??
          col.offsetWidth
        )
    };

    document.body.classList.add(
      'column-resizing'
    );
  }


  function resizeColumnMove(
    event
  ) {
    if (!activeResize) {
      return;
    }

    const width =
      activeResize.startWidth +
      event.clientX -
      activeResize.startX;

    setColumnWidth(
      activeResize.columnIndex,
      width
    );
  }


  function finishColumnResize() {
    if (!activeResize) {
      return;
    }

    const columnIndex =
      activeResize.columnIndex;

    const col =
      document.getElementById(
        'result-col-' + columnIndex
      );

    activeResize =
      undefined;

    document.body.classList.remove(
      'column-resizing'
    );

    if (!col) {
      return;
    }

    vscode.postMessage({
      command:
        'resizeColumn',
      id:
        activeResultId,
      columnIndex,
      width:
        Number(col.dataset.width)
    });
  }


  function autoFitColumn(
    event,
    columnIndex
  ) {
    event.preventDefault();
    event.stopPropagation();

    vscode.postMessage({
      command:
        'autoFitColumn',
      id:
        activeResultId,
      columnIndex
    });
  }


  window.addEventListener(
    'resize',
    () => {

      if (
        openFilterColumn !==
        undefined
      ) {

        positionFilterPopup();

      }

    }
  );


  window.addEventListener(
    'mousemove',
    resizeColumnMove
  );

  window.addEventListener(
    'mouseup',
    finishColumnResize
  );


  const VIRTUAL_ROW_HEIGHT =
    27;

  const VIRTUAL_BUFFER_ROWS =
    20;

  let requestedStart =
    -1;

  let requestedEnd =
    -1;

  let hasMoreRows =
    ${activeTab.hasMore};

  let isFetchingRows =
    ${activeTab.isFetching};

  let automaticFetchRequested =
    false;
  let gridSelection = null;
  let selectionAnchor = null;
  let activeCell = null;
  let pendingKeyboardVisibilityCheck = false;
  let isSelecting = false;
  let rowSelectionMode = false;
  let columnSelectionMode = false;
  let selectedColumns = new Set();
  let columnSelectionAnchor = null;


  const AUTO_FETCH_THRESHOLD_ROWS =
    50;


  function maybeFetchMore(
    grid,
    totalRows,
    firstVisible,
    visibleCount
  ) {

    if (
      !autoFetchOnScroll ||
      !hasMoreRows ||
      isFetchingRows ||
      automaticFetchRequested
    ) {

      return;

    }


    const lastVisible =
      firstVisible +
      visibleCount;


    if (
      lastVisible <
      totalRows -
      AUTO_FETCH_THRESHOLD_ROWS
    ) {

      return;

    }


    automaticFetchRequested =
      true;


    fetchMore(
      activeResultId
    );

  }


  function normaliseClientSelection(selection) {
    if (!selection) return null;
    return {
      startRow: Math.min(selection.startRow, selection.endRow),
      endRow: Math.max(selection.startRow, selection.endRow),
      startColumn: Math.min(selection.startColumn, selection.endColumn),
      endColumn: Math.max(selection.startColumn, selection.endColumn)
    };
  }

  function getDataColumnCount() {
    const grid = document.getElementById('grid-wrap');
    if (!grid) return 0;
    return Number(grid.dataset.columnCount ?? '0');
  }

  function clearNativeTextSelection() {

    const nativeSelection =
      window.getSelection();

    if (
      nativeSelection &&
      nativeSelection.rangeCount > 0
    ) {

      nativeSelection.removeAllRanges();

    }

  }


  function applySelectionHighlight() {
    const s = normaliseClientSelection(gridSelection);
    const hasColumnSelection =
      columnSelectionMode &&
      selectedColumns.size > 0;

    document.querySelectorAll('.data-cell').forEach(cell => {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      cell.classList.toggle('grid-selected', Boolean(
        hasColumnSelection
          ? selectedColumns.has(column)
          : s && row >= s.startRow && row <= s.endRow &&
            column >= s.startColumn && column <= s.endColumn
      ));
    });

    document.querySelectorAll('.row-number[data-row-selector="true"]').forEach(cell => {
      const row = Number(cell.dataset.row);
      cell.classList.toggle('grid-selected', Boolean(
        !hasColumnSelection &&
        s && row >= s.startRow && row <= s.endRow &&
        s.startColumn === 0 && s.endColumn === Math.max(0, getDataColumnCount() - 1)
      ));
    });

    document.querySelectorAll('.column-header').forEach(header => {
      const column = Number(header.dataset.columnIndex);
      header.classList.toggle(
        'grid-selected',
        hasColumnSelection && selectedColumns.has(column)
      );
    });
  }

  function commitGridSelection() {
    const s = normaliseClientSelection(gridSelection);
    if (!s) return;
    vscode.postMessage({
      command: 'setSelection', id: activeResultId,
      startRow: s.startRow, endRow: s.endRow,
      startColumn: s.startColumn, endColumn: s.endColumn,
      selectedColumns: columnSelectionMode
        ? Array.from(selectedColumns).sort((left, right) => left - right)
        : []
    });
  }

  function beginCellSelection(
    row,
    column,
    extendSelection = false
  ) {

    if (
      extendSelection &&
      selectionAnchor
    ) {

      activeCell = {
        row,
        column
      };

      gridSelection = {
        startRow:
          selectionAnchor.row,
        endRow:
          row,
        startColumn:
          selectionAnchor.column,
        endColumn:
          column
      };

    } else {

      selectionAnchor = {
        row,
        column
      };

      activeCell = {
        row,
        column
      };

      gridSelection = {
        startRow:
          row,
        endRow:
          row,
        startColumn:
          column,
        endColumn:
          column
      };

    }


    rowSelectionMode =
      false;
    columnSelectionMode =
      false;
    selectedColumns.clear();
    columnSelectionAnchor =
      null;

    isSelecting =
      !extendSelection;

    applySelectionHighlight();


    if (extendSelection) {

      commitGridSelection();

    }

  }


  function extendCellSelection(
    row,
    column
  ) {

    if (
      !isSelecting ||
      !selectionAnchor
    ) {

      return;

    }


    activeCell = {
      row,
      column
    };

    gridSelection = {
      startRow:
        selectionAnchor.row,
      endRow:
        row,
      startColumn:
        selectionAnchor.column,
      endColumn:
        column
    };

    applySelectionHighlight();

  }


  function selectWholeRow(
    row,
    extendSelection = false
  ) {

    const count =
      getDataColumnCount();


    if (
      count <= 0
    ) {

      return;

    }


    if (
      extendSelection &&
      selectionAnchor &&
      rowSelectionMode
    ) {

      activeCell = {
        row,
        column:
          count - 1
      };

      gridSelection = {
        startRow:
          selectionAnchor.row,
        endRow:
          row,
        startColumn:
          0,
        endColumn:
          count - 1
      };

    } else {

      selectionAnchor = {
        row,
        column:
          0
      };

      activeCell = {
        row,
        column:
          count - 1
      };

      gridSelection = {
        startRow:
          row,
        endRow:
          row,
        startColumn:
          0,
        endColumn:
          count - 1
      };

    }


    rowSelectionMode =
      true;
    columnSelectionMode =
      false;
    selectedColumns.clear();
    columnSelectionAnchor =
      null;

    isSelecting =
      false;

    applySelectionHighlight();
    commitGridSelection();

  }


  function selectWholeColumn(
    column,
    extendSelection = false,
    toggleSelection = false
  ) {
    const grid = document.getElementById('grid-wrap');
    if (!grid) return;

    const rowCount = Number(grid.dataset.totalRows ?? '0');
    const columnCount = getDataColumnCount();

    if (rowCount <= 0 || column < 0 || column >= columnCount) {
      return;
    }

    if (extendSelection && columnSelectionAnchor !== null) {
      const start = Math.min(columnSelectionAnchor, column);
      const end = Math.max(columnSelectionAnchor, column);
      selectedColumns = new Set();
      for (let index = start; index <= end; index++) {
        selectedColumns.add(index);
      }
    } else if (toggleSelection) {
      if (!columnSelectionMode) {
        selectedColumns = new Set();
      }

      if (selectedColumns.has(column)) {
        selectedColumns.delete(column);
      } else {
        selectedColumns.add(column);
      }

      columnSelectionAnchor = column;
    } else {
      selectedColumns = new Set([column]);
      columnSelectionAnchor = column;
    }

    if (selectedColumns.size === 0) {
      gridSelection = null;
      columnSelectionMode = false;
      columnSelectionAnchor = null;
      applySelectionHighlight();
      return;
    }

    const ordered = Array.from(selectedColumns).sort((left, right) => left - right);

    gridSelection = {
      startRow: 0,
      endRow: rowCount - 1,
      startColumn: ordered[0],
      endColumn: ordered[ordered.length - 1]
    };

    selectionAnchor = {
      row: 0,
      column: ordered[0]
    };
    activeCell = {
      row: 0,
      column
    };
    rowSelectionMode = false;
    columnSelectionMode = true;
    isSelecting = false;

    applySelectionHighlight();
    commitGridSelection();
  }


  function ensureActiveCellVisible() {

    if (!activeCell) {

      return false;

    }


    const grid =
      document.getElementById(
        'grid-wrap'
      );


    if (!grid) {

      return false;

    }


    /*
     * Keep the active virtual row visible.
     */
    const rowTop =
      activeCell.row *
      VIRTUAL_ROW_HEIGHT;

    const rowBottom =
      rowTop +
      VIRTUAL_ROW_HEIGHT;


    if (
      rowTop <
      grid.scrollTop
    ) {

      grid.scrollTop =
        rowTop;

    } else if (
      rowBottom >
      grid.scrollTop +
      grid.clientHeight
    ) {

      grid.scrollTop =
        Math.max(
          0,
          rowBottom -
          grid.clientHeight
        );

    }


    /*
     * Keep the active column visible.
     */
    const activeElement =
      grid.querySelector(
        '.data-cell[data-row="' +
        activeCell.row +
        '"][data-column="' +
        activeCell.column +
        '"]'
      );


    if (
      activeElement instanceof HTMLElement
    ) {

      const cellLeft =
        activeElement.offsetLeft;

      const cellRight =
        cellLeft +
        activeElement.offsetWidth;


      if (
        cellLeft <
        grid.scrollLeft
      ) {

        grid.scrollLeft =
          cellLeft;

      } else if (
        cellRight >
        grid.scrollLeft +
        grid.clientWidth
      ) {

        grid.scrollLeft =
          Math.max(
            0,
            cellRight -
            grid.clientWidth
          );

      }

    }


    requestVisibleRows();


    /*
     * If the destination row is outside the currently
     * rendered virtual block, ask renderVirtualRows()
     * to perform one final visibility check after that
     * row has been rendered.
     */
    return !(
      activeElement instanceof HTMLElement
    );

  }

  function moveActiveCell(
    rowDelta,
    columnDelta,
    extendSelection
  ) {

    const grid =
      document.getElementById(
        'grid-wrap'
      );


    if (!grid) {

      return;

    }


    const rowCount =
      Number(
        grid.dataset.totalRows ??
        '0'
      );

    const columnCount =
      getDataColumnCount();


    if (
      rowCount <= 0 ||
      columnCount <= 0
    ) {

      return;

    }


    if (!activeCell) {

      const selection =
        normaliseClientSelection(
          gridSelection
        );


      activeCell =
        selection
          ? {
              row:
                selection.endRow,
              column:
                selection.endColumn
            }
          : {
              row:
                0,
              column:
                0
            };

    }


    const nextRow =
      Math.max(
        0,
        Math.min(
          rowCount - 1,
          activeCell.row +
          rowDelta
        )
      );

    const nextColumn =
      Math.max(
        0,
        Math.min(
          columnCount - 1,
          activeCell.column +
          columnDelta
        )
      );


    if (extendSelection) {

      if (!selectionAnchor) {

        selectionAnchor = {
          row:
            activeCell.row,
          column:
            activeCell.column
        };

      }


      rowSelectionMode =
        false;
      columnSelectionMode =
        false;
      selectedColumns.clear();
      columnSelectionAnchor =
        null;

      activeCell = {
        row:
          nextRow,
        column:
          nextColumn
      };

      gridSelection = {
        startRow:
          selectionAnchor.row,
        endRow:
          nextRow,
        startColumn:
          selectionAnchor.column,
        endColumn:
          nextColumn
      };

    } else {

      selectionAnchor = {
        row:
          nextRow,
        column:
          nextColumn
      };

      activeCell = {
        row:
          nextRow,
        column:
          nextColumn
      };

      rowSelectionMode =
        false;
      columnSelectionMode =
        false;
      selectedColumns.clear();
      columnSelectionAnchor =
        null;

      gridSelection = {
        startRow:
          nextRow,
        endRow:
          nextRow,
        startColumn:
          nextColumn,
        endColumn:
          nextColumn
      };

    }


    applySelectionHighlight();
    commitGridSelection();

    pendingKeyboardVisibilityCheck =
      ensureActiveCellVisible();

  }


  function copyGridSelection(includeHeaders) {
    if (!gridSelection) return;
    commitGridSelection();
    vscode.postMessage({
      command: 'copySelection',
      id: activeResultId,
      includeHeaders
    });
  }


  function requestVisibleRows(
    allowAutomaticFetch =
      true
  ) {

    const grid =
      document.getElementById(
        'grid-wrap'
      );


    if (!grid) {

      return;

    }


    const totalRows =
      Number(
        grid.dataset.totalRows ??
        '0'
      );


    if (
      totalRows ===
      0
    ) {

      return;

    }


    const firstVisible =
      Math.max(
        0,
        Math.floor(
          grid.scrollTop /
          VIRTUAL_ROW_HEIGHT
        )
      );


    const visibleCount =
      Math.ceil(
        grid.clientHeight /
        VIRTUAL_ROW_HEIGHT
      );


    if (
      allowAutomaticFetch
    ) {

      maybeFetchMore(
        grid,
        totalRows,
        firstVisible,
        visibleCount
      );

    }


    const start =
      Math.max(
        0,
        firstVisible -
        VIRTUAL_BUFFER_ROWS
      );


    const end =
      Math.min(
        totalRows,
        firstVisible +
        visibleCount +
        VIRTUAL_BUFFER_ROWS
      );


    if (
      start === requestedStart &&
      end === requestedEnd
    ) {

      return;

    }


    requestedStart =
      start;

    requestedEnd =
      end;


    vscode.postMessage({
      command:
        'requestRows',

      id:
        activeResultId,

      start,

      end
    });

  }


  function renderVirtualRows(
    message
  ) {

    const grid =
      document.getElementById(
        'grid-wrap'
      );

    const body =
      document.getElementById(
        'virtual-body'
      );


    if (
      !grid ||
      !body
    ) {

      return;

    }


    grid.dataset.totalRows =
      String(
        message.totalRows
      );


    const topHeight =
      message.start *
      VIRTUAL_ROW_HEIGHT;

    const bottomHeight =
      Math.max(
        0,
        (
          message.totalRows -
          message.end
        ) *
        VIRTUAL_ROW_HEIGHT
      );


    body.innerHTML =
      '<tr class="virtual-spacer">' +
      '<td colspan="' +
      message.columnCount +
      '" style="height: ' +
      topHeight +
      'px"></td></tr>' +
      message.rowsHtml +
      '<tr class="virtual-spacer">' +
      '<td colspan="' +
      message.columnCount +
      '" style="height: ' +
      bottomHeight +
      'px"></td></tr>';
    if (message.selection) {
      gridSelection = message.selection;

      if (Array.isArray(message.selectedColumns) && message.selectedColumns.length > 0) {
        selectedColumns = new Set(message.selectedColumns);
        columnSelectionMode = true;
        columnSelectionAnchor = message.selectedColumns[0];
      } else if (columnSelectionMode) {
        selectedColumns.clear();
        columnSelectionMode = false;
        columnSelectionAnchor = null;
      }

      if (!activeCell) {
        activeCell = {
          row:
            message.selection.endRow,
          column:
            message.selection.endColumn
        };
      }
    }

    applySelectionHighlight();


    /*
     * Only keyboard navigation is allowed to pull the
     * viewport back to the active cell. Normal mouse
     * scrolling must remain wherever the user puts it.
     */
    if (
      pendingKeyboardVisibilityCheck
    ) {

      pendingKeyboardVisibilityCheck =
        false;

      ensureActiveCellVisible();

    }

  }


  const gridWrap =
    document.getElementById(
      'grid-wrap'
    );


  if (gridWrap) {

    gridWrap.addEventListener(
      'scroll',
      requestVisibleRows,
      {
        passive:
          true
      }
    );


    window.addEventListener(
      'resize',
      requestVisibleRows
    );


    /*
     * Refine initial widths using the actual rendered header.
     * calculateColumnWidth() remains the fast first estimate;
     * this pass only expands columns whose header still clips.
     */
    ensureHeaderColumnWidths();

    requestVisibleRows();

  }


  function updateFetchUi(
    message
  ) {

    const grid =
      document.getElementById(
        'grid-wrap'
      );

    const rowCount =
      document.getElementById(
        'row-count'
      );

    const fetchStatus =
      document.getElementById(
        'fetch-status'
      );

    const fetchMoreButton =
      document.getElementById(
        'fetch-more-button'
      );

    const fetchAllButton =
      document.getElementById(
        'fetch-all-button'
      );

    const elapsedTime =
      document.getElementById(
        'elapsed-time'
      );


    hasMoreRows =
      Boolean(
        message.hasMore
      );

    isFetchingRows =
      Boolean(
        message.isFetching
      );


    if (
      !isFetchingRows
    ) {

      automaticFetchRequested =
        false;

    }


    if (grid) {

      grid.dataset.totalRows =
        String(
          message.displayRowCount ??
          message.rowCount
        );

    }


    ensureRowNumberWidth(
      message.rowCount
    );


    if (rowCount) {

      rowCount.textContent =
        message.rowCount +
        ' row' +
        (message.rowCount === 1 ? '' : 's') +
        ' fetched';

    }


    if (fetchStatus) {

      fetchStatus.innerHTML =
        isFetchingRows
          ? '<span class="spinner"></span> Fetching...'
          : hasMoreRows
            ? 'More rows available'
            : 'All rows fetched';

    }


    if (fetchMoreButton) {

      fetchMoreButton.disabled =
        isFetchingRows;

      fetchMoreButton.style.display =
        hasMoreRows ? '' : 'none';

    }


    if (fetchAllButton) {

      fetchAllButton.disabled =
        isFetchingRows;

      fetchAllButton.style.display =
        hasMoreRows ? '' : 'none';

    }


    if (
      elapsedTime &&
      message.elapsedText
    ) {

      elapsedTime.textContent =
        message.elapsedText;

    }


    requestedStart =
      -1;

    requestedEnd =
      -1;


    requestVisibleRows();

  }


  document.addEventListener('mousedown', event => {

    /*
     * Only the primary mouse button starts or changes a grid selection.
     *
     * In particular, a right-click must preserve the existing selection so
     * the native context-menu Copy command operates on that selection.
     */
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const columnHeader = target.closest('.column-header');
    if (columnHeader &&
        !target.closest('.sort-indicator') &&
        !target.closest('.filter-button') &&
        !target.closest('.column-resizer')) {
      event.preventDefault();

      const grid = document.getElementById('grid-wrap');
      grid?.focus();

      selectWholeColumn(
        Number(columnHeader.dataset.columnIndex),
        event.shiftKey,
        event.ctrlKey || event.metaKey
      );
      return;
    }

    const rowSelector = target.closest('.row-number[data-row-selector="true"]');
    if (rowSelector) {
      event.preventDefault();

      const grid =
        document.getElementById(
          'grid-wrap'
        );

      grid?.focus();

      selectWholeRow(
        Number(rowSelector.dataset.row),
        event.shiftKey
      );
      return;
    }

    const cell = target.closest('.data-cell');
    if (!cell) return;

    event.preventDefault();

    const grid =
      document.getElementById(
        'grid-wrap'
      );

    grid?.focus();

    beginCellSelection(
      Number(cell.dataset.row),
      Number(cell.dataset.column),
      event.shiftKey
    );
  });

  document.addEventListener('mouseover', event => {
    if (!isSelecting) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('.data-cell');
    if (!cell) return;
    extendCellSelection(Number(cell.dataset.row), Number(cell.dataset.column));
  });

  document.addEventListener('mouseup', () => {
    if (!isSelecting) return;
    isSelecting = false;
    commitGridSelection();
  });

  document.addEventListener(
    'keydown',
    event => {

      const key =
        event.key.toLowerCase();


      if (
        event.key === 'Escape'
      ) {

        closeColumnHeaderMenu();
        closeColumnDetailsCard();

      }


      if (
        key === 'c' &&
        (
          event.ctrlKey ||
          event.metaKey
        ) &&
        gridSelection
      ) {

        event.preventDefault();
        event.stopPropagation();

        copyGridSelection(
          event.shiftKey
        );

        return;

      }


      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {

        return;

      }


      let rowDelta =
        0;

      let columnDelta =
        0;


      switch (
        event.key
      ) {

        case 'ArrowUp':
          rowDelta =
            -1;
          break;

        case 'ArrowDown':
          rowDelta =
            1;
          break;

        case 'ArrowLeft':
          columnDelta =
            -1;
          break;

        case 'ArrowRight':
          columnDelta =
            1;
          break;

        default:
          return;

      }


      if (!gridSelection) {

        return;

      }


      event.preventDefault();
      event.stopPropagation();

      moveActiveCell(
        rowDelta,
        columnDelta,
        event.shiftKey
      );

    }
  );

  document.addEventListener(
    'mousedown',
    event => {

      if (
        event.button !== 0
      ) {

        return;

      }


      const target =
        event.target;


      if (
        !(target instanceof Node)
      ) {

        return;

      }


      const menu =
        document.getElementById(
          'column-header-menu'
        );

      const card =
        document.getElementById(
          'column-details-card'
        );


      if (
        menu &&
        !menu.contains(
          target
        )
      ) {

        closeColumnHeaderMenu();

      }


      if (
        card &&
        !card.contains(
          target
        )
      ) {

        closeColumnDetailsCard();

      }

    },
    true
  );


  document.addEventListener('copy', event => {
    if (!gridSelection || event.defaultPrevented) return;
    event.preventDefault();
    copyGridSelection(false);
  });


  document.addEventListener(
    'contextmenu',
    event => {

      const target =
        event.target;


      if (
        !(target instanceof Element)
      ) {

        return;

      }


      /*
       * Column headers have their own small context menu.
       *
       * Ctrl/Cmd + primary-click remains reserved for column
       * multi-selection on macOS, so only a genuine right-click
       * opens Column Details.
       */
      const columnHeader =
        target.closest(
          '.column-header'
        );

      if (
        columnHeader &&
        (event.ctrlKey || event.metaKey) &&
        !target.closest('.sort-indicator') &&
        !target.closest('.filter-button') &&
        !target.closest('.column-resizer')
      ) {

        event.preventDefault();
        event.stopPropagation();
        return;

      }


      if (
        columnHeader &&
        !target.closest('.sort-indicator') &&
        !target.closest('.filter-button') &&
        !target.closest('.column-resizer')
      ) {

        event.preventDefault();
        event.stopPropagation();

        openColumnHeaderMenu(
          event,
          Number(
            columnHeader.dataset.columnIndex
          )
        );

        return;

      }


      const resultCell =
        target.closest(
          '.data-cell, .row-number[data-row-selector="true"]'
        );


      if (
        !resultCell ||
        !gridSelection
      ) {

        return;

      }


      isSelecting =
        false;

      const grid =
        document.getElementById(
          'grid-wrap'
        );

      grid?.focus();

    }
  );


  window.addEventListener(
    'message',

    event => {

      const message =
        event.data;


      if (
        message.id !==
        activeResultId
      ) {

        return;

      }


      if (
        message.command ===
        'columnDetails'
      ) {

        showColumnDetailsCard(
          message.column
        );

        return;

      }


      if (
        message.command ===
        'fetchProgress'
      ) {

        const rowCount =
          document.getElementById(
            'row-count'
          );


        if (rowCount) {

          rowCount.textContent =
            message.rowCount +
            ' rows fetched';

        }


        ensureRowNumberWidth(
          message.rowCount
        );


        return;

      }


      if (
        message.command ===
        'fetchState'
      ) {

        updateFetchUi(
          message
        );

        return;

      }


      if (
        message.command ===
        'sortState'
      ) {

        const sorts =
          Array.isArray(message.sorts)
            ? message.sorts
            : [];

        const superscript = value =>
          String(value)
            .replace(/0/g, '⁰')
            .replace(/1/g, '¹')
            .replace(/2/g, '²')
            .replace(/3/g, '³')
            .replace(/4/g, '⁴')
            .replace(/5/g, '⁵')
            .replace(/6/g, '⁶')
            .replace(/7/g, '⁷')
            .replace(/8/g, '⁸')
            .replace(/9/g, '⁹');

        document
          .querySelectorAll(
            '.column-header'
          )
          .forEach(
            header => {

              const indicator =
                header.querySelector(
                  '.sort-indicator'
                );

              if (!indicator) {
                return;
              }

              const headerIndex =
                Number(
                  header.dataset.columnIndex
                );

              const priority =
                sorts.findIndex(
                  sort =>
                    sort.columnIndex === headerIndex
                );

              if (priority < 0) {
                indicator.textContent = '△';
                return;
              }

              const sort =
                sorts[priority];

              const suffix =
                sorts.length > 1
                  ? superscript(priority + 1)
                  : '';

              indicator.textContent =
                (sort.direction === 'asc'
                  ? '▲'
                  : '▼') + suffix;
            }
          );


        /*
         * Sorting changes display order but not
         * row count or fetched data. Keep the
         * current scroll position and request the
         * virtual window again in the new order.
         */
        requestedStart =
          -1;

        requestedEnd =
          -1;

        requestVisibleRows();

        return;

      }


      if (
        message.command ===
        'filterOptions'
      ) {

        showFilterPopup(
          message
        );

        return;

      }


      if (
        message.command ===
        'filterState'
      ) {

        const button =
          document.querySelector(
            '[data-filter-column="' +
            message.columnIndex +
            '"]'
          );


        if (button) {

          button.classList.toggle(
            'active',
            Boolean(
              message.filterActive
            )
          );

        }


        const rowCount =
          document.getElementById(
            'row-count'
          );


        if (rowCount) {

          rowCount.textContent =
            message.filterActive ||
            document.querySelector(
              '.filter-button.active'
            )
              ? message.displayRowCount +
                ' shown / ' +
                message.fetchedRowCount +
                ' fetched'
              : message.fetchedRowCount +
                ' rows fetched';

        }


        const grid =
          document.getElementById(
            'grid-wrap'
          );


        if (grid) {

          grid.dataset.totalRows =
            String(
              message.displayRowCount
            );

        }


        requestedStart =
          -1;

        requestedEnd =
          -1;


        const gridWrap =
          document.getElementById(
            'grid-wrap'
          );

        if (gridWrap) {

          gridWrap.scrollTop =
            0;

        }


        requestVisibleRows(
          false
        );

        return;

      }


      if (
        message.command ===
        'columnWidth'
      ) {

        setColumnWidth(
          message.columnIndex,
          message.width
        );

        return;

      }


      if (
        message.command ===
        'virtualRows'
      ) {

        renderVirtualRows(
          message
        );

      }

    }
  );


  window.addEventListener(
    'keydown',

    event => {

      if (
        event.key === 'Escape' &&
        openFilterColumn !== undefined
      ) {

        event.preventDefault();

        closeFilterMenu();

        return;

      }


      const isSelectAllShortcut =
        (
          event.metaKey ||
          event.ctrlKey
        ) &&
        event.key.toLowerCase() ===
          'a';


      if (
        !isSelectAllShortcut
      ) {

        return;

      }


      const target =
        event.target;


      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (
          target instanceof HTMLElement &&
          target.isContentEditable
        )
      ) {

        return;

      }


      const grid =
        document.getElementById(
          'grid-wrap'
        );

      const rowCount =
        Number(
          grid?.dataset.totalRows ??
          0
        );

      const columnCount =
        getDataColumnCount();


      if (
        rowCount <= 0 ||
        columnCount <= 0
      ) {

        return;

      }


      event.preventDefault();

      event.stopPropagation();

      clearNativeTextSelection();


      selectionAnchor = {
        row:
          0,
        column:
          0
      };

      activeCell = {
        row:
          rowCount - 1,
        column:
          columnCount - 1
      };

      rowSelectionMode =
        false;
      columnSelectionMode =
        false;
      selectedColumns.clear();
      columnSelectionAnchor =
        null;

      isSelecting =
        false;

      gridSelection = {
        startRow:
          0,
        endRow:
          rowCount - 1,
        startColumn:
          0,
        endColumn:
          columnCount - 1
      };


      applySelectionHighlight();

      commitGridSelection();

      grid?.focus();

      clearNativeTextSelection();

    }
  ,
    true
  );

</script>

</body>

</html>
`;

}


function buildFetchControlsHtml(
  tab:
    ResultTab
): string {


  if (tab.error) {

    return `
<div class="fetch-controls" id="fetch-controls">

  ${
    tab.sourceDocumentUri &&
    tab.sourceStartOffset !== undefined &&
    tab.error.line !== undefined &&
    tab.error.column !== undefined
      ? `
  <button
    class="fetch-button secondary"
    onclick="goToError(${tab.id})"
    title="Go to the error location in the SQL editor"
  >
    Go to Error
  </button>
      `
      : ''
  }

  <button
    class="fetch-button secondary"
    id="view-query-button"
    onclick="showQuery()"
    title="View the SQL statement that produced this error"
  >
    View Query
  </button>

  ${
    tab.error.uri
      ? `
  <button
    class="fetch-button secondary"
    onclick="openErrorHelp(${tab.id})"
    title="Open Oracle help for this error"
  >
    Oracle Error Help
  </button>
      `
      : ''
  }

</div>
`;

  }


  const fetchButtons =
    tab.hasMore
      ? `
  <button
    class="fetch-button secondary"
    id="fetch-more-button"
    onclick="fetchMore(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
  >
    Fetch More
  </button>

  <button
    class="fetch-button secondary"
    id="fetch-all-button"
    onclick="fetchAll(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
    title="Fetch all remaining rows"
  >
    Fetch All
  </button>
`
      : '';


  return `
<div class="fetch-controls" id="fetch-controls">

  ${fetchButtons}

  <button
    class="fetch-button secondary"
    id="view-query-button"
    onclick="showQuery()"
    ${tab.isFetching ? 'disabled' : ''}
    title="View the SQL statement for this result"
  >
    View Query
  </button>

  <button
    class="fetch-button secondary"
    id="export-results-button"
    onclick="exportResults(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
    title="Export results"
  >
    Export Results
  </button>

</div>
`;
}


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
    ${tab.isFetching ? 'disabled' : ''}
  >
    ${tab.pinned ? '📌' : '○'}
  </button>


  <button
    class="tab-close"
    title="Close result"
    onclick="closeTab(event, ${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
  >
    ×
  </button>

</div>
`;

}


function getSortIndicatorHtml(
  tab:
    ResultTab,

  columnIndex:
    number
): string {


  const sorts =
    tab.sortState ?? [];

  const priority =
    sorts.findIndex(
      sort =>
        sort.columnIndex === columnIndex
    );


  if (priority < 0) {
    return '&#9651;';
  }


  const indicator =
    sorts[priority].direction === 'asc'
      ? '&#9650;'
      : '&#9660;';

  if (sorts.length === 1) {
    return indicator;
  }

  const superscripts =
    ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

  const priorityText =
    String(priority + 1)
      .split('')
      .map(
        digit =>
          superscripts[Number(digit)]
      )
      .join('');

  return indicator + priorityText;
}


function buildQueryErrorHtml(
  tab:
    ResultTab
): string {


  const error =
    tab.error;


  if (!error) {
    return '';
  }


  const sqlLines =
    tab.sql.split(/\r?\n/);

  const errorLine =
    error.line && error.line > 0
      ? error.line
      : undefined;

  const errorColumn =
    error.column && error.column > 0
      ? error.column
      : undefined;

  let locationHtml =
    '';


  if (errorLine || errorColumn) {

    const locationText =
      [
        errorLine
          ? `Line ${errorLine}`
          : undefined,
        errorColumn
          ? `Column ${errorColumn}`
          : undefined
      ]
        .filter(Boolean)
        .join(', ');

    let snippetHtml =
      '';


    if (
      errorLine &&
      errorLine <= sqlLines.length
    ) {

      const lineText =
        sqlLines[errorLine - 1];

      const caret =
        errorColumn
          ? `${' '.repeat(Math.max(0, errorColumn - 1))}^`
          : '';

      snippetHtml = `
        <pre style="margin:10px 0 0; padding:12px 14px; overflow:auto; user-select:text; font-family:var(--vscode-editor-font-family); font-size:13px; line-height:1.5; background:var(--vscode-textCodeBlock-background); border:1px solid var(--vscode-panel-border); border-radius:5px;">${escapeHtml(lineText)}${caret ? `\n${escapeHtml(caret)}` : ''}</pre>
      `;

    }


    locationHtml = `
      <section style="margin-top:20px; padding:14px 16px; border:1px solid var(--vscode-panel-border); border-radius:5px; background:var(--vscode-editor-background);">
        <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--vscode-descriptionForeground); margin-bottom:6px;">Location</div>
        <div style="font-weight:600;">${escapeHtml(locationText)}</div>
        ${snippetHtml}
      </section>
    `;

  }


  const causeHtml =
    error.causeMessage
      ? `
        <section style="margin-top:20px;">
          <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--vscode-descriptionForeground); margin-bottom:7px;">Cause</div>
          <div style="white-space:pre-wrap; user-select:text; line-height:1.45;">${escapeHtml(error.causeMessage)}</div>
        </section>
      `
      : '';


  const actionHtml =
    error.action
      ? `
        <section style="margin-top:20px;">
          <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--vscode-descriptionForeground); margin-bottom:7px;">Action</div>
          <div style="white-space:pre-wrap; user-select:text; line-height:1.45;">${escapeHtml(error.action)}</div>
        </section>
      `
      : '';


  return `
    <div style="height:calc(100vh - 66px); overflow:auto; padding:24px 28px;">
      <div style="max-width:820px;">

        <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--vscode-errorForeground); margin-bottom:8px;">
          Query Error
        </div>

        <div style="font-size:20px; font-weight:600; line-height:1.25; margin-bottom:5px; user-select:text;">
          ${escapeHtml(error.code ?? 'Oracle Error')}
        </div>

        <div style="font-size:14px; line-height:1.45; user-select:text;">
          ${escapeHtml(error.message)}
        </div>

        ${locationHtml}
        ${causeHtml}
        ${actionHtml}

        <div style="margin-top:26px; padding-top:12px; border-top:1px solid var(--vscode-panel-border); font-size:12px; line-height:1.4; color:var(--vscode-descriptionForeground);">
          Need more detail? See <strong>Oracle Clean Results</strong> in the Output panel for the full Oracle diagnostic.
        </div>

      </div>
    </div>
  `;

}


function buildGridHtml(
  tab:
    ResultTab
): string {


  if (tab.error) {
    return buildQueryErrorHtml(
      tab
    );
  }


  const columns =
    getColumns(
      tab
    );


  const displayRowCount =
    getDisplayRows(
      tab
    ).length;


  const columnWidths =
    tab.columnWidths.length ===
      columns.length
      ? tab.columnWidths
      : calculateColumnWidths(
          tab.rows,
          columns,
          tab.nlsSettings
        );


  const rowNumberWidth =
    calculateRowNumberWidthForCount(
      tab.rows.length
    );


  const colgroupHtml =
    `
      <colgroup>
        <col id="row-number-col" data-width="${rowNumberWidth}" style="width: ${rowNumberWidth}px">
        ${
          columnWidths
            .map(
              (
                width,
                index
              ) =>
                `<col id="result-col-${index}" data-width="${width}" style="width: ${width}px">`
            )
            .join('')
        }
      </colgroup>
    `;


  const tableWidth =
    rowNumberWidth +
    columnWidths.reduce(
      (
        total,
        width
      ) =>
        total + width,
      0
    );


  const headerHtml =
    `
      <th class="row-number">
        #
      </th>
    ` +
    columns
      .map(
        (
          column,
          columnIndex
        ) =>
          `<th class="column-header" data-column-index="${columnIndex}" title="Click heading to select column"><span class="column-title">${escapeHtml(column.name)}</span><span class="sort-indicator" onclick="sortColumn(event, ${columnIndex})" title="Sort ${escapeHtml(column.name)}">${getSortIndicatorHtml(tab, columnIndex)}</span><button class="filter-button ${tab.filters?.has(columnIndex) ? 'active' : ''}" data-filter-column="${columnIndex}" onclick="openFilterMenu(event, ${columnIndex})" title="Filter ${escapeHtml(column.name)}">&#9662;</button><span class="column-resizer" onmousedown="startColumnResize(event, ${columnIndex})" ondblclick="autoFitColumn(event, ${columnIndex})"></span></th>`
      )
      .join('');


  if (
    displayRowCount ===
    0
  ) {

    return `
<div
  class="grid-wrap"
  tabindex="0"
>

  <table id="result-table" data-table-width="${Math.max(tableWidth, rowNumberWidth)}" style="width: ${Math.max(tableWidth, rowNumberWidth)}px">

    ${colgroupHtml}

    <thead>

      <tr>
        ${headerHtml}
      </tr>

    </thead>

    <tbody>

      <tr>

        <td
          class="empty"
          colspan="${Math.max(
            columns.length + 1,
            1
          )}"
        >
          No rows returned
        </td>

      </tr>

    </tbody>

  </table>

</div>
`;

  }


  return `
<div
  class="grid-wrap"
  id="grid-wrap"
  tabindex="0"
  data-total-rows="${displayRowCount}"
  data-column-count="${columns.length}"

    data-vscode-context='{"webviewSection":"resultsGrid"}'
  >

  <table id="result-table" data-table-width="${Math.max(tableWidth, rowNumberWidth)}" style="width: ${Math.max(tableWidth, rowNumberWidth)}px">

    ${colgroupHtml}

    <thead>

      <tr>
        ${headerHtml}
      </tr>

    </thead>

    <tbody id="virtual-body">
    </tbody>

  </table>

</div>
`;

}


function calculateRowNumberWidthForCount(
  rowCount:
    number
): number {

  const digits =
    Math.max(
      1,
      String(
        Math.max(
          1,
          rowCount
        )
      ).length
    );

  return Math.max(
    48,
    (digits * 8) + 24
  );
}


function calculateColumnWidths(
  rows:
    Array<Record<string, unknown>>,

  columns:
    ColumnMetadata[],

  nlsSettings:
    NlsSettings
): number[] {

  const sampleRows =
    rows.slice(
      0,
      getFetchSize()
    );

  return columns.map(
    column =>
      calculateColumnWidth(
        sampleRows,
        column,
        nlsSettings
      )
  );
}


function calculateColumnWidth(
  rows:
    Array<Record<string, unknown>>,

  column:
    ColumnMetadata,

  nlsSettings:
    NlsSettings
): number {

  const MIN_COLUMN_WIDTH =
    64;

  const MAX_COLUMN_WIDTH =
    getMaxAutoColumnWidth();

  const APPROX_CHARACTER_WIDTH =
    7;

  /*
   * Allow enough room for the complete header,
   * cell padding, sort indicator, filter button,
   * and resize handle. Automatic sizing is capped
   * at 400px; manual resizing can still go wider.
   */
  const CELL_HORIZONTAL_PADDING =
    18;

  const HEADER_CONTROL_ALLOWANCE =
    64;

  let maxLength =
    column.name.length;

  for (
    const row of rows
  ) {
    const value =
      getColumnValue(
        row,
        column
      );

    const displayLength =
      getDisplayLengthForWidth(
        value,
        column,
        nlsSettings
      );

    if (
      displayLength >
      maxLength
    ) {
      maxLength =
        displayLength;
    }
  }

  const dataWidth =
    maxLength *
      APPROX_CHARACTER_WIDTH +
      CELL_HORIZONTAL_PADDING;

  const headerWidth =
    column.name.length *
      APPROX_CHARACTER_WIDTH +
      HEADER_CONTROL_ALLOWANCE;


  return Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(
        dataWidth,
        headerWidth
      )
    )
  );
}


function getDisplayLengthForWidth(
  value:
    unknown,

  column:
    ColumnMetadata,

  nlsSettings:
    NlsSettings
): number {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const formatted =
    formatCell(
      value,
      column,
      nlsSettings
    );

  const plainText =
    formatted
      .replace(
        /<[^>]*>/g,
        ''
      )
      .replace(
        /&(?:amp|lt|gt|quot|#39);/g,
        'x'
      );

  return plainText.length;
}


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

  rowKey:
    key,

  dataType:
    'UNKNOWN'
});

      }

    }

  }


  return columns;

}


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


function formatElapsedTime(
  elapsedMs:
    number
): string {


  const seconds =
    elapsedMs /
    1000;


  return `${seconds.toFixed(2)} sec`;

}


function getOracleTemporalValue(
  value:
    unknown
): string | Date | undefined {


  if (
    typeof value ===
    'string' ||
    value instanceof Date
  ) {

    return value;

  }


  if (
    !value ||
    typeof value !==
      'object'
  ) {

    return undefined;

  }


  const candidate =
    value as Record<string, unknown>;

  const innerValue =
    candidate.value;


  if (
    typeof innerValue ===
    'string' ||
    innerValue instanceof Date
  ) {

    return innerValue;

  }


  return undefined;

}


function formatCell(
  value:
    unknown,

  column:
    ColumnMetadata,

  nlsSettings:
    NlsSettings
): string {


  if (
    value === null ||
    value === undefined
  ) {

    return escapeHtml(
      getNullDisplayText()
    );

  }


  const dataType =
    column.dataType
      ?.toUpperCase()
    ?? '';


  if (
    dataType === 'DATE' ||
    dataType.startsWith(
      'TIMESTAMP'
    )
  ) {

    const temporalValue =
      getOracleTemporalValue(
        value
      );

    const format =
      dataType === 'DATE'
        ? nlsSettings.dateFormat
        : nlsSettings.timestampFormat;


    if (
      typeof temporalValue ===
      'string'
    ) {

      return escapeHtml(
        formatOracleTemporalString(
          temporalValue,
          format
        )
      );

    }


    if (
      temporalValue instanceof Date
    ) {

      return escapeHtml(
        formatTemporalParts(
          getPartsFromDate(
            temporalValue
          ),
          format
        )
      );

    }

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


        case 'X':

          return '.';


        case 'FF':

          return parts.fractionalSeconds
            || '0';


        default:

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
