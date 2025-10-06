// Requires: "playwright" in package.json
// Saves: data/reviews.json

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const URL = "https://www.ceneo.pl/sklepy/natima.pl-s51196#tab=reviews";
const OUT_FILE = path.join(__dirname, "ceneo_reviews_pl.json");

(async () => {
	const browser = await chromium.launch({ headless: true });

	const context = await browser.newContext({
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	});
	const page = await context.newPage();

	// Go to the Reviews tab and wait for reviews to render
	await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });

	// Ensure the Reviews tab has actually loaded DOM content
	await page.waitForSelector(".user-post", { timeout: 60000 });

	// Extract all reviews on the page
	const records = await page.$$eval(".user-post", (posts) => {
		const safeGetText = (root, sel) => {
			const el = root.querySelector(sel);
			// Return the raw textContent exactly as on page (no extra edits)
			return el ? el.textContent : "";
		};

		const parseRating = (raw) => {
			// Expect formats like "5/5" or "4,5/5"
			// We only need the first value before "/"
			if (typeof raw !== "string") return "";
			const first = raw.split("/")[0] ?? "";
			// Keep commas as-is (no normalization)
			return first.trim();
		};

		return posts.map((post) => {
			const textRaw = safeGetText(post, ".user-post__text");
			const scoreRaw = safeGetText(post, ".user-post__score-count");

			return {
				total_rating: { _text: parseRating(scoreRaw) },
				summary: { _text: textRaw ?? "" }, // save exactly as provided
			};
		});
	});

	const payload = { reviews: { review: records } };

	// Write JSON with stable formatting
	fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

	await browser.close();
	console.log(`Saved ${records.length} reviews → ${OUT_FILE}`);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
