/**
 * Google Apps Script for Spreadsheet Monitoring
 * 
 * Instructions:
 * 1. Open your Google Spreadsheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Delete any existing code and paste this script.
 * 4. Click "Deploy" > "New Deployment".
 * 5. Select "Web App".
 * 6. Set "Execute as" to "Me".
 * 7. Set "Who has access" to "Anyone".
 * 8. Click "Deploy" and copy the "Web App URL".
 * 9. Provide this URL to your administrator to set as the GAS_URL environment variable.
 */

function doGet(e) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const mode = e.parameter.mode || 'poll';

  if (mode === 'info') {
    const spreadsheetId = e.parameter.spreadsheetId;
    if (!spreadsheetId) return createJsonResponse({ error: "Missing spreadsheetId" }, 400);
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      return createJsonResponse({ name: ss.getName() });
    } catch (err) {
      return createJsonResponse({ error: err.message }, 500);
    }
  }

  const spreadsheetIdsStr = e.parameter.spreadsheetIds || scriptProperties.getProperty('NOTTIFFY_SPREADSHEET_IDS');
  const lastPolledDatesStr = e.parameter.lastPolledDates;
  const includeNames = e.parameter.includeNames === 'true';
  
  if (!spreadsheetIdsStr) {
    return createJsonResponse({ error: "Missing spreadsheetIds parameter" }, 400);
  }

  const spreadsheetIds = spreadsheetIdsStr.split(',');
  const lastPolledDates = lastPolledDatesStr ? lastPolledDatesStr.split(',') : [];
  const results = [];

  for (let i = 0; i < spreadsheetIds.length; i++) {
    const spreadsheetId = spreadsheetIds[i].trim();
    const lastPolledDateStr = lastPolledDates[i] || lastPolledDates[0];

    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheets()[0];
      const spreadsheetName = includeNames ? ss.getName() : null;
      const data = sheet.getDataRange().getValues();
      
      if (data.length <= 1) {
        results.push({
          spreadsheetId: spreadsheetId,
          count: 0,
          rows: [],
          spreadsheetName: spreadsheetName,
          currentTime: new Date().toISOString()
        });
        continue;
      }

      const rows = data.slice(1);
      const lastPolledDate = lastPolledDateStr ? new Date(lastPolledDateStr) : new Date(0);
      
      const newRows = rows.filter(row => {
        const rowDate = new Date(row[0]);
        return !isNaN(rowDate.getTime()) && rowDate > lastPolledDate;
      });

      results.push({
        spreadsheetId: spreadsheetId,
        count: newRows.length,
        rows: newRows,
        spreadsheetName: spreadsheetName,
        currentTime: new Date().toISOString()
      });

    } catch (err) {
      results.push({
        spreadsheetId: spreadsheetId,
        error: err.message
      });
    }
  }

  return createJsonResponse({
    results: results,
    currentTime: new Date().toISOString()
  });
}

function createJsonResponse(data, status) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
