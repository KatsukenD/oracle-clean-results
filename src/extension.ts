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

const outputChannel =
  vscode.window.createOutputChannel(
    'Oracle Clean Results'
  );

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

}


interface WebviewMessage {

  command:
    | 'selectTab'
    | 'togglePin'
    | 'closeTab'
    | 'fetchMore'
    | 'fetchAll';

  id:
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

    outputChannel.appendLine(
      '--- Selected SQL ---'
    );

    outputChannel.appendLine(
      selectedSql
    );

    outputChannel.appendLine(
      `Statements found: ${statements.length}`
    );

    statements.forEach(
      (statement, index) => {

        outputChannel.appendLine(
          `--- Statement ${index + 1} ---`
        );

        outputChannel.appendLine(
          statement
        );

      }
    );

    outputChannel.show();


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

    console.log(
      'Oracle Clean Results executing:',
      sql
    );

const executableSql =
  removeLeadingComments(
    sql
  )
    .trim();

    outputChannel.appendLine(
      '--- About to execute ---'
    );

    outputChannel.appendLine(
      executableSql
    );

    outputChannel.show();

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

      outputChannel.appendLine(
        '--- Getting NLS settings ---'
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

        elapsedMs

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


  renderResultsView();


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


    renderResultsView();

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


  renderResultsView();


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


    renderResultsView();

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
        tab.rows.length

    });

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
        <span class="fetching-status">

          <span class="spinner"></span>

          Fetching...

        </span>
      `

      : `
        <span>
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

    <span id="row-count">
      ${activeTab.rows.length}
      row${activeTab.rows.length === 1 ? '' : 's'}
      fetched
    </span>

    ${fetchStatusHtml}

    ${fetchControlsHtml}

    <span>
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


  window.addEventListener(
    'message',

    event => {

      const message =
        event.data;


      if (
        message.command !==
        'fetchProgress'
      ) {

        return;

      }


      if (
        message.id !==
        activeResultId
      ) {

        return;

      }


      const rowCount =
        document.getElementById(
          'row-count'
        );


      if (
        rowCount
      ) {

        rowCount.textContent =
          message.rowCount +
          ' rows fetched';

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
<div class="fetch-controls">

  <button
    class="fetch-button secondary"
    onclick="fetchMore(${tab.id})"
    ${tab.isFetching ? 'disabled' : ''}
  >
    Fetch More
  </button>

  <button
    class="fetch-button"
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
<div
  class="grid-wrap"
  tabindex="0"
>

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