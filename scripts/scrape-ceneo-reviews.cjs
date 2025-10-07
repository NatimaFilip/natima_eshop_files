// Requires: "playwright" in package.json
// Saves: data/ceneo_reviews_pl.json

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const URL = "https://www.ceneo.pl/sklepy/natima.pl-s51196#tab=reviews";
const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "ceneo_reviews_pl.json");

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
	await page.waitForSelector(".user-post", { timeout: 30000 });

	// Extract and filter reviews
	const records = await page.$$eval(".user-post", (posts) => {
		const safeGetText = (root, sel) => {
			const el = root.querySelector(sel);
			return el ? el.textContent : "";
		};

		const cleanText = (s) => (typeof s === "string" ? s.replace(/\n/g, "").trim() : "");

		const parseScore = (raw) => {
			// raw like "4,5/5" or "5/5" -> numeric 4.5 or 5
			if (typeof raw !== "string") return NaN;
			const first = (raw.split("/")[0] ?? "").replace(",", ".").trim();
			const n = parseFloat(first);
			return Number.isFinite(n) ? n : NaN;
		};

		return posts
			.map((post) => {
				const textRaw = safeGetText(post, ".user-post__text");
				const scoreRaw = safeGetText(post, ".user-post__score-count");

				const summaryClean = cleanText(textRaw);
				let score = parseScore(scoreRaw);

				// Filters:
				// - skip if score < 4
				// - skip if summary length < 3
				if (!(score >= 4)) return null;
				score = 5; // force 5-star rating
				if (summaryClean.length < 3) return null;

				return {
					total_rating: { _text: (Number.isFinite(score) ? String(score).replace(".", ",") : "").trim() },
					summary: { _cdata: summaryClean },
				};
			})
			.filter(Boolean);
	});

	const payload = { reviews: { review: records } };

	// Ensure output dir exists
	fs.mkdirSync(OUT_DIR, { recursive: true });

	// Write JSON with stable formatting
	fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

	await browser.close();
	console.log(`Saved ${records.length} filtered reviews → ${OUT_FILE}`);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
