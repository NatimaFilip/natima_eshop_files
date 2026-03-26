const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID ||
  "1kE3gWN9oU5_tLTDs9E9XTqdGJy_hIBJvGOr_HqrEhzA";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const TEMP_FILE = path.resolve(__dirname, "..", "temp_sheet.xlsx");

function download(url, dest, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect without location"));
          return resolve(download(location, dest, maxRedirects - 1));
        }
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

function sanitize(name) {
  return name
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

async function main() {
  console.log("Google Sheets → JSON Sync");
  console.log(`Spreadsheet ID: ${SPREADSHEET_ID}\n`);

  const exportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
  console.log("Downloading spreadsheet...");
  await download(exportUrl, TEMP_FILE);
  console.log("Download complete\n");

  const workbook = XLSX.readFile(TEMP_FILE);
  const sheetNames = workbook.SheetNames;
  console.log(`Found ${sheetNames.length} sheet(s): ${sheetNames.join(", ")}\n`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Build one combined object
  const combined = {
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    generatedAt: new Date().toISOString(),
    sheets: {},
  };

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const key = sanitize(name);

    combined.sheets[key] = {
      sheetName: name,
      rowCount: rows.length,
      columns: raw.length > 0 ? raw[0] : [],
      data: rows,
    };

    console.log(`  ${name} → "${key}": ${rows.length} rows, ${(raw[0] || []).length} cols`);
  }

  const outPath = path.join(DATA_DIR, "sheets.json");
  fs.writeFileSync(outPath, JSON.stringify(combined, null, 2));
  console.log(`\nSaved to data/sheets.json`);

  fs.unlinkSync(TEMP_FILE);
  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  process.exit(1);
});
