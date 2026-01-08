/**
 * POP-SORTE Admin Dashboard - Results Fetcher Module
 * 
 * This module handles fetching and caching of:
 * - Lottery results (winning numbers) from Google Sheets
 * 
 * Dependencies: admin-core.js (AdminCore)
 */

// ============================================
// Results Fetcher Module
// ============================================
window.ResultsFetcher = (function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    
    /**
     * Results sheet: Contains official lottery results
     * Columns: Contest, Draw Date, Number1, Number2, Number3, Number4, Number5, Saved At, Source
     */
    const RESULTS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OttNYHiecAuGG6IRX7lW6lkG5ciEcL8gp3g6lNrN9H8/export?format=csv&gid=300277644';

    /**
     * Cache TTL in milliseconds (3 minutes - matches refresh interval)
     */
    const CACHE_TTL = 180 * 1000;

    /**
     * Fetch timeout in milliseconds
     */
    const FETCH_TIMEOUT = 15 * 1000;

    // ============================================
    // Cache Storage
    // ============================================
    const cache = {
        results: { data: null, timestamp: 0 }
    };

    // Fetch lock to prevent simultaneous requests
    let fetchLock = false;

    // ============================================
    // Fetch Helper
    // ============================================
    
    /**
     * Fetch CSV data from Google Sheets with timeout
     * @param {string} url - Sheet export URL
     * @returns {Promise<string>} Raw CSV text
     */
    async function fetchCSV(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        
        try {
            const response = await fetch(`${url}&t=${Date.now()}`, {
                cache: 'no-store',
                redirect: 'follow',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();

            if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                throw new Error('Sheet not publicly accessible');
            }

            return text;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        }
    }

    // ============================================
    // Results Data
    // ============================================
    
    /**
     * Parse result row from CSV
     * @param {string[]} row - CSV row values
     * @returns {Object|null} Parsed result object or null if invalid
     */
    function parseResultRow(row) {
        // Expected columns: Contest, Draw Date, Num1, Num2, Num3, Num4, Num5, Saved At, Source
        const contest = (row[0] || '').trim();
        const drawDateRaw = (row[1] || '').trim();
        
        if (!contest) return null;

        // Check for "No draw" entries
        const fullRow = row.join(' ').toLowerCase();
        if (fullRow.includes('no draw')) {
            return {
                contest: contest,
                drawDate: drawDateRaw,
                drawDateParsed: null,
                numbers: [],
                isNoDraw: true,
                savedAt: row[7] || '',
                source: row[8] || ''
            };
        }

        // Parse winning numbers (columns 2-6)
        const numbers = [];
        for (let i = 2; i <= 6; i++) {
            const num = parseInt(row[i], 10);
            if (!isNaN(num) && num >= 1 && num <= 80) {
                numbers.push(num);
            }
        }

        // Must have exactly 5 numbers for valid draw
        if (numbers.length !== 5) {
            return null;
        }

        // Parse draw date
        let drawDateParsed = null;
        if (drawDateRaw) {
            // Try DD/MM/YYYY format
            const parts = drawDateRaw.split('/');
            if (parts.length === 3) {
                const [d, m, y] = parts.map(Number);
                if (d && m && y) {
                    drawDateParsed = new Date(y, m - 1, d);
                }
            }
        }

        return {
            contest: contest,
            drawDate: drawDateRaw,
            drawDateParsed: drawDateParsed,
            numbers: numbers.sort((a, b) => a - b),
            isNoDraw: false,
            savedAt: row[7] || '',
            source: row[8] || ''
        };
    }

    /**
     * Fetch all results from Google Sheet
     * @param {boolean} forceRefresh - Force refresh ignoring cache
     * @returns {Promise<Object[]>} Array of result objects
     */
    async function fetchResults(forceRefresh = false) {
        const now = Date.now();
        
        // Return cached data if valid
        if (!forceRefresh && cache.results.data && (now - cache.results.timestamp) < CACHE_TTL) {
            return cache.results.data;
        }

        // Return cached data if fetch is in progress - don't block, just use cache
        if (fetchLock) {
            console.log('Results fetch already in progress, using cached data');
            return cache.results.data || [];
        }

        fetchLock = true;

        try {
            const csvText = await fetchCSV(RESULTS_SHEET_URL);
            const lines = csvText.split(/\r?\n/).filter(Boolean);

            if (lines.length <= 1) {
                cache.results = { data: [], timestamp: now };
                fetchLock = false;
                return [];
            }

            const delimiter = AdminCore.detectDelimiter(lines[0]);
            const results = [];

            for (let i = 1; i < lines.length; i++) {
                const row = AdminCore.parseCSVLine(lines[i], delimiter);
                const result = parseResultRow(row);
                if (result) {
                    results.push(result);
                }
            }

            // Sort by contest number descending (newest first)
            results.sort((a, b) => {
                const contestA = parseInt(a.contest, 10) || 0;
                const contestB = parseInt(b.contest, 10) || 0;
                return contestB - contestA;
            });

            cache.results = { data: results, timestamp: now };
            fetchLock = false;
            return results;

        } catch (error) {
            console.error('Error fetching results:', error);
            fetchLock = false;
            if (cache.results.data) {
                return cache.results.data;
            }
            throw error;
        }
    }

    // ============================================
    // Result Lookup Helpers
    // ============================================
    
    /**
     * Get result by contest number
     * @param {string|number} contest - Contest number
     * @returns {Promise<Object|null>} Result object or null
     */
    async function getResultByContest(contest) {
        const results = await fetchResults();
        const contestStr = String(contest).trim();
        return results.find(r => r.contest === contestStr) || null;
    }

    /**
     * Get latest valid result (with numbers)
     * @returns {Promise<Object|null>} Latest result or null
     */
    async function getLatestResult() {
        const results = await fetchResults();
        return results.find(r => !r.isNoDraw && r.numbers.length === 5) || null;
    }

    /**
     * Get all valid results (excluding "No draw" entries)
     * @returns {Promise<Object[]>} Array of valid results
     */
    async function getValidResults() {
        const results = await fetchResults();
        return results.filter(r => !r.isNoDraw && r.numbers.length === 5);
    }

    /**
     * Get results for last N days
     * @param {number} days - Number of days
     * @returns {Promise<Object[]>} Filtered results
     */
    async function getResultsLastNDays(days = 7) {
        const results = await fetchResults();
        const now = AdminCore.getBrazilTime();
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - days);
        cutoff.setHours(0, 0, 0, 0);
        
        return results.filter(result => 
            result.drawDateParsed && result.drawDateParsed >= cutoff
        );
    }

    /**
     * Get unique contests from results
     * @returns {Promise<string[]>} Array of contest numbers
     */
    async function getUniqueContests() {
        const results = await fetchResults();
        return [...new Set(results.map(r => r.contest))];
    }

    /**
     * Get results map (contest -> result)
     * @returns {Promise<Map>} Map of contest to result
     */
    async function getResultsMap() {
        const results = await fetchResults();
        const map = new Map();
        results.forEach(r => {
            if (!r.isNoDraw) {
                map.set(r.contest, r);
            }
        });
        return map;
    }

    // ============================================
    // Cache Management
    // ============================================
    
    /**
     * Clear cached results
     */
    function clearCache() {
        cache.results = { data: null, timestamp: 0 };
    }

    /**
     * Get cache status
     * @returns {Object} Cache status info
     */
    function getCacheStatus() {
        const now = Date.now();
        return {
            loaded: cache.results.data !== null,
            count: cache.results.data ? cache.results.data.length : 0,
            age: cache.results.timestamp ? now - cache.results.timestamp : null,
            stale: cache.results.timestamp ? (now - cache.results.timestamp) > CACHE_TTL : true
        };
    }

    // Listen for refresh events
    if (typeof AdminCore !== 'undefined') {
        AdminCore.on('refresh', () => fetchResults(true));
    }

    // ============================================
    // Public API
    // ============================================
    return {
        // Fetch methods
        fetchResults,
        
        // Lookup helpers
        getResultByContest,
        getLatestResult,
        getValidResults,
        getResultsLastNDays,
        getUniqueContests,
        getResultsMap,
        
        // Cache management
        clearCache,
        getCacheStatus,
        
        // Constants
        CACHE_TTL
    };
})();

