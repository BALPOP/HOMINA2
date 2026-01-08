const RESULTS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/14f_ipSqAq8KCP7aFrbIK9Ztbo33BnCw34DSk5ADdPgI/export?format=csv&gid=1178367669';

class ResultsFetcher {
    constructor() {
        this.results = [];
        this.lastFetchTime = null;
    }

    async fetchResults() {
        const response = await fetch(RESULTS_SHEET_CSV_URL);
        if (!response.ok) {
            throw new Error('Failed to fetch draw results');
        }
        const csvText = await response.text();
        this.results = this.parseCSV(csvText);
        this.lastFetchTime = new Date();
        return this.results;
    }

    parseCSV(csvText) {
        const lines = csvText.split('\n').filter(Boolean);
        const parsed = [];

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const row = this.parseCSVLine(lines[i]);
            if (row.length < 6) continue;

            const contestRaw = row[0].trim();
            const drawDateRaw = row[1].trim();

            if (drawDateRaw.includes('No draw')) continue; // Skip no draw days

            const nums = row.slice(2, 7).map(v => parseInt(v, 10)).filter(n => !Number.isNaN(n));

            if (!contestRaw || !drawDateRaw || nums.length !== 5) continue;

            const drawDate = DateUtils.parseWeekdayDate(drawDateRaw);
            if (!drawDate) continue; // Reject invalid

            parsed.push({
                contest: contestRaw,
                drawDate: DateUtils.normalizeToYYYYMMDD(drawDate),
                displayDrawDate: DateUtils.formatHumanReadable(drawDate),
                winningNumbers: nums
            });
        }

        return parsed;
    }

    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        values.push(current.trim());
        return values;
    }

    getAllResults() {
        return this.results;
    }

    getResult(contest, drawDate) {
        return this.results.find(r => r.contest === contest && r.drawDate === drawDate) || null;
    }
}

// Global instance
const resultsFetcher = new ResultsFetcher();
