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

// ---------------------------------------------------------------------------
// Download helper — follows redirects (Google sends several)
// ---------------------------------------------------------------------------
function download(url, dest, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));

    const lib = url.startsWith("https") ? https : http;

    lib
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect without location"));
          console.log(`  ↳ Redirect → ${location.slice(0, 80)}…`);
          return resolve(download(location, dest, maxRedirects - 1));
        }

        if (res.statusCode !== 200) {
          return reject(
            new Error(`HTTP ${res.statusCode} when downloading spreadsheet`)
          );
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      })
      .on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Sanitize sheet name for use as a filename
// ---------------------------------------------------------------------------
function sanitize(name) {
  return name
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(60));
  console.log("Google Sheets → JSON Sync");
  console.log("=".repeat(60));
  console.log(`Spreadsheet ID : ${SPREADSHEET_ID}`);
  console.log(`Output dir     : ${DATA_DIR}`);
  console.log();

  // 1. Download the entire spreadsheet as .xlsx
  const exportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
  console.log("⬇  Downloading spreadsheet as .xlsx …");
  await download(exportUrl, TEMP_FILE);
  console.log("✓  Download complete\n");

  // 2. Parse with xlsx
  const workbook = XLSX.readFile(TEMP_FILE);
  const sheetNames = workbook.SheetNames;
  console.log(`Found ${sheetNames.length} sheet(s): ${sheetNames.join(", ")}\n`);

  // 3. Ensure output directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // 4. Convert each sheet → JSON and save
  const manifest = {};

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];

    // Convert to array-of-objects (first row = headers)
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    // Also keep a raw 2-D array version
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const safeName = sanitize(name);
    const filename = `${safeName}.json`;
    const filepath = path.join(DATA_DIR, filename);

    const payload = {
      sheetName: name,
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      columns: raw.length > 0 ? raw[0] : [],
      data: rows,
    };

    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
    console.log(
      `  📄 ${filename}  — ${rows.length} rows, ${payload.columns.length} cols`
    );

    manifest[name] = {
      file: filename,
      rows: rows.length,
      columns: payload.columns,
    };
  }

  // 5. Write a manifest / index file
  const manifestPayload = {
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    generatedAt: new Date().toISOString(),
    sheets: manifest,
  };

  const manifestPath = path.join(DATA_DIR, "_manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifestPayload, null, 2));
  console.log(`\n  📋 _manifest.json  — index of all sheets`);

  // 6. Cleanup temp file
  fs.unlinkSync(TEMP_FILE);

  console.log("\n" + "=".repeat(60));
  console.log("✅ Done! JSON files saved to data/");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  // Cleanup temp file on error
  if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  process.exit(1);
});
