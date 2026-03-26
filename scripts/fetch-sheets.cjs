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

  const combined = {
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    generatedAt: new Date().toISOString(),
    sheets: {},
  };

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (raw.length === 0) continue;

    const key = sanitize(name);

    // Row 0 = headers: ["Název pozice", "Grafik"]
    // The first header is the label column, the rest are value columns
    const headers = raw[0];
    const valueColumns = headers.slice(1); // e.g. ["Grafik"]

    // For each value column, build a flat object from the rows
    // Row 1+: ["Typ úvazku", "HPP / IČO"] → { "Typ úvazku": "HPP / IČO" }
    for (const [colIndex, colName] of valueColumns.entries()) {
      const colKey = sanitize(colName);
      const obj = {};

      // First row header becomes "Název pozice": "Grafik"
      obj[headers[0]] = colName;

      // Remaining rows become key-value pairs
      for (let r = 1; r < raw.length; r++) {
        const label = raw[r][0];
        const value = raw[r][colIndex + 1];
        if (label !== "") {
          obj[label] = value;
        }
      }

      combined.sheets[colKey] = obj;
    }

    console.log(`  ${name} → ${valueColumns.length} position(s): ${valueColumns.join(", ")}`);
  }

  const outPath = path.join(DATA_DIR, "kariera.json");
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
