/**
 * POP-SORTE Admin Dashboard - Centralized Data Store
 * 
 * This module provides:
 * - Single fetch for all data, cached aggressively
 * - Quick counts without heavy processing
 * - On-demand validation/winner calculation for visible rows only
 * - localStorage persistence for instant subsequent loads
 * 
 * Architecture: Totals are fast, details are lazy-loaded
 * 
 * Dependencies: admin-core.js, data-fetcher.js, results-fetcher.js
 */

window.DataStore = (function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const STORAGE_KEY = 'popsorte_admin_data';
    const STORAGE_VERSION = 6; // Bumped to fix caching bugs - always fetch fresh on load
    const STORAGE_TTL = 2 * 60 * 1000; // 2 minutes localStorage cache (reduced for fresher data)
    const MIN_RECHARGE_AMOUNT = 1.0;

    // ============================================
    // State
    // ============================================
    let state = {
        entries: [],
        recharges: [],
        results: [],
        loaded: false,
        loading: false,
        lastFetch: 0,
        // Quick counts (calculated without heavy processing)
        counts: {
            totalEntries: 0,
            uniquePlayers: 0,
            totalRecharges: 0,
            uniqueRechargers: 0,
            totalResults: 0,
            // These are estimated until full validation runs
            estimatedValid: 0,
            estimatedInvalid: 0
        },
        // Validation cache - only for rows that have been validated
        validationCache: new Map(),
        // Winner cache - only calculated when needed
        winnerCache: null,
        winnerCacheKey: null
    };

    // ============================================
    // localStorage Persistence
    // ============================================

    /**
     * Save data to localStorage
     */
    function saveToStorage() {
        try {
            const data = {
                version: STORAGE_VERSION,
                timestamp: Date.now(),
                entries: state.entries.slice(0, 1000), // Store only first 1000 for quick load
                recharges: state.recharges.slice(0, 500),
                results: state.results,
                counts: state.counts
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }
    }

    /**
     * Reconstruct Date objects from stored data
     * JSON.stringify converts Date to ISO string, so we need to restore them
     * @param {Object} entry - Entry with serialized dates
     * @returns {Object} Entry with proper Date objects
     */
    function reconstructEntryDates(entry) {
        if (!entry) return entry;
        
        // Reconstruct parsedDate if it exists
        if (entry.parsedDate) {
            if (typeof entry.parsedDate === 'string') {
                entry.parsedDate = new Date(entry.parsedDate);
            }
            // Validate the date is valid
            if (!(entry.parsedDate instanceof Date) || isNaN(entry.parsedDate.getTime())) {
                entry.parsedDate = null;
            }
        }
        
        return entry;
    }

    /**
     * Reconstruct Date objects for recharge data
     * @param {Object} recharge - Recharge with serialized dates
     * @returns {Object} Recharge with proper Date objects
     */
    function reconstructRechargeDates(recharge) {
        if (!recharge) return recharge;
        
        // Reconstruct rechargeTime if it exists
        if (recharge.rechargeTime) {
            if (typeof recharge.rechargeTime === 'string') {
                recharge.rechargeTime = new Date(recharge.rechargeTime);
            }
            // Validate the date is valid
            if (!(recharge.rechargeTime instanceof Date) || isNaN(recharge.rechargeTime.getTime())) {
                recharge.rechargeTime = null;
            }
        }
        
        return recharge;
    }

    /**
     * Clear stored data (call when version mismatch or data is corrupt)
     */
    function clearStorage() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            console.log('Cleared localStorage cache');
        } catch (e) {
            console.warn('Could not clear localStorage:', e);
        }
    }

    /**
     * Load data from localStorage
     * @returns {boolean} True if valid data was loaded
     */
    function loadFromStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;

            const data = JSON.parse(stored);
            
            // Check version - if mismatch, clear and return false
            if (data.version !== STORAGE_VERSION) {
                console.log('Storage version mismatch, clearing cache');
                clearStorage();
                return false;
            }
            
            // Check TTL
            if (Date.now() - data.timestamp > STORAGE_TTL) {
                console.log('Storage cache expired, clearing');
                clearStorage();
                return false;
            }

            // Validate data integrity - check if entries array exists and has proper structure
            if (!Array.isArray(data.entries) || data.entries.length === 0) {
                console.log('Storage data invalid, clearing');
                clearStorage();
                return false;
            }

            // Restore partial data for instant display
            // Reconstruct Date objects that were serialized to strings
            state.entries = (data.entries || []).map(reconstructEntryDates);
            state.recharges = (data.recharges || []).map(reconstructRechargeDates);
            state.results = data.results || [];
            state.counts = data.counts || state.counts;
            state.lastFetch = data.timestamp;

            console.log('Loaded from localStorage:', state.counts.totalEntries, 'entries');
            return true;
        } catch (e) {
            console.warn('Could not load from localStorage, clearing:', e);
            clearStorage();
            return false;
        }
    }

    // ============================================
    // Quick Count Calculations (No Heavy Processing)
    // ============================================

    /**
     * Calculate quick counts from raw data
     * This is FAST - just counting, no validation
     */
    function calculateQuickCounts() {
        const entries = state.entries;
        const recharges = state.recharges;
        const results = state.results;

        // Build sets for unique counts
        const playerIds = new Set();
        const rechargerIds = new Set();
        const rechargerIdSet = new Set();

        entries.forEach(e => {
            if (e.gameId) playerIds.add(e.gameId);
        });

        recharges.forEach(r => {
            if (r.gameId) {
                rechargerIds.add(r.gameId);
                rechargerIdSet.add(r.gameId);
            }
        });

        // Estimate valid/invalid based on gameId presence in recharges
        // This is an ESTIMATE - actual validation is more complex
        let estimatedValid = 0;
        let estimatedInvalid = 0;

        entries.forEach(e => {
            if (e.gameId && rechargerIdSet.has(e.gameId)) {
                estimatedValid++;
            } else {
                estimatedInvalid++;
            }
        });

        state.counts = {
            totalEntries: entries.length,
            uniquePlayers: playerIds.size,
            totalRecharges: recharges.length,
            uniqueRechargers: rechargerIds.size,
            totalResults: results.length,
            estimatedValid,
            estimatedInvalid
        };

        return state.counts;
    }

    // ============================================
    // Data Loading
    // ============================================

    /**
     * Initial load - fetches all data once
     * Shows cached data immediately, then ALWAYS refreshes from network
     * @param {boolean} forceRefresh - Force network refresh (bypasses cache check)
     * @returns {Promise<Object>} Current counts
     */
    async function loadData(forceRefresh = false) {
        // If already loading, return current state
        if (state.loading) {
            return state.counts;
        }

        // Track if this is the first load
        const isFirstLoad = !state.loaded;
        
        // Try localStorage first for IMMEDIATE display only (not as final data)
        if (isFirstLoad) {
            const hasCache = loadFromStorage();
            if (hasCache) {
                AdminCore.emit('dataStoreReady', { fromCache: true, counts: state.counts });
            }
        }

        // ALWAYS fetch from network on first load, or if forceRefresh, or if cache expired
        const now = Date.now();
        const cacheExpired = (now - state.lastFetch) >= DataFetcher.CACHE_TTL;
        const shouldFetchFromNetwork = isFirstLoad || forceRefresh || cacheExpired;
        
        if (!shouldFetchFromNetwork && state.loaded) {
            return state.counts;
        }

        // Show loading overlay with progress (only if not already shown)
        if (isFirstLoad || forceRefresh) {
            AdminCore.showLoading('Loading data...');
            AdminCore.updateLoadingProgress(0, 'Starting...');
        }
        state.loading = true;

        try {
            // Fetch all data with progress updates
            AdminCore.updateLoadingProgress(5, 'Fetching entries...');
            const entries = await DataFetcher.fetchEntries(isFirstLoad || forceRefresh);
            
            AdminCore.updateLoadingProgress(30, 'Fetching recharges...');
            const recharges = await DataFetcher.fetchRecharges(isFirstLoad || forceRefresh);
            
            AdminCore.updateLoadingProgress(50, 'Fetching results...');
            const results = await ResultsFetcher.fetchResults(isFirstLoad || forceRefresh);

            AdminCore.updateLoadingProgress(60, 'Processing data...');
            state.entries = entries;
            state.recharges = recharges;
            state.results = results;
            state.lastFetch = Date.now();
            state.loaded = true;

            // Clear validation cache when data changes
            state.validationCache.clear();
            state.winnerCache = null;

            // Calculate quick counts
            calculateQuickCounts();

            AdminCore.updateLoadingProgress(65, 'Data ready...');
            
            // Save to localStorage for next visit
            saveToStorage();

            AdminCore.emit('dataStoreReady', { fromCache: false, counts: state.counts });

            // DON'T hide loading here - let unified-page.js handle it after rendering

            return state.counts;
        } catch (error) {
            AdminCore.hideLoading();
            throw error;
        } finally {
            state.loading = false;
        }
    }

    // ============================================
    // On-Demand Validation (For Visible Rows Only)
    // ============================================

    /**
     * Validate a single entry against recharges
     * Results are cached for future lookups
     * @param {Object} entry - Entry to validate
     * @returns {Object} Validation result
     */
    function validateEntry(entry) {
        if (!entry || !entry.ticketNumber) {
            return { status: 'UNKNOWN', reason: 'Invalid entry' };
        }

        // Check cache first
        const cacheKey = entry.ticketNumber;
        if (state.validationCache.has(cacheKey)) {
            return state.validationCache.get(cacheKey);
        }

        // Perform validation
        const result = performValidation(entry);
        
        // Cache result
        state.validationCache.set(cacheKey, result);
        
        return result;
    }

    /**
     * Perform actual validation logic
     * @param {Object} entry - Entry to validate
     * @returns {Object} Validation result
     */
    function performValidation(entry) {
        const recharges = state.recharges;
        
        if (!entry.gameId) {
            return { status: 'INVALID', reason: 'No Game ID', isCutoff: false };
        }

        // Find recharges for this game ID
        const playerRecharges = recharges.filter(r => r.gameId === entry.gameId);
        
        if (playerRecharges.length === 0) {
            return { status: 'INVALID', reason: 'No recharge found', isCutoff: false };
        }

        // Check for valid recharge timing
        // Validate entryTime is a proper Date object
        const entryTime = entry.parsedDate;
        if (!entryTime || !(entryTime instanceof Date) || isNaN(entryTime.getTime())) {
            return { status: 'INVALID', reason: 'Invalid entry timestamp', isCutoff: false };
        }

        // Check cutoff (20:00 BRT)
        const entryHour = entryTime.getHours();
        const isCutoff = entryHour >= 20;

        // Find a valid recharge
        for (const recharge of playerRecharges) {
            // Validate rechargeTime is a proper Date object
            if (!recharge.rechargeTime || !(recharge.rechargeTime instanceof Date) || isNaN(recharge.rechargeTime.getTime())) continue;
            if (recharge.amount < MIN_RECHARGE_AMOUNT) continue;

            // Recharge must be before or within same draw window as entry
            if (recharge.rechargeTime <= entryTime) {
                return {
                    status: 'VALID',
                    reason: 'Valid recharge found',
                    isCutoff,
                    matchedRecharge: recharge
                };
            }
        }

        return { status: 'INVALID', reason: 'No valid recharge timing', isCutoff };
    }

    /**
     * Validate a batch of entries (for table page)
     * @param {Object[]} entries - Entries to validate
     * @returns {Map} Map of ticketNumber -> validation result
     */
    function validateBatch(entries) {
        const results = new Map();
        
        for (const entry of entries) {
            const validation = validateEntry(entry);
            results.set(entry.ticketNumber, validation);
        }
        
        return results;
    }

    /**
     * Get accurate validation counts (runs validation on all entries)
     * This is SLOW - only call when needed
     * @returns {Promise<Object>} Accurate validation counts
     */
    async function getAccurateValidationCounts() {
        // Use cached validation if available
        const cachedCounts = DataFetcher.getCachedValidation();
        if (cachedCounts) {
            return cachedCounts;
        }

        // Process in batches to keep UI responsive
        const entries = state.entries;
        const batchSize = 100;
        let validCount = 0;
        let invalidCount = 0;
        let unknownCount = 0;

        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            
            for (const entry of batch) {
                const validation = validateEntry(entry);
                switch (validation.status) {
                    case 'VALID': validCount++; break;
                    case 'INVALID': invalidCount++; break;
                    default: unknownCount++;
                }
            }

            // Yield to UI
            if (i + batchSize < entries.length) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        const result = { valid: validCount, invalid: invalidCount, unknown: unknownCount };
        DataFetcher.setCachedValidation(result);
        
        return result;
    }

    // ============================================
    // Platform Filtering
    // ============================================

    /**
     * Filter entries by platform
     * @param {Object[]} entries - All entries
     * @param {string} platform - Platform code (ALL, POPN1, POPLUZ)
     * @returns {Object[]} Filtered entries
     */
    function filterByPlatform(entries, platform) {
        if (!platform || platform === 'ALL') {
            return entries;
        }
        return entries.filter(e => (e.platform || 'POPN1').toUpperCase() === platform.toUpperCase());
    }

    /**
     * Get entries grouped by platform with counts
     * @param {Object[]} entries - All entries
     * @returns {Object} Platform breakdown { POPN1: { count, entries }, POPLUZ: { count, entries } }
     */
    function getEntriesByPlatform(entries) {
        const breakdown = {
            POPN1: { count: 0, entries: [] },
            POPLUZ: { count: 0, entries: [] }
        };
        
        entries.forEach(e => {
            const platform = (e.platform || 'POPN1').toUpperCase();
            if (breakdown[platform]) {
                breakdown[platform].count++;
                breakdown[platform].entries.push(e);
            } else {
                // Default to POPN1 if unknown platform
                breakdown.POPN1.count++;
                breakdown.POPN1.entries.push(e);
            }
        });
        
        return breakdown;
    }

    /**
     * Get platform-filtered counts
     * @param {string} platform - Platform code
     * @returns {Object} Counts for the platform
     */
    function getPlatformCounts(platform) {
        const entries = filterByPlatform(state.entries, platform);
        
        // Get platform-filtered recharges (only recharges for users in this platform)
        const platformGameIds = new Set(entries.map(e => e.gameId).filter(Boolean));
        const recharges = (!platform || platform === 'ALL') 
            ? state.recharges 
            : state.recharges.filter(r => r.gameId && platformGameIds.has(r.gameId));
        
        const playerIds = new Set();
        const rechargerIds = new Set();
        
        entries.forEach(e => {
            if (e.gameId) playerIds.add(e.gameId);
        });
        
        recharges.forEach(r => {
            if (r.gameId) rechargerIds.add(r.gameId);
        });
        
        return {
            totalEntries: entries.length,
            uniquePlayers: playerIds.size,
            totalRecharges: recharges.length,
            uniqueRechargers: rechargerIds.size,
            totalResults: state.results.length
        };
    }

    // ============================================
    // Getters
    // ============================================

    function getEntries(platform) { 
        return filterByPlatform(state.entries, platform || AdminCore.getCurrentPlatform()); 
    }
    function getAllEntries() { return state.entries; }
    function getAllRecharges() { return state.recharges; }
    
    /**
     * Get recharges filtered by platform
     * Filters recharges to only those whose gameId exists in the platform-filtered entries
     * @param {string} platform - Platform code (ALL, POPN1, POPLUZ)
     * @returns {Object[]} Filtered recharges
     */
    function getRecharges(platform) {
        const currentPlatform = platform || AdminCore.getCurrentPlatform();
        
        // If ALL platforms, return all recharges
        if (!currentPlatform || currentPlatform === 'ALL') {
            return state.recharges;
        }
        
        // Get game IDs that belong to this platform
        const platformEntries = filterByPlatform(state.entries, currentPlatform);
        const platformGameIds = new Set(platformEntries.map(e => e.gameId).filter(Boolean));
        
        // Filter recharges to only those with game IDs from this platform
        return state.recharges.filter(r => r.gameId && platformGameIds.has(r.gameId));
    }
    function getResults() { return state.results; }
    function getCounts(platform) { 
        if (platform && platform !== 'ALL') {
            return getPlatformCounts(platform);
        }
        return state.counts; 
    }
    function isLoaded() { return state.loaded; }
    function isLoading() { return state.loading; }

    /**
     * Get entries for a specific page
     * @param {number} page - Page number (1-indexed)
     * @param {number} perPage - Items per page
     * @param {Object} filters - Optional filters
     * @returns {Object} { entries, total, validated }
     */
    function getEntriesPage(page, perPage, filters = {}) {
        let filtered = state.entries;

        // Apply filters
        if (filters.gameId) {
            filtered = filtered.filter(e => 
                e.gameId.toLowerCase().includes(filters.gameId.toLowerCase())
            );
        }
        if (filters.whatsapp) {
            filtered = filtered.filter(e => 
                e.whatsapp.includes(filters.whatsapp)
            );
        }
        if (filters.contest) {
            filtered = filtered.filter(e => e.contest === filters.contest);
        }
        if (filters.drawDate) {
            filtered = filtered.filter(e => e.drawDate === filters.drawDate);
        }

        const total = filtered.length;
        const start = (page - 1) * perPage;
        const pageEntries = filtered.slice(start, start + perPage);

        // Validate only the visible entries
        const validationMap = validateBatch(pageEntries);

        // Apply validation filters if needed
        if (filters.validity && filters.validity !== 'all') {
            const allFiltered = [];
            for (const e of filtered) {
                const v = validateEntry(e);
                if (filters.validity === 'valid' && v.status === 'VALID') allFiltered.push(e);
                else if (filters.validity === 'invalid' && v.status === 'INVALID') allFiltered.push(e);
                else if (filters.validity === 'unknown' && v.status === 'UNKNOWN') allFiltered.push(e);
            }
            filtered = allFiltered;
            const newTotal = filtered.length;
            const newPageEntries = filtered.slice(start, start + perPage);
            return {
                entries: newPageEntries,
                total: newTotal,
                validationMap: validateBatch(newPageEntries)
            };
        }

        return {
            entries: pageEntries,
            total,
            validationMap
        };
    }

    // ============================================
    // Statistics Helpers
    // ============================================

    /**
     * Get entries grouped by date for charts
     * @param {number} days - Number of days
     * @returns {Object[]} Array of { date, count }
     */
    function getEntriesByDate(days = 7) {
        const now = AdminCore.getBrazilTime();
        const result = [];

        // Pre-compute date strings for all entries (optimization)
        const entriesByDateStr = new Map();
        state.entries.forEach(e => {
            if (e.parsedDate && e.parsedDate instanceof Date && !isNaN(e.parsedDate.getTime())) {
                const dateStr = AdminCore.getBrazilDateString(e.parsedDate);
                if (dateStr) {
                    entriesByDateStr.set(dateStr, (entriesByDateStr.get(dateStr) || 0) + 1);
                }
            }
        });

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = AdminCore.getBrazilDateString(date);
            
            // Use pre-computed map instead of filtering entire array
            const count = entriesByDateStr.get(dateStr) || 0;
            result.push({ date: dateStr, count });
        }

        return result;
    }

    /**
     * Get unique contests
     * @returns {string[]} Array of contest numbers
     */
    function getUniqueContests() {
        const contests = new Set();
        state.entries.forEach(e => {
            if (e.contest) contests.add(e.contest);
        });
        return Array.from(contests).sort((a, b) => parseInt(b) - parseInt(a));
    }

    /**
     * Get unique draw dates
     * @returns {string[]} Array of draw dates
     */
    function getUniqueDrawDates() {
        const dates = new Set();
        state.entries.forEach(e => {
            if (e.drawDate) dates.add(e.drawDate);
        });
        return Array.from(dates).sort().reverse();
    }

    /**
     * Get latest entries (no validation, fast)
     * @param {number} count - Number to return
     * @returns {Object[]} Latest entries
     */
    function getLatestEntries(count = 10) {
        return state.entries.slice(0, count);
    }

    /**
     * Get top players by entry count
     * @param {number} limit - Max to return
     * @returns {Object[]} Array of { gameId, whatsapp, count }
     */
    function getTopPlayers(limit = 10) {
        const counts = {};
        
        state.entries.forEach(e => {
            if (!e.gameId) return;
            if (!counts[e.gameId]) {
                counts[e.gameId] = { gameId: e.gameId, whatsapp: e.whatsapp, count: 0 };
            }
            counts[e.gameId].count++;
        });

        return Object.values(counts)
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    // ============================================
    // Public API
    // ============================================
    return {
        // Loading
        loadData,
        isLoaded,
        isLoading,

        // Raw data getters
        getEntries,
        getAllEntries,
        getRecharges,
        getAllRecharges,
        getResults,
        getCounts,

        // Platform filtering
        filterByPlatform,
        getEntriesByPlatform,
        getPlatformCounts,

        // Paginated/filtered getters
        getEntriesPage,
        getLatestEntries,
        getTopPlayers,

        // Statistics
        getEntriesByDate,
        getUniqueContests,
        getUniqueDrawDates,

        // Validation (on-demand)
        validateEntry,
        validateBatch,
        getAccurateValidationCounts,

        // Storage
        saveToStorage,
        loadFromStorage,
        clearStorage
    };
})();

