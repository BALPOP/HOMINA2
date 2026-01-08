const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/14f_ipSqAq8KCP7aFrbIK9Ztbo33BnCw34DSk5ADdPgI/export?format=csv&gid=0';

class DataFetcher {
    constructor() {
        this.entries = [];
        this.lastFetchTime = null;
    }

    async fetchData() {
        try {
            const response = await fetch(GOOGLE_SHEET_CSV_URL);
            if (!response.ok) {
                throw new Error('Failed to fetch data from Google Sheets');
            }
            const csvText = await response.text();
            this.entries = this.parseCSV(csvText);
            this.lastFetchTime = new Date();
            return this.entries;
        } catch (error) {
            console.error('Error fetching data:', error);
            throw error;
        }
    }

    parseCSV(csvText) {
        const lines = csvText.split('\n');
        const entries = [];

        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = this.parseCSVLine(line);
            if (values.length < 10) continue;

            // Column 1: DATE (weekday format), Column 2: TIME (HH:MM:SS)
            const registrationDate = DateUtils.parseWeekdayDate(values[1]);
            const registrationTime = values[2]; // HH:MM:SS
            const drawDate = DateUtils.parseWeekdayDate(values[7]);

            if (!registrationDate || !drawDate || !registrationTime) continue; // Reject invalid dates

            const entry = {
                registrationDateTime: DateUtils.normalizeToYYYYMMDDHHMMSS(registrationDate, registrationTime),
                registrationDate: DateUtils.formatHumanReadable(registrationDate),
                registrationTime: registrationTime,
                platform: values[3],
                gameId: values[4],
                whatsapp: values[5],
                chosenNumbers: this.parseNumbers(values[6]),
                drawDate: DateUtils.normalizeToYYYYMMDD(drawDate),
                displayDrawDate: DateUtils.formatHumanReadable(drawDate),
                contest: values[8],
                ticketNumber: values[9],
                csvStatus: values[10] ? values[10].trim().toUpperCase() : ''  // Read column K for winners
            };

            entries.push(entry);
        }

        return entries;
    }

    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        values. push(current.trim());
        return values;
    }

    parseNumbers(numberString) {
        const numbers = numberString.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        return numbers;
    }

    getAllEntries() {
        return this.entries;
    }

    getEntryById(gameId) {
        return this.entries.find(entry => entry.gameId === gameId);
    }

    getEntriesByContest(contest) {
        return this.entries.filter(entry => entry.contest === contest);
    }

    getEntriesByDrawDate(drawDate) {
        return this.entries.filter(entry => entry.drawDate === drawDate);
    }

    getUniqueContests() {
        const contests = [...new Set(this.entries.map(entry => entry.contest))];
        return contests.sort();
    }

    getUniqueDrawDates() {
        const map = new Map();
        this.entries.forEach(e => {
            const display = e.displayDrawDate;
            const normalized = e.drawDate;
            if (!map.has(display)) map.set(display, normalized);
        });
        return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([display]) => display);
    }

    getStatistics() {
        const contestCounts = {};
        const dateCounts = {};
        
        this.entries.forEach(entry => {
            contestCounts[entry.contest] = (contestCounts[entry.contest] || 0) + 1;
            dateCounts[entry.drawDate] = (dateCounts[entry.drawDate] || 0) + 1;
        });
        
        return {
            totalEntries: this.entries.length,
            uniqueContests:  this.getUniqueContests().length,
            uniqueDrawDates: this.getUniqueDrawDates().length,
            pendingEntries: this.entries. filter(e => e.status === 'PENDENTE').length,
            contestBreakdown: contestCounts,
            dateBreakdown: dateCounts
        };
    }
}

// Global instance
const dataFetcher = new DataFetcher();