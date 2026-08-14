/**
 * LINX Square — product sync for Google Sheets.
 *
 * Paste this into the sheet: Extensions → Apps Script → replace Code.gs →
 * Save. Then run "LINX Sync → Set up (first time)" from the sheet menu.
 *
 * Pulls from /api/products/sheet-feed on linxsquare.co.uk and appends any
 * product not already in the sheet. Runs as you, so no service account and no
 * Google Cloud project is needed.
 *
 * Products are matched on column A (Product ID = the Mongo _id), so running it
 * twice never double-appends.
 */

var API_BASE = 'https://linxsquare.co.uk';
var TAB_NAME = 'All Products';
var PAGE_SIZE = 500;
/** Apps Script kills a run at 6 min; stop early and resume next trigger. */
var MAX_RUN_MS = 4.5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LINX Sync')
    .addItem('Set up (first time)', 'setupSync')
    .addSeparator()
    .addItem('Sync now', 'syncProducts')
    .addItem('Sync one brand…', 'syncOneBrand')
    .addSeparator()
    .addItem('Enable hourly auto-sync', 'enableAutoSync')
    .addItem('Disable auto-sync', 'disableAutoSync')
    .addItem('Reset sync position', 'resetCursor')
    .addToUi();
}

/** Stores the API secret so it is never written into the script body. */
function setupSync() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    'LINX product sync setup',
    'Paste the PRODUCT_SHEET_SECRET value from the site\'s environment:',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var secret = res.getResponseText().trim();
  if (!secret) {
    ui.alert('No secret entered — setup cancelled.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('API_SECRET', secret);

  try {
    var probe = fetchPage_({ columns: 1 });
    writeHeader_(probe.columns);
    ui.alert(
      'Connected.\n\n' +
        probe.columns.length +
        ' columns ready. Now run "LINX Sync → Sync now", or turn on hourly ' +
        'auto-sync.'
    );
  } catch (e) {
    ui.alert('Could not reach the API:\n\n' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function syncProducts() {
  return runSync_(null);
}

function syncOneBrand() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    'Sync a single brand',
    'Brand name exactly as it appears in the admin (e.g. Natura Flooring):',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var brand = res.getResponseText().trim();
  if (!brand) return;
  runSync_(brand);
}

/**
 * Page through the feed and append unseen products.
 * @param {string|null} brand Restrict to one brand, or null for everything.
 */
function runSync_(brand) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    log_('another sync is already running — skipping this pass');
    return;
  }

  try {
    var started = Date.now();
    var sheet = getSheet_();
    var props = PropertiesService.getScriptProperties();

    // A brand run is a one-off, so it must not disturb the main cursor.
    var cursorKey = brand ? null : 'CURSOR';
    var cursor = cursorKey ? JSON.parse(props.getProperty(cursorKey) || 'null') : null;

    var seen = existingIds_(sheet);
    var appended = 0;
    var pages = 0;

    while (true) {
      var params = { limit: PAGE_SIZE };
      if (brand) params.brand = brand;
      if (cursor && cursor.afterDate) {
        params.afterDate = cursor.afterDate;
        params.afterId = cursor.afterId;
      }

      var page = fetchPage_(params);
      pages++;

      if (pages === 1 && sheet.getLastRow() === 0) writeHeader_(page.columns);

      var fresh = [];
      for (var i = 0; i < page.rows.length; i++) {
        var id = String(page.rows[i][0]);
        if (seen[id]) continue;
        seen[id] = true;
        fresh.push(page.rows[i]);
      }

      if (fresh.length) {
        sheet
          .getRange(sheet.getLastRow() + 1, 1, fresh.length, page.columns.length)
          .setValues(fresh);
        appended += fresh.length;
      }

      if (cursorKey && page.nextAfterDate) {
        cursor = { afterDate: page.nextAfterDate, afterId: page.nextAfterId };
        props.setProperty(cursorKey, JSON.stringify(cursor));
      }

      if (!page.hasMore) break;

      // Bail before Apps Script's 6-minute ceiling; the cursor is saved, so
      // the next run picks up exactly where this one stopped.
      if (Date.now() - started > MAX_RUN_MS) {
        log_('time limit reached after ' + appended + ' rows — will resume');
        break;
      }
    }

    log_(
      'sync done: ' + appended + ' new row(s) over ' + pages + ' page(s)' +
        (brand ? ' [brand: ' + brand + ']' : '')
    );
    return appended;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function enableAutoSync() {
  disableAutoSync();
  ScriptApp.newTrigger('syncProducts').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Auto-sync on — runs every hour.');
}

function disableAutoSync() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncProducts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** Forget the paging position so the next sync rescans from the beginning. */
function resetCursor() {
  PropertiesService.getScriptProperties().deleteProperty('CURSOR');
  SpreadsheetApp.getUi().alert(
    'Sync position reset. The next sync rescans every product; rows already ' +
      'in the sheet are still skipped, so nothing will be duplicated.'
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchPage_(params) {
  var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!secret) {
    throw new Error('Not set up yet — run "LINX Sync → Set up (first time)".');
  }

  var qs = [];
  for (var k in params) {
    if (params[k] !== null && params[k] !== undefined) {
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }

  var res = UrlFetchApp.fetch(
    API_BASE + '/api/products/sheet-feed?' + qs.join('&'),
    {
      method: 'get',
      headers: { Authorization: 'Bearer ' + secret },
      muteHttpExceptions: true,
    }
  );

  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code === 401) {
    throw new Error('Unauthorized — the secret is wrong or not set on the site.');
  }
  if (code !== 200) {
    throw new Error('API returned ' + code + ': ' + body.slice(0, 300));
  }

  var data = JSON.parse(body);
  if (data.error) throw new Error(data.error);
  return data;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(TAB_NAME);
  return sheet;
}

function writeHeader_(columns) {
  var sheet = getSheet_();
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/** Product IDs already in column A, as a lookup object. */
function existingIds_(sheet) {
  var last = sheet.getLastRow();
  var seen = {};
  if (last < 2) return seen;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (id) seen[id] = true;
  }
  return seen;
}

function log_(msg) {
  Logger.log(msg);
  console.log(msg);
}
