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

interface NlsSettings {

  dateFormat:
    string;

  timestampFormat:
    string;

}


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
    | 'autoFitColumn';

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

}


let resultsView:
  vscode.WebviewView | undefined;

let resultTabs:
  ResultTab[] = [];

let activeResultId:
  number | undefined;

let nextResultNumber =
  1;


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


  await executeCleanQuery(
    session,
    sql,
    false
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
  for (
    let index = 0;
    index < statements.length;
    index++
  ) {

    await executeCleanQuery(
      session,
      statements[index],
      index > 0
    );

  }

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
    boolean
): Promise<void> {


  const nlsSettings =
    await getNlsSettings(
      session
    );


  let resultSet:
    ResultSet | undefined;


  const startTime =
    Date.now();

  try {

const executableSql =
  removeLeadingComments(
    sql
  )
    .trim();

    resultSet =
      await session.executeQuery(

        {
          sql:
            executableSql
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


    const hasMore =
      await resultSet.hasNext();


    const elapsedMs =
      Date.now() -
      startTime;


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
      forceNewTab
    );


    /*
     * ResultTab now owns the open
     * ResultSet if additional rows exist.
     */
    resultSet =
      undefined;


  } finally {

    if (resultSet) {

      await resultSet.close();

    }

  }

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


  const safeStart =
    Math.max(
      0,
      Math.min(
        start,
        tab.rows.length
      )
    );


  const safeEnd =
    Math.max(
      safeStart,
      Math.min(
        end,
        tab.rows.length
      )
    );


  const rowsHtml =
    tab.rows
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
            <tr class="virtual-data-row">

              <td class="row-number">
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
        tab.rows.length,

      columnCount:
        Math.max(
          columns.length + 1,
          1
        ),

      rowsHtml

    });

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
            activeTab.hasMore
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

    <span id="row-count">
      ${activeTab.rows.length}
      row${activeTab.rows.length === 1 ? '' : 's'}
      fetched
    </span>

    ${fetchStatusHtml}

    ${fetchControlsHtml}

    <span id="elapsed-time">
      ${formatElapsedTime(
        activeTab.elapsedMs
      )}
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


  const activeResultId =
    ${activeTab.id};


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

  const AUTO_FETCH_THRESHOLD_ROWS =
    50;


  function maybeFetchMore(
    grid,
    totalRows,
    firstVisible,
    visibleCount
  ) {

    if (
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


  function requestVisibleRows() {

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


    maybeFetchMore(
      grid,
      totalRows,
      firstVisible,
      visibleCount
    );


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

      const isFetchAllShortcut =
        (
          event.metaKey ||
          event.ctrlKey
        ) &&
        event.key.toLowerCase() ===
          'a';


      if (
        !isFetchAllShortcut
      ) {

        return;

      }


      ${
        activeTab.hasMore &&
        !activeTab.isFetching
          ? `
            event.preventDefault();

            event.stopPropagation();

            fetchAll(
              activeResultId
            );
          `
          : ''
      }

    }
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


  if (
    !tab.hasMore
  ) {

    return '';

  }


  return `
<div class="fetch-controls" id="fetch-controls">

  <button
    class="fetch-button secondary"
    id="fetch-more-button"
    onclick="fetchMore(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
  >
    Fetch More
  </button>

  <button
    class="fetch-button"
    id="fetch-all-button"
    onclick="fetchAll(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
    title="Fetch all remaining rows (Cmd+A / Ctrl+A)"
  >
    Fetch All
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


function buildGridHtml(
  tab:
    ResultTab
): string {


  const columns =
    getColumns(
      tab
    );


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
          `<th class="column-header">${escapeHtml(column.name)}<span class="column-resizer" onmousedown="startColumnResize(event, ${columnIndex})" ondblclick="autoFitColumn(event, ${columnIndex})"></span></th>`
      )
      .join('');


  if (
    tab.rows.length ===
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
  data-total-rows="${tab.rows.length}"
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
      PAGE_SIZE
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
    90;

  const MAX_COLUMN_WIDTH =
    420;

  const APPROX_CHARACTER_WIDTH =
    8;

  const CELL_HORIZONTAL_PADDING =
    24;

  let maxLength =
    column.name.length;

  for (
    const row of rows
  ) {
    const value =
      getRowValue(
        row,
        column.name
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

  return Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(
      MAX_COLUMN_WIDTH,
      maxLength *
        APPROX_CHARACTER_WIDTH +
        CELL_HORIZONTAL_PADDING
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

    return '';

  }


  const dataType =
    column.dataType
      ?.toUpperCase()
    ?? '';


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