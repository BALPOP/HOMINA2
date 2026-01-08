/**
 * POP-SORTE Admin Dashboard - Unified Page Module
 * 
 * This module combines Dashboard, Entries, Results, and Winners into a single
 * scrollable page. All sections load together and sidebar navigation scrolls
 * to the appropriate section.
 * 
 * Features:
 * - Single-page layout with scroll navigation
 * - Platform filtering (ALL, POPN1, POPLUZ)
 * - Unified data loading
 * - Real-time updates
 * 
 * Dependencies: AdminCore, DataStore, DataFetcher, ResultsFetcher, 
 *               RechargeValidator, WinnerCalculator, AdminCharts
 */

window.UnifiedPage = (function () {
    'use strict';

    // ============================================
    // State
    // ============================================
    let isInitialized = false;
    let currentData = {
        entries: [],
        allEntries: [],
        recharges: [],      // Platform-filtered recharges
        allRecharges: [],   // All recharges (for validation)
        results: [],
        validationResults: null
    };

    // Entries pagination state
    let filteredEntries = [];
    let entriesPage = 1;
    let entriesPerPage = 25;
    let entriesFilters = {
        gameId: '',
        whatsapp: '',
        contest: '',
        validity: 'all',
        orderNumber: ''
    };
    let sortBy = 'date-desc'; // Default: newest first

    /**
     * Check if entry was registered after cutoff time (20:00 BRT, 16:00 on Dec 24/31)
     * @param {Object} entry - Entry object with parsedDate
     * @returns {boolean} True if after cutoff
     */
    function isEntryCutoff(entry) {
        if (!entry.parsedDate || !(entry.parsedDate instanceof Date) || isNaN(entry.parsedDate.getTime())) {
            return false;
        }

        // Get matched recharge for this entry
        const lookupKey = `${entry.gameId}-${entry.parsedDate.getTime()}`;
        const bruteForceMatch = entryRechargeMap.get(lookupKey);

        if (!bruteForceMatch || !bruteForceMatch.recordTime) {
            return false;
        }

        const rechargeTime = bruteForceMatch.recordTime;
        const ticketTime = entry.parsedDate;

        // Get eligibility window to determine Day 1 and Day 2
        const window = calculateEligibilityWindow(rechargeTime);
        if (!window) {
            return false;
        }

        // Compare dates directly (more efficient than string formatting)
        // Normalize dates to midnight for comparison
        const ticketDate = new Date(ticketTime);
        ticketDate.setUTCHours(0, 0, 0, 0);

        const eligDay1Date = new Date(window.eligibilityDay1);
        eligDay1Date.setUTCHours(0, 0, 0, 0);

        const eligDay2Date = new Date(window.eligibilityDay2);
        eligDay2Date.setUTCHours(0, 0, 0, 0);

        const partDay1Date = new Date(window.day1);
        partDay1Date.setUTCHours(0, 0, 0, 0);

        const partDay2Date = new Date(window.day2);
        partDay2Date.setUTCHours(0, 0, 0, 0);

        // Check if ticket is on eligibility Day 1 or Day 2 (when tickets can be created)
        const isOnEligibilityDay1 = ticketDate.getTime() === eligDay1Date.getTime();
        const isOnEligibilityDay2 = ticketDate.getTime() === eligDay2Date.getTime();

        // Check if Day 2 participation exists and is different from Day 1 participation
        const hasDay2Participation = partDay1Date.getTime() !== partDay2Date.getTime();

        if (isOnEligibilityDay1) {
            // Ticket created on eligibility Day 1
            // If Day 2 participation exists, check if ticket was created AFTER 8 PM
            if (hasDay2Participation) {
                // Get hour in Brazilian timezone
                // parseBrazilDateTime stores dates as UTC with BRT hour + 3
                // So BRT 20:36 → UTC 23:36
                // To get BRT from UTC: UTC - 3 (with wraparound)
                const utcHour = ticketTime.getUTCHours();
                const brtHour = (utcHour - 3 + 24) % 24; // Convert UTC to BRT (subtract 3, handle wraparound)
                return brtHour >= 20; // After 8 PM on eligibility Day 1 → CUTOFF
            }
            return false; // No Day 2 participation, no cutoff
        } else if (isOnEligibilityDay2) {
            // Ticket created on eligibility Day 2
            // CUTOFF if Day 2 participation exists and is different from Day 1
            return hasDay2Participation; // On eligibility Day 2 → CUTOFF only if Day 2 participation exists
        }

        return false;
    }

    // Results state
    let filteredResults = [];
    let resultsSearchTerm = '';

    // Winners state
    let allWinners = [];
    let filteredWinners = [];
    let winnersCalculation = null;
    let winnersFilters = {
        contest: '',
        prizeLevel: 'all'
    };

    // Statistics day range (7, 14, or 30 days)
    let statisticsDays = 7;

    // Validation cache
    let validationMap = new Map();

    // ============================================
    // DASHBOARD SECTION
    // ============================================

    function renderDashboard() {
        const { entries, allEntries, recharges, results } = currentData;
        const platform = AdminCore.getCurrentPlatform();

        // Platform label
        const platformLabel = document.getElementById('platformStatsLabel');
        if (platformLabel) {
            platformLabel.textContent = platform === 'ALL' ? 'All Platforms' : platform;
            platformLabel.className = `badge badge-${platform === 'ALL' ? 'info' : platform === 'POPN1' ? 'primary' : 'warning'}`;
        }

        // Platform breakdown visibility
        const breakdownEl = document.getElementById('platformBreakdown');
        if (breakdownEl) {
            breakdownEl.style.display = platform === 'ALL' ? 'grid' : 'none';
        }

        // Stats
        document.getElementById('statTotalTickets').textContent = entries.length.toLocaleString();

        const contests = new Set(entries.map(e => e.contest).filter(Boolean));
        document.getElementById('statTotalContests').textContent = contests.size.toLocaleString();

        const drawDates = new Set(entries.map(e => e.drawDate).filter(Boolean));
        document.getElementById('statDrawDates').textContent = drawDates.size.toLocaleString();

        const pending = entries.filter(e => {
            const status = (e.status || '').toUpperCase();
            return !['VALID', 'VALIDADO', 'INVALID', 'INVÁLIDO'].includes(status);
        });
        document.getElementById('statPending').textContent = pending.length.toLocaleString();

        // Platform breakdown
        if (platform === 'ALL' && allEntries.length > 0) {
            const breakdown = DataStore.getEntriesByPlatform(allEntries);
            document.getElementById('statPOPN1Tickets').textContent = breakdown.POPN1.count.toLocaleString() + ' tickets';
            document.getElementById('statPOPLUZTickets').textContent = breakdown.POPLUZ.count.toLocaleString() + ' tickets';
        }

        // Engagement
        renderEngagement();

        // Charts
        renderCharts();

        // Recharge vs Tickets table
        renderRechargeTable();

        // Top Entrants
        renderTopEntrants();

        // Latest Entries
        renderLatestEntries();

        // Winners stats (async)
        renderWinnersStats();
    }

    function renderEngagement() {
        const { entries, recharges } = currentData;

        if (!recharges || recharges.length === 0) {
            const uniqueCreators = new Set(entries.map(e => e.gameId).filter(Boolean));
            document.getElementById('statRechargers').textContent = '-';
            document.getElementById('statParticipants').textContent = uniqueCreators.size.toLocaleString();
            document.getElementById('statNoTicket').textContent = '-';
            document.getElementById('statParticipationRate').textContent = '-';
        } else {
            const engagement = RechargeValidator.analyzeEngagement(entries, recharges);
            document.getElementById('statRechargers').textContent = engagement.totalRechargers.toLocaleString();
            document.getElementById('statParticipants').textContent = engagement.totalParticipants.toLocaleString();
            document.getElementById('statNoTicket').textContent = engagement.rechargedNoTicket.toLocaleString();
            document.getElementById('statParticipationRate').textContent = `${engagement.participationRate}%`;
        }
    }

    function renderCharts() {
        const { entries, recharges } = currentData;

        // Ticket creators chart (configurable days)
        const dailyCreators = WinnerCalculator.getTicketCreatorsByDay(entries, statisticsDays);
        const canvas1 = document.getElementById('chartTicketCreators7Day');
        if (canvas1) {
            AdminCharts.createTicketCreators7DayChart(canvas1, dailyCreators);
        }

        // Statistics chart (configurable days)
        const dailyData = RechargeValidator.analyzeEngagementByDate(entries, recharges, statisticsDays);
        const canvas2 = document.getElementById('chartLast7Days');
        if (canvas2) {
            const metric = document.getElementById('chartMetricSelect')?.value || 'all';
            AdminCharts.createLast7DaysChart(canvas2, dailyData, metric);
        }
    }

    function renderRechargeTable() {
        const { entries, recharges } = currentData;
        const dailyData = RechargeValidator.analyzeEngagementByDate(entries, recharges, statisticsDays);

        const tbody = document.getElementById('rechargeVsTicketsBody');
        if (!tbody) return;

        if (dailyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No data</td></tr>';
            return;
        }

        const hasRechargeData = recharges && recharges.length > 0;

        tbody.innerHTML = dailyData.map(day => `
            <tr>
                <td><strong>${day.displayDate}</strong></td>
                <td>${hasRechargeData ? day.totalRechargers : '-'}</td>
                <td>${hasRechargeData ? day.totalParticipants : '-'}</td>
                <td class="text-warning">${hasRechargeData ? day.rechargedNoTicket : '-'}</td>
                <td class="text-success">${hasRechargeData ? day.participationRate + '%' : '-'}</td>
                <td><strong>${day.totalEntries}</strong></td>
            </tr>
        `).join('');
    }

    function updateStatisticsTitles() {
        // Update titles to reflect selected day range
        const dayText = statisticsDays === 7 ? '7 Days' : statisticsDays === 14 ? '14 Days' : '30 Days';

        const ticketCreatorsTitle = document.querySelector('#chartTicketCreators7Day')?.closest('.card')?.querySelector('.card-title');
        if (ticketCreatorsTitle) {
            ticketCreatorsTitle.textContent = `🎫 Ticket Creators (${dayText})`;
        }

        const lastDaysTitle = document.querySelector('#chartLast7Days')?.closest('.section')?.querySelector('.section-title');
        if (lastDaysTitle) {
            lastDaysTitle.textContent = `📈 Last ${dayText} Statistics`;
        }

        const rechargeTableTitle = document.querySelector('#rechargeVsTicketsBody')?.closest('.section')?.querySelector('.section-title');
        if (rechargeTableTitle) {
            rechargeTableTitle.textContent = `💰 Recharge vs Tickets (${dayText})`;
        }
    }

    function renderTopEntrants() {
        const { entries } = currentData;
        const topEntrants = DataFetcher.getTopEntrants(entries, 10);

        const tbody = document.getElementById('topEntrantsBody');
        if (!tbody) return;

        if (topEntrants.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No data</td></tr>';
            return;
        }

        tbody.innerHTML = topEntrants.map((entrant, index) => `
            <tr>
                <td><span class="badge badge-${index < 3 ? 'warning' : 'info'}">${index + 1}</span></td>
                <td><strong>${entrant.gameId}</strong></td>
                <td>${entrant.whatsapp || ''}</td>
                <td>${entrant.count.toLocaleString()}</td>
            </tr>
        `).join('');
    }

    function renderLatestEntries() {
        const { entries } = currentData;
        const latest = entries.slice(0, 10);

        const tbody = document.getElementById('latestEntriesContainer');
        if (!tbody) return;

        if (latest.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No entries</td></tr>';
            return;
        }

        tbody.innerHTML = latest.map(entry => {
            const time = entry.parsedDate
                ? AdminCore.formatBrazilDateTime(entry.parsedDate, { hour: '2-digit', minute: '2-digit' })
                : '--:--';

            const numbersHtml = entry.numbers.slice(0, 5).map(n => {
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2, '0')}</span>`;
            }).join('');

            const platform = (entry.platform || 'POPN1').toUpperCase();
            const platformClass = platform === 'POPLUZ' ? 'popluz' : 'popn1';

            return `
                <tr>
                    <td style="font-size:0.85rem">${time}</td>
                    <td><strong>${entry.gameId}</strong></td>
                    <td><span class="platform-badge ${platformClass}">${platform}</span></td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td>${entry.contest}</td>
                </tr>
            `;
        }).join('');
    }

    async function renderWinnersStats() {
        try {
            const { entries, results } = currentData;
            const platform = AdminCore.getCurrentPlatform();
            const winnerStats = await WinnerCalculator.getWinnerStats(entries, results, platform);

            document.getElementById('statTotalWinners').textContent = winnerStats.totalWinners.toLocaleString();
            document.getElementById('statWinRate').textContent = `${winnerStats.winRate}%`;
        } catch (error) {
            // Error handling - silent fail
        }
    }

    // ============================================
    // ENTRIES SECTION
    // ============================================

    async function renderEntries() {
        const { entries, recharges, allRecharges, validationResults } = currentData;

        // Data loaded and ready for rendering

        // Stats - ✅ COUNT DIRECTLY FROM CSV STATUS COLUMN + CUTOFF DETECTION
        const validCount = entries.filter(e => {
            const status = (e.status || '').toUpperCase();
            return status === 'VALID' || status === 'VÁLIDO';
        }).length;

        const invalidCount = entries.filter(e => {
            const status = (e.status || '').toUpperCase();
            return status === 'INVALID' || status === 'INVÁLIDO';
        }).length;

        const cutoffCount = entries.filter(e => isEntryCutoff(e)).length;

        document.getElementById('statValid').textContent = validCount.toLocaleString();
        document.getElementById('statInvalid').textContent = invalidCount.toLocaleString();
        document.getElementById('statCutoff').textContent = cutoffCount.toLocaleString();

        // Show platform-filtered recharge count
        document.getElementById('statRechargesCount').textContent = recharges.length.toLocaleString();

        // Validation banner
        const banner = document.getElementById('validationBanner');
        const platform = AdminCore.getCurrentPlatform();
        if (banner) {
            if (allRecharges.length === 0) {
                banner.className = 'status-banner warning';
                banner.innerHTML = '<span class="status-banner-icon">⚠️</span><span class="status-banner-text">Recharge data not loaded.</span>';
            } else if (validationResults) {
                banner.className = 'status-banner success';
                const platformNote = platform === 'ALL' ? '' : ` (${recharges.length} for ${platform})`;
                banner.innerHTML = `<span class="status-banner-icon">✅</span><span class="status-banner-text">Validation complete. ${allRecharges.length} total recharges${platformNote}.</span>`;
            }
        }

        // Build validation map (NOTE: This map may have issues with duplicate ticket numbers)
        // The table rendering now uses direct validation result matching instead
        validationMap.clear();
        if (validationResults) {
            let validCount = 0;
            let invalidCount = 0;
            validationResults.results.forEach(v => {
                if (v.ticket?.ticketNumber) {
                    validationMap.set(v.ticket.ticketNumber, v);
                }
                if (v.status === 'VALID') validCount++;
                if (v.status === 'INVALID') invalidCount++;
            });
            // Validation map built
        }

        // Populate filter options
        const contests = [...new Set(entries.map(e => e.contest).filter(Boolean))].sort((a, b) => parseInt(b) - parseInt(a));
        const contestSelect = document.getElementById('filterContest');
        if (contestSelect) {
            contestSelect.innerHTML = '<option value="">All</option>' + contests.map(c => `<option value="${c}">${c}</option>`).join('');
        }

        // Apply filters
        applyEntriesFilters();
    }

    function applyEntriesFilters() {
        let result = [...currentData.entries];

        if (entriesFilters.gameId) {
            const term = entriesFilters.gameId.toLowerCase();
            result = result.filter(e => e.gameId.toLowerCase().includes(term));
        }
        if (entriesFilters.whatsapp) {
            const term = entriesFilters.whatsapp.toLowerCase();
            result = result.filter(e => (e.whatsapp || '').toLowerCase().includes(term));
        }
        if (entriesFilters.orderNumber) {
            const term = entriesFilters.orderNumber.toLowerCase();
            result = result.filter(e => {
                // Check if entry has a matched recharge with this order number
                const lookupKey = `${e.gameId}-${e.parsedDate?.getTime()}`;
                const match = entryRechargeMap.get(lookupKey);
                return match && match.orderNumber.toLowerCase().includes(term);
            });
        }
        if (entriesFilters.contest) {
            result = result.filter(e => e.contest === entriesFilters.contest);
        }
        if (entriesFilters.validity !== 'all') {
            result = result.filter(e => {
                // ✅ READ STATUS DIRECTLY FROM CSV (Column H - STATUS)
                const csvStatus = (e.status || 'UNKNOWN').toUpperCase();
                const isValid = csvStatus === 'VALID' || csvStatus === 'VÁLIDO';
                const isInvalid = csvStatus === 'INVALID' || csvStatus === 'INVÁLIDO';
                return entriesFilters.validity === 'valid' ? isValid : isInvalid;
            });
        }

        // ✅ APPLY SORTING
        switch (sortBy) {
            case 'date-asc':
                result.sort((a, b) => {
                    if (!a.parsedDate || !b.parsedDate) return 0;
                    return a.parsedDate.getTime() - b.parsedDate.getTime();
                });
                break;
            case 'date-desc':
                result.sort((a, b) => {
                    if (!a.parsedDate || !b.parsedDate) return 0;
                    return b.parsedDate.getTime() - a.parsedDate.getTime();
                });
                break;
            case 'cutoff-yes':
                result.sort((a, b) => {
                    const aCutoff = isEntryCutoff(a) ? 1 : 0;
                    const bCutoff = isEntryCutoff(b) ? 1 : 0;
                    return bCutoff - aCutoff; // Cutoff first
                });
                break;
            case 'cutoff-no':
                result.sort((a, b) => {
                    const aCutoff = isEntryCutoff(a) ? 1 : 0;
                    const bCutoff = isEntryCutoff(b) ? 1 : 0;
                    return aCutoff - bCutoff; // No cutoff first
                });
                break;
            case 'status-valid':
                result.sort((a, b) => {
                    const aStatus = (a.status || '').toUpperCase();
                    const bStatus = (b.status || '').toUpperCase();
                    const aValid = (aStatus === 'VALID' || aStatus === 'VÁLIDO') ? 1 : 0;
                    const bValid = (bStatus === 'VALID' || bStatus === 'VÁLIDO') ? 1 : 0;
                    return bValid - aValid; // Valid first
                });
                break;
            case 'status-invalid':
                result.sort((a, b) => {
                    const aStatus = (a.status || '').toUpperCase();
                    const bStatus = (b.status || '').toUpperCase();
                    const aInvalid = (aStatus === 'INVALID' || aStatus === 'INVÁLIDO') ? 1 : 0;
                    const bInvalid = (bStatus === 'INVALID' || bStatus === 'INVÁLIDO') ? 1 : 0;
                    return bInvalid - aInvalid; // Invalid first
                });
                break;
        }

        filteredEntries = result;
        entriesPage = 1;
        renderEntriesTable();
        renderEntriesPagination();
    }

    /**
     * Format draw date from ISO (2026-01-02) to DD/MM/YYYY
     * @param {string} drawDate - Draw date string
     * @returns {string} Formatted date
     */
    function formatDrawDate(drawDate) {
        if (!drawDate) return '-';
        const parts = drawDate.split(/[-\/]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                // ISO: YYYY-MM-DD → DD/MM/YYYY
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            // Already DD/MM/YYYY
            return drawDate;
        }
        return drawDate;
    }

    // BRUTE FORCE RECHARGE MATCHING SYSTEM
    let boundOrderNumbers = new Set(); // Track used order numbers
    let entryRechargeMap = new Map(); // Map ticket number to recharge info
    let lastMatchedDataSize = 0; // Track if data changed
    let eligibilityWindowCache = new Map(); // Cache eligibility windows by recharge timestamp

    /**
     * Check if a date is a no-draw day (Sunday, Dec 25, Jan 1)
     * Uses Brazilian timezone for date checking
     * @param {Date} date - Date to check
     * @returns {boolean} True if no draw on this day
     */
    function isNoDrawDay(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            return false;
        }

        // Use UTC date components (date is stored as UTC representing Brazilian time)
        // Since dates are stored as UTC+3 (midnight BRT = 3 AM UTC), we need to adjust
        const utcDate = new Date(date.getTime());
        const utcYear = utcDate.getUTCFullYear();
        const utcMonth = utcDate.getUTCMonth() + 1; // 1-12
        const utcDay = utcDate.getUTCDate();
        const utcDayOfWeek = utcDate.getUTCDay(); // 0 = Sunday

        // Sunday
        if (utcDayOfWeek === 0) return true;

        // Christmas (Dec 25)
        if (utcMonth === 12 && utcDay === 25) return true;

        // New Year (Jan 1)
        if (utcMonth === 1 && utcDay === 1) return true;

        return false;
    }

    /**
     * Get next valid draw date from a given date, skipping no-draw days
     * Uses Brazilian timezone for date checking
     * @param {Date} fromDate - Starting date
     * @returns {Date} Next valid draw date
     */
    function getNextValidDrawDate(fromDate) {
        if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
            return fromDate;
        }

        // Start checking from the given date
        let checkDate = new Date(fromDate);
        checkDate.setUTCHours(12, 0, 0, 0); // Use noon UTC for day-of-week calculation

        // Check up to 14 days ahead
        for (let i = 0; i < 14; i++) {
            if (!isNoDrawDay(checkDate)) {
                // Found valid draw date - return midnight BRT (3 AM UTC)
                // Extract UTC date components directly (more efficient than formatting)
                const year = checkDate.getUTCFullYear();
                const month = checkDate.getUTCMonth() + 1;
                const day = checkDate.getUTCDate();
                return new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
            }

            // Move to next day using Date object (handles month/year rollovers automatically)
            checkDate.setUTCDate(checkDate.getUTCDate() + 1);
        }

        // Fallback: return original date if no valid date found
        return fromDate;
    }

    /**
     * Calculate eligibility window for a recharge
     * Returns { startDate, endDate, day1, day2 } in Brazilian time
     * 
     * IMPORTANT: Uses "Record Time" from RECHARGE POPN1 - Sheet1 (7).csv (Column 5)
     * 
     * Rules:
     * - If recharge BEFORE 8 PM: Day 1 = same day, Day 2 = next day
     * - If recharge AFTER 8 PM: Day 1 = recharge day, Day 2 = tomorrow (FIXED)
     * - Sunday/holidays (Dec 25, Jan 1) are skipped for draw days
     * - Eligibility ends at 8 PM (20:00) on Day 2
     * - NO tickets on Day 3+ can use this recharge!
     */
    function calculateEligibilityWindow(rechargeTime) {
        if (!(rechargeTime instanceof Date) || isNaN(rechargeTime.getTime())) {
            return null;
        }

        // Check cache first (performance optimization)
        const cacheKey = rechargeTime.getTime();
        if (eligibilityWindowCache.has(cacheKey)) {
            return eligibilityWindowCache.get(cacheKey);
        }

        // Get recharge hour in Brazilian timezone (CRITICAL for correct cutoff calculation)
        const rechargeHourStr = AdminCore.formatBrazilDateTime(rechargeTime, { hour: '2-digit' });
        const rechargeHour = parseInt(rechargeHourStr, 10);

        // Get recharge date string in Brazilian timezone for Day 1/Day 2 calculation
        const rechargeDateStr = AdminCore.formatBrazilDateTime(rechargeTime, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        // Parse recharge date components (DD/MM/YYYY)
        const [rechargeDay, rechargeMonth, rechargeYear] = rechargeDateStr.split('/').map(Number);

        // Create Day 1 and Day 2 ELIGIBILITY dates (calendar days - includes Sunday/holidays)
        // These are when tickets CAN BE CREATED
        let eligibilityDay1, eligibilityDay2;

        if (rechargeHour < 20) {
            // Recharge BEFORE 8 PM: Day 1 = same day, Day 2 = next day
            eligibilityDay1 = new Date(Date.UTC(rechargeYear, rechargeMonth - 1, rechargeDay, 3, 0, 0, 0)); // Midnight BRT
            eligibilityDay2 = new Date(Date.UTC(rechargeYear, rechargeMonth - 1, rechargeDay + 1, 3, 0, 0, 0)); // Next day midnight BRT
        } else {
            // Recharge AFTER 8 PM: Day 1 = recharge day, Day 2 = tomorrow (FIXED)
            eligibilityDay1 = new Date(Date.UTC(rechargeYear, rechargeMonth - 1, rechargeDay, 3, 0, 0, 0)); // Recharge day midnight BRT
            eligibilityDay2 = new Date(Date.UTC(rechargeYear, rechargeMonth - 1, rechargeDay + 1, 3, 0, 0, 0)); // Tomorrow midnight BRT
        }

        // Calculate PARTICIPATION days (draw days - skip Sunday/holidays)
        // These are which draws tickets can participate in
        let participationDay1, participationDay2;

        // Day 1 participation: Skip no-draw days from eligibility Day 1
        participationDay1 = getNextValidDrawDate(eligibilityDay1);

        // Day 2 participation: Next valid draw date AFTER Day 1 participation
        const day1PartDateStr = AdminCore.formatBrazilDateTime(participationDay1, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [day1PartDay, day1PartMonth, day1PartYear] = day1PartDateStr.split('/').map(Number);
        const nextDayAfterPartDay1 = new Date(Date.UTC(day1PartYear, day1PartMonth - 1, day1PartDay + 1, 3, 0, 0, 0));
        participationDay2 = getNextValidDrawDate(nextDayAfterPartDay1);

        // SPECIAL CASE: If eligibility Day 1 is a no-draw day (e.g., Sunday),
        // then Day 2 participation should be the same as Day 1 participation (only one draw day)
        const eligibilityDay1DateStr = AdminCore.formatBrazilDateTime(eligibilityDay1, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        if (isNoDrawDay(eligibilityDay1)) {
            // If Day 1 eligibility is Sunday/holiday, Day 2 participation = Day 1 participation (only Monday draw)
            participationDay2 = new Date(participationDay1);
        }

        // Eligibility ends at 8 PM (20:00) on eligibility Day 2 (calendar day, not participation day)
        const eligibilityDay2DateStr = AdminCore.formatBrazilDateTime(eligibilityDay2, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [eligDay2Day, eligDay2Month, eligDay2Year] = eligibilityDay2DateStr.split('/').map(Number);

        // 8 PM BRT = 20:00 BRT = 23:00 UTC (BRT is UTC-3)
        const eligibilityEnd = new Date(Date.UTC(eligDay2Year, eligDay2Month - 1, eligDay2Day, 23, 0, 0, 0));

        const window = {
            startDate: rechargeTime, // Starts from recharge time
            endDate: eligibilityEnd, // Ends at 8 PM on eligibility Day 2
            day1: participationDay1, // Day 1 participation (draw day)
            day2: participationDay2, // Day 2 participation (draw day)
            eligibilityDay1: eligibilityDay1, // Day 1 eligibility (calendar day - when tickets can be created)
            eligibilityDay2: eligibilityDay2  // Day 2 eligibility (calendar day - when tickets can be created)
        };

        // Cache the result
        eligibilityWindowCache.set(cacheKey, window);
        return window;
    }

    /**
     * Check if ticket time is within recharge eligibility window
     * ENFORCES 2-DAY LIMIT: Recharge cannot be used for Day 3+ tickets!
     * 
     * IMPORTANT:
     * - ticketTime: Uses "DATA/HORA REGISTRO" from OLD POP SORTE - SORTE (8).csv (Column 0)
     * - rechargeTime: Uses "Record Time" from RECHARGE POPN1 - Sheet1 (7).csv (Column 5)
     * 
     * @param {Date} ticketTime - When the ticket was created (from entries CSV)
     * @param {Date} rechargeTime - When the recharge happened (from recharge CSV)
     * @returns {boolean} - True if ticket is eligible (within 2-day window)
     */
    function isTicketEligible(ticketTime, rechargeTime) {
        if (!(ticketTime instanceof Date) || isNaN(ticketTime.getTime())) {
            return false;
        }
        if (!(rechargeTime instanceof Date) || isNaN(rechargeTime.getTime())) {
            return false;
        }

        // Ticket must be AFTER recharge
        if (ticketTime.getTime() < rechargeTime.getTime()) {
            return false;
        }

        const window = calculateEligibilityWindow(rechargeTime);
        if (!window) {
            return false;
        }

        // Check if ticket is within eligibility window (NOT Day 3+!)
        const ticketTimeMs = ticketTime.getTime();
        const windowStartMs = window.startDate.getTime();
        const windowEndMs = window.endDate.getTime();

        const isWithinWindow = ticketTimeMs >= windowStartMs && ticketTimeMs <= windowEndMs;
        return isWithinWindow;
    }

    /**
     * BRUTE FORCE: Match entries to recharges by closest time
     * Each order number can only be bound ONCE
     * ENFORCES 2-DAY ELIGIBILITY WINDOW - NO DAY 3+ TICKETS!
     */
    function bruteForceMatchRecharges() {
        // Check if we need to rematch (data size changed)
        const currentDataSize = (currentData.entries?.length || 0) + (currentData.allRecharges?.length || 0);
        if (lastMatchedDataSize === currentDataSize && entryRechargeMap.size > 0) {
            return; // Use cached matches
        }
        lastMatchedDataSize = currentDataSize;

        // Clear caches
        boundOrderNumbers.clear();
        entryRechargeMap.clear();
        eligibilityWindowCache.clear(); // Clear eligibility window cache

        if (!currentData.allRecharges || currentData.allRecharges.length === 0) {
            return;
        }

        // USE ALL ENTRIES, not just filtered ones
        const allEntries = currentData.entries || [];

        if (allEntries.length === 0) {
            return;
        }

        // Sort entries by time (oldest first) for chronological binding
        const sortedEntries = [...allEntries].sort((a, b) => {
            const ta = a.parsedDate ? a.parsedDate.getTime() : 0;
            const tb = b.parsedDate ? b.parsedDate.getTime() : 0;
            return ta - tb;
        });

        let matchCount = 0;
        let phase1Count = 0;
        let phase2Count = 0;
        let phase3Count = 0;

        // PHASE 1: Match all VALID entries first
        // DEBUG: Disabled for performance - enable only when troubleshooting
        const DEBUG_ENABLED = false;
        const DEBUG_GAME_IDS = ['3599051608', '3956778685'];

        for (const entry of sortedEntries) {
            const csvStatus = (entry.status || '').toUpperCase();
            if (csvStatus !== 'VALID' && csvStatus !== 'VÁLIDO') {
                continue;
            }

            if (!entry.parsedDate || !entry.gameId) {
                continue;
            }

            // Find all recharges for THIS EXACT GAME ID ONLY
            const allGameIdRecharges = currentData.allRecharges.filter(r => r.gameId === entry.gameId);

            const userRecharges = allGameIdRecharges.filter(r =>
                r.rechargeTime instanceof Date &&
                !isNaN(r.rechargeTime.getTime()) &&
                r.rechargeId &&
                !boundOrderNumbers.has(r.rechargeId) // NOT already bound
            );

            if (userRecharges.length === 0) {
                continue;
            }

            // Find OLDEST available recharge (FIFO: First In First Out)
            // Recharge MUST be BEFORE ticket time AND within 2-day eligibility window
            const ticketTime = entry.parsedDate;
            let oldestRecharge = null;
            let earliestTime = Infinity;
            let eligibilityRejects = 0;

            for (const recharge of userRecharges) {
                // ⚠️ CRITICAL: ENFORCE ELIGIBILITY WINDOW - Cannot use recharge for Day 3+ tickets!
                const isEligible = isTicketEligible(ticketTime, recharge.rechargeTime);

                if (!isEligible) {
                    eligibilityRejects++;
                    continue;
                }

                const rechargeTime = recharge.rechargeTime.getTime();

                // Find the OLDEST (earliest timestamp) eligible recharge
                if (rechargeTime < earliestTime) {
                    earliestTime = rechargeTime;
                    oldestRecharge = recharge;
                }
            }

            // Skip debug logging for performance

            // BIND IT!
            if (oldestRecharge) {
                const orderToAdd = oldestRecharge.rechargeId;

                // DEBUG: Verify it's not already bound
                if (boundOrderNumbers.has(orderToAdd)) {
                    // Order already bound - skip
                }

                boundOrderNumbers.add(orderToAdd);

                // DEBUG: Verify it was added
                if (!boundOrderNumbers.has(orderToAdd)) {
                    // Failed to add order - skip
                }

                // USE UNIQUE KEY: gameId + timestamp (ticket number is irrelevant!)
                const uniqueKey = `${entry.gameId}-${entry.parsedDate.getTime()}`;
                entryRechargeMap.set(uniqueKey, {
                    orderNumber: orderToAdd,
                    recordTime: oldestRecharge.rechargeTime,
                    amount: oldestRecharge.amount,
                    gameId: oldestRecharge.gameId // Store for verification
                });
                matchCount++;
                phase1Count++;

                // Skip debug logging for performance
            }
        }

        // PHASE 2: Match PENDING entries with leftover recharges
        for (const entry of sortedEntries) {
            const csvStatus = (entry.status || '').toUpperCase();
            if (csvStatus !== 'PENDING' && csvStatus !== 'PENDENTE') {
                continue;
            }

            if (!entry.parsedDate || !entry.gameId) {
                continue;
            }

            // Find all recharges for THIS EXACT GAME ID ONLY
            const allGameIdRecharges = currentData.allRecharges.filter(r => r.gameId === entry.gameId);
            const userRecharges = allGameIdRecharges.filter(r =>
                r.rechargeTime instanceof Date &&
                !isNaN(r.rechargeTime.getTime()) &&
                r.rechargeId &&
                !boundOrderNumbers.has(r.rechargeId)
            );

            if (userRecharges.length === 0) {
                continue;
            }

            // Find OLDEST available recharge (FIFO: First In First Out)
            // Recharge MUST be BEFORE ticket time AND within 2-day eligibility window
            const ticketTime = entry.parsedDate;
            let oldestRecharge = null;
            let earliestTime = Infinity;
            let eligibilityRejects = 0;

            for (const recharge of userRecharges) {
                // ⚠️ CRITICAL: ENFORCE ELIGIBILITY WINDOW - Cannot use recharge for Day 3+ tickets!
                const isEligible = isTicketEligible(ticketTime, recharge.rechargeTime);

                if (!isEligible) {
                    eligibilityRejects++;
                    continue;
                }

                const rechargeTime = recharge.rechargeTime.getTime();

                // Find the OLDEST (earliest timestamp) eligible recharge
                if (rechargeTime < earliestTime) {
                    earliestTime = rechargeTime;
                    oldestRecharge = recharge;
                }
            }

            if (oldestRecharge) {
                const orderToAdd = oldestRecharge.rechargeId;
                boundOrderNumbers.add(orderToAdd);
                const uniqueKey = `${entry.gameId}-${entry.parsedDate.getTime()}`;
                entryRechargeMap.set(uniqueKey, {
                    orderNumber: orderToAdd,
                    recordTime: oldestRecharge.rechargeTime,
                    amount: oldestRecharge.amount,
                    gameId: oldestRecharge.gameId,
                    wasUpgraded: true, // Flag to indicate this was upgraded from PENDING
                    originalStatus: 'PENDING'
                });
                matchCount++;
                phase2Count++;
            }
        }

        // PHASE 3: Match INVALID entries with leftover recharges
        for (const entry of sortedEntries) {
            const csvStatus = (entry.status || '').toUpperCase();
            if (csvStatus !== 'INVALID' && csvStatus !== 'INVÁLIDO') {
                continue;
            }

            if (!entry.parsedDate || !entry.gameId) {
                continue;
            }

            // Find all recharges for THIS EXACT GAME ID ONLY
            const allGameIdRecharges = currentData.allRecharges.filter(r => r.gameId === entry.gameId);
            const userRecharges = allGameIdRecharges.filter(r =>
                r.rechargeTime instanceof Date &&
                !isNaN(r.rechargeTime.getTime()) &&
                r.rechargeId &&
                !boundOrderNumbers.has(r.rechargeId)
            );

            if (userRecharges.length === 0) {
                continue;
            }

            // Find OLDEST available recharge (FIFO: First In First Out)
            // Recharge MUST be BEFORE ticket time AND within 2-day eligibility window
            const ticketTime = entry.parsedDate;
            let oldestRecharge = null;
            let earliestTime = Infinity;
            let eligibilityRejects = 0;

            for (const recharge of userRecharges) {
                // ⚠️ CRITICAL: ENFORCE ELIGIBILITY WINDOW - Cannot use recharge for Day 3+ tickets!
                if (!isTicketEligible(ticketTime, recharge.rechargeTime)) {
                    eligibilityRejects++;
                    continue;
                }

                const rechargeTime = recharge.rechargeTime.getTime();

                // Find the OLDEST (earliest timestamp) eligible recharge
                if (rechargeTime < earliestTime) {
                    earliestTime = rechargeTime;
                    oldestRecharge = recharge;
                }
            }

            // Skip debug logging for performance

            if (oldestRecharge) {
                const orderToAdd = oldestRecharge.rechargeId;
                boundOrderNumbers.add(orderToAdd);
                const uniqueKey = `${entry.gameId}-${entry.parsedDate.getTime()}`;
                entryRechargeMap.set(uniqueKey, {
                    orderNumber: orderToAdd,
                    recordTime: oldestRecharge.rechargeTime,
                    amount: oldestRecharge.amount,
                    gameId: oldestRecharge.gameId,
                    wasUpgraded: true, // Flag to indicate this was upgraded from INVALID
                    originalStatus: 'INVALID'
                });
                matchCount++;
                phase3Count++;
            }
        }
    }

    function renderEntriesTable() {
        const tbody = document.getElementById('entriesTableBody');
        if (!tbody) {
            // Table body not found
            return;
        }

        // DON'T call bruteForceMatchRecharges here - it clears the bindings!
        // It should only be called once when data is loaded

        const start = (entriesPage - 1) * entriesPerPage;
        const pageEntries = filteredEntries.slice(start, start + entriesPerPage);

        if (pageEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">No entries found</td></tr>';
            return;
        }

        try {
            tbody.innerHTML = pageEntries.map((entry, index) => {
                // ✅ READ STATUS DIRECTLY FROM CSV (Column H - STATUS)
                const csvStatus = (entry.status || 'UNKNOWN').toUpperCase();

                // Check if entry was upgraded (will check below after getting bruteForceMatch)
                // We'll set this after we get the match data
                let status = csvStatus;

                // Format date/time with FULL YEAR
                const formattedTime = entry.parsedDate
                    ? AdminCore.formatBrazilDateTime(entry.parsedDate, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : entry.timestamp;

                // Render number badges
                const numbersHtml = entry.numbers.slice(0, 5).map(n => {
                    const colorClass = AdminCore.getBallColorClass(n);
                    return `<span class="number-badge ${colorClass}" style="width:24px;height:24px;font-size:0.6rem">${String(n).padStart(2, '0')}</span>`;
                }).join('');

                const platform = (entry.platform || 'POPN1').toUpperCase();

                // RECHARGE INFO - BRUTE FORCE MATCHING
                let rechargeInfo = '-';

                // DOUBLE CHECK: Show recharge info for:
                // 1. Originally VALID entries
                // 2. PENDING/INVALID entries that were upgraded (have bruteForceMatch)
                const entryCsvStatus = (entry.status || '').toUpperCase();
                const isOriginallyValid = (entryCsvStatus === 'VALID' || entryCsvStatus === 'VÁLIDO');

                // Get brute force matched recharge using UNIQUE KEY: gameId + timestamp
                const lookupKey = `${entry.gameId}-${entry.parsedDate ? entry.parsedDate.getTime() : 0}`;
                const bruteForceMatch = entryRechargeMap.get(lookupKey);

                // Entry is valid if: originally valid OR was upgraded by finding a match
                const isValidEntry = isOriginallyValid || (bruteForceMatch && bruteForceMatch.wasUpgraded);

                // Override status if upgraded
                if (bruteForceMatch && bruteForceMatch.wasUpgraded) {
                    status = 'VALID';
                }

                // CUTOFF CHECK: Determine if ticket participates in Day 2 draw
                // Rules:
                // 1. Ticket created AFTER 8 PM on Day 1 (recharge day) → CUTOFF (participates Day 2)
                // 2. Ticket created on Day 2 (any time) → CUTOFF (participates Day 2)
                // IMPORTANT:
                // - rechargeTime: From "Record Time" in RECHARGE POPN1 - Sheet1 (7).csv (Column 5)
                // - ticketTime: From "DATA/HORA REGISTRO" in OLD POP SORTE - SORTE (8).csv (Column 0)
                // - CUTOFF badge means "participates in Day 2 draw" but ticket is still VALID!
                let isCutoff = false;
                if (bruteForceMatch && entry.parsedDate) {
                    const rechargeTime = bruteForceMatch.recordTime; // Record Time from recharge CSV
                    const ticketTime = entry.parsedDate; // DATA/HORA REGISTRO from entries CSV

                    // Get eligibility window to determine Day 1 and Day 2
                    const window = calculateEligibilityWindow(rechargeTime);
                    if (window) {
                        // Compare dates directly (more efficient than string formatting)
                        // Normalize dates to midnight for comparison
                        const ticketDate = new Date(ticketTime);
                        ticketDate.setUTCHours(0, 0, 0, 0);

                        const eligDay1Date = new Date(window.eligibilityDay1);
                        eligDay1Date.setUTCHours(0, 0, 0, 0);

                        const eligDay2Date = new Date(window.eligibilityDay2);
                        eligDay2Date.setUTCHours(0, 0, 0, 0);

                        const partDay1Date = new Date(window.day1);
                        partDay1Date.setUTCHours(0, 0, 0, 0);

                        const partDay2Date = new Date(window.day2);
                        partDay2Date.setUTCHours(0, 0, 0, 0);

                        // Check if ticket is on eligibility Day 1 or Day 2 (when tickets can be created)
                        const isOnEligibilityDay1 = ticketDate.getTime() === eligDay1Date.getTime();
                        const isOnEligibilityDay2 = ticketDate.getTime() === eligDay2Date.getTime();

                        // Check if Day 2 participation exists and is different from Day 1 participation
                        const hasDay2Participation = partDay1Date.getTime() !== partDay2Date.getTime();

                        // DEBUG: Log cutoff calculation for troubleshooting
                        const DEBUG_CUTOFF = false; // Set to true to enable
                        if (DEBUG_CUTOFF && (entry.gameId === '3105451998' || entry.gameId === '3437192929' || entry.gameId === '3384889775')) {
                            const rechargeDateStr = AdminCore.formatBrazilDateTime(rechargeTime, {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            const ticketTimeStr = AdminCore.formatBrazilDateTime(ticketTime, {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            // Cutoff debug disabled
                        }

                        if (isOnEligibilityDay1) {
                            // Ticket created on eligibility Day 1
                            // If Day 2 participation exists, check if ticket was created AFTER 8 PM
                            if (hasDay2Participation) {
                                // Get hour in Brazilian timezone
                                // parseBrazilDateTime stores dates as UTC with BRT hour + 3
                                // So BRT 20:36 → UTC 23:36
                                // To get BRT from UTC: UTC - 3 (with wraparound)
                                const utcHour = ticketTime.getUTCHours();
                                const brtHour = (utcHour - 3 + 24) % 24; // Convert UTC to BRT (subtract 3, handle wraparound)

                                if (brtHour >= 20) {
                                    isCutoff = true; // After 8 PM on eligibility Day 1 → CUTOFF (participates Day 2)
                                }
                            }
                            // If no Day 2 participation (Day 2 = Day 1), no cutoff
                        } else if (isOnEligibilityDay2) {
                            // Ticket created on eligibility Day 2
                            // CUTOFF if Day 2 participation exists and is different from Day 1
                            if (hasDay2Participation) {
                                isCutoff = true; // On eligibility Day 2 → CUTOFF (participates Day 2)
                            }
                            // If no Day 2 participation (Day 2 = Day 1), no cutoff
                        }
                    }
                }

                // Status badge WITH CUTOFF badge integrated
                let statusBadge = '';
                const cutoffBadgeHtml = isCutoff ? ' <span class="badge badge-secondary" style="font-size: 0.65rem; margin-left: 4px;">⏰ CUTOFF</span>' : '';

                switch (status) {
                    case 'VALID':
                    case 'VÁLIDO':
                        statusBadge = `<span class="badge badge-success" data-cutoff="${isCutoff ? 'yes' : 'no'}">✅ VALID</span>${cutoffBadgeHtml}`;
                        break;
                    case 'INVALID':
                    case 'INVÁLIDO':
                        statusBadge = `<span class="badge badge-danger" data-cutoff="${isCutoff ? 'yes' : 'no'}">❌ INVALID</span>${cutoffBadgeHtml}`;
                        break;
                    default:
                        statusBadge = `<span class="badge badge-warning" data-cutoff="${isCutoff ? 'yes' : 'no'}">⏳ PENDING</span>${cutoffBadgeHtml}`;
                }

                // Skip debug logging for performance

                // SAFETY CHECK: Verify Game IDs match (should always be true)
                if (bruteForceMatch && bruteForceMatch.gameId !== entry.gameId) {
                    // Game ID mismatch detected
                }

                // Show recharge info if has a match (whether originally valid or upgraded)
                if (bruteForceMatch) {
                    // Show full order number (no truncation)
                    const orderNumber = bruteForceMatch.orderNumber;

                    const timeStr = AdminCore.formatBrazilDateTime(bruteForceMatch.recordTime, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    // Add upgrade badge if was upgraded from PENDING/INVALID
                    const upgradeBadge = bruteForceMatch.wasUpgraded
                        ? `<br><span class="badge badge-info" style="font-size: 0.55rem; padding: 1px 3px;">⬆️ UPGRADED</span>`
                        : '';

                    rechargeInfo = `<div style="font-size: 0.7rem; line-height: 1.3;">
                    <strong class="text-success">R$ ${bruteForceMatch.amount.toFixed(2)}</strong><br>
                    <span style="color: var(--text-tertiary);">${orderNumber}</span><br>
                    <span style="color: var(--text-muted); font-size: 0.65rem;">${timeStr}</span>${upgradeBadge}
                </div>`;
                }

                // WhatsApp full display (no masking)
                const whatsappDisplay = entry.whatsapp || '';

                // Format draw date
                const formattedDrawDate = formatDrawDate(entry.drawDate);

                return `
                <tr data-cutoff="${isCutoff ? 'yes' : 'no'}">
                    <td>${statusBadge}</td>
                    <td style="font-size:0.8rem;white-space:nowrap">${formattedTime}</td>
                    <td><span class="platform-badge ${platform.toLowerCase()}">${platform}</span></td>
                    <td><strong>${entry.gameId}</strong></td>
                    <td style="font-size:0.75rem">${whatsappDisplay}</td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td style="font-size:0.8rem">${formattedDrawDate}</td>
                    <td><span class="badge badge-info">${entry.contest}</span></td>
                    <td style="font-size:0.9rem">${entry.ticketNumber}</td>
                    <td>${rechargeInfo}</td>
                </tr>
            `;
            }).join('');

            // Table HTML generated
        } catch (error) {
            // Error rendering table
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading entries. Check console for details.</td></tr>';
        }
    }

    function renderEntriesPagination() {
        const total = filteredEntries.length;
        const totalPages = Math.ceil(total / entriesPerPage);
        const start = (entriesPage - 1) * entriesPerPage + 1;
        const end = Math.min(entriesPage * entriesPerPage, total);

        document.getElementById('paginationInfo').textContent = `Showing ${total > 0 ? start : 0}-${end} of ${total} entries`;
        document.getElementById('btnPrevPage').disabled = entriesPage <= 1;
        document.getElementById('btnNextPage').disabled = entriesPage >= totalPages;

        const pageNumbers = document.getElementById('pageNumbers');
        if (pageNumbers) {
            let html = '';

            // Show first page
            if (totalPages > 0) {
                html += `<button class="pagination-btn ${1 === entriesPage ? 'active' : ''}" onclick="UnifiedPage.goToEntriesPage(1)">1</button>`;
            }

            // Show pages around current page
            const startPage = Math.max(2, entriesPage - 2);
            const endPage = Math.min(totalPages - 1, entriesPage + 2);

            // Add ellipsis if needed before middle pages
            if (startPage > 2) {
                html += `<span class="text-muted">...</span>`;
            }

            // Show middle pages
            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="pagination-btn ${i === entriesPage ? 'active' : ''}" onclick="UnifiedPage.goToEntriesPage(${i})">${i}</button>`;
            }

            // Add ellipsis if needed after middle pages
            if (endPage < totalPages - 1) {
                html += `<span class="text-muted">...</span>`;
            }

            // Show last page (if more than 1 page)
            if (totalPages > 1) {
                html += `<button class="pagination-btn ${totalPages === entriesPage ? 'active' : ''}" onclick="UnifiedPage.goToEntriesPage(${totalPages})">${totalPages}</button>`;
            }

            pageNumbers.innerHTML = html;
        }
    }

    function goToEntriesPage(page) {
        entriesPage = page;
        renderEntriesTable();
        renderEntriesPagination();
    }

    function showTicketDetails(ticketNumber) {
        const entry = currentData.entries.find(e => e.ticketNumber === ticketNumber);
        if (!entry) return;

        const modalContent = document.getElementById('ticketModalContent');
        if (!modalContent) return;

        // ✅ VALIDATION STATUS - READ DIRECTLY FROM CSV (Column H - STATUS)
        const csvStatus = (entry.status || 'UNKNOWN').toUpperCase();
        const status = csvStatus;
        const statusClass = { 'VALID': 'success', 'INVALID': 'danger', 'VÁLIDO': 'success', 'INVÁLIDO': 'danger' }[csvStatus] || 'warning';
        const statusIcon = (status === 'VALID' || status === 'VÁLIDO') ? '✅' : (status === 'INVALID' || status === 'INVÁLIDO') ? '❌' : '⏳';
        const statusText = (status === 'VALID' || status === 'VÁLIDO') ? 'VALID' : (status === 'INVALID' || status === 'INVÁLIDO') ? 'INVALID' : 'PENDING';

        const statusHtml = `<div class="status-banner ${statusClass} mb-4">
            <span class="status-banner-icon">${statusIcon}</span>
            <span class="status-banner-text">
                <strong>${statusText}</strong> - Status from CSV
            </span>
        </div>`;

        // Render number badges
        const numbersHtml = entry.numbers.map(n => {
            const colorClass = AdminCore.getBallColorClass(n);
            return `<span class="number-badge ${colorClass}">${String(n).padStart(2, '0')}</span>`;
        }).join('');

        // RECHARGE INFORMATION - DIRECT MATCH BY GAME ID
        let rechargeHtml = '<p class="text-muted">No recharge found for this Game ID</p>';

        // Find recharge directly by matching gameId
        const entryGameId = entry.gameId;
        if (entryGameId && currentData.allRecharges && currentData.allRecharges.length > 0) {
            const userRecharges = currentData.allRecharges.filter(r => r.gameId === entryGameId);

            if (userRecharges.length > 0) {
                // Show ALL recharges for this user
                rechargeHtml = '<div class="mb-3">';

                userRecharges.slice(0, 5).forEach((r, idx) => {
                    const orderNumber = r.rechargeId || '-';
                    const chargeAmount = r.amount || 0;
                    const amountDisplay = `R$ ${chargeAmount.toFixed(2)}`;

                    let timeDisplay = '-';
                    if (r.rechargeTime instanceof Date && !isNaN(r.rechargeTime.getTime())) {
                        timeDisplay = AdminCore.formatBrazilDateTime(r.rechargeTime, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        });
                    } else if (r.rechargeTimeRaw) {
                        timeDisplay = r.rechargeTimeRaw;
                    }

                    rechargeHtml += `
                        <div class="ticket-info-grid mb-3" style="border-bottom: 1px solid var(--border-primary); padding-bottom: 12px;">
                            <div class="ticket-info-item">
                                <span class="label">💰 Amount ${idx === 0 ? '(Latest)' : ''}</span>
                                <span class="value text-success"><strong>${amountDisplay}</strong></span>
                            </div>
                            <div class="ticket-info-item">
                                <span class="label">📋 Order Number</span>
                                <span class="value" style="font-size:0.7rem;word-break:break-all">${orderNumber}</span>
                            </div>
                            <div class="ticket-info-item">
                                <span class="label">⏰ Recharge Time</span>
                                <span class="value">${timeDisplay}</span>
                            </div>
                            <div class="ticket-info-item">
                                <span class="label">🎮 Game ID</span>
                                <span class="value">${r.gameId}</span>
                            </div>
                        </div>
                    `;
                });

                if (userRecharges.length > 5) {
                    rechargeHtml += `<p class="text-muted text-center">... and ${userRecharges.length - 5} more recharges</p>`;
                }

                rechargeHtml += '</div>';
            }
        }

        modalContent.innerHTML = `
            ${statusHtml}
            
            <h4 class="mb-3">📋 Ticket Information</h4>
            <div class="ticket-info-grid mb-4">
                <div class="ticket-info-item">
                    <span class="label">Ticket Number</span>
                    <span class="value">${entry.ticketNumber}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Game ID</span>
                    <span class="value"><strong>${entry.gameId}</strong></span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">WhatsApp</span>
                    <span class="value">${entry.whatsapp || '-'}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Platform</span>
                    <span class="value"><span class="platform-badge ${(entry.platform || 'POPN1').toLowerCase()}">${entry.platform || 'POPN1'}</span></span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Contest</span>
                    <span class="value"><span class="badge badge-info">${entry.contest}</span></span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Draw Date</span>
                    <span class="value">${entry.drawDate || '-'}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Registered</span>
                    <span class="value">${entry.parsedDate ? AdminCore.formatBrazilDateTime(entry.parsedDate) : entry.timestamp}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Original Status</span>
                    <span class="value">${entry.status || 'N/A'}</span>
                </div>
            </div>
            
            <h4 class="mb-3">🎲 Selected Numbers</h4>
            <div class="numbers-display mb-4">${numbersHtml}</div>
            
            <h4 class="mb-3">💳 Linked Recharge</h4>
            ${rechargeHtml}
        `;

        AdminCore.openModal('ticketModal');
    }

    function exportEntriesCSV() {
        if (filteredEntries.length === 0) {
            AdminCore.showToast('No data to export', 'warning');
            return;
        }

        const headers = ['Validity', 'Registration Date', 'Registration Time', 'Platform', 'Game ID', 'WhatsApp', 'Chosen Numbers', 'Draw Date', 'Contest', 'Ticket #', 'Bound Recharge ID', 'Recharge Time', 'Recharge Amount', 'Invalid Reason', 'Cutoff Flag'];

        const rows = filteredEntries.map(entry => {
            // Get CSV status
            const csvStatus = (entry.status || 'UNKNOWN').toUpperCase();

            // Get brute force matched recharge
            const lookupKey = `${entry.gameId}-${entry.parsedDate ? entry.parsedDate.getTime() : 0}`;
            const bruteForceMatch = entryRechargeMap.get(lookupKey);

            // Determine final validity status
            const isOriginallyValid = (csvStatus === 'VALID' || csvStatus === 'VÁLIDO');
            const isValidEntry = isOriginallyValid || (bruteForceMatch && bruteForceMatch.wasUpgraded);
            const validity = isValidEntry ? 'VALID' : csvStatus;

            // Parse registration date/time
            let registrationDate = '';
            let registrationTime = '';
            if (entry.parsedDate) {
                // Format date as "D Month YYYY" (e.g., "3 January 2026") using English locale
                const dateStr = entry.parsedDate.toLocaleString('en-US', {
                    timeZone: 'America/Sao_Paulo',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                });
                // Format: "January 3, 2026" -> "3 January 2026"
                const parts = dateStr.split(' ');
                if (parts.length === 3) {
                    const month = parts[0];
                    const day = parts[1].replace(',', '');
                    const year = parts[2];
                    registrationDate = `${day} ${month} ${year}`;
                } else {
                    registrationDate = dateStr;
                }

                // Format time as HH:MM:SS in Brazilian timezone
                registrationTime = entry.parsedDate.toLocaleString('en-US', {
                    timeZone: 'America/Sao_Paulo',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            } else if (entry.timestamp) {
                // Fallback: try to parse from timestamp string
                const parts = entry.timestamp.split(' ');
                if (parts.length >= 2) {
                    registrationDate = parts[0];
                    registrationTime = parts[1];
                }
            }

            // Format draw date as YYYY-MM-DD
            let drawDate = '';
            if (entry.drawDate) {
                // Try to parse draw date
                try {
                    // Could be "Mon, 22 Dec 2025" or "2026-01-05" or "05/01/2026"
                    if (entry.drawDate.includes('-')) {
                        drawDate = entry.drawDate.split(' ')[0]; // Take first part if space-separated
                    } else if (entry.drawDate.includes('/')) {
                        const [d, m, y] = entry.drawDate.split('/');
                        drawDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                    } else {
                        // Try parsing as date
                        const parsed = new Date(entry.drawDate);
                        if (!isNaN(parsed.getTime())) {
                            const year = parsed.getFullYear();
                            const month = String(parsed.getMonth() + 1).padStart(2, '0');
                            const day = String(parsed.getDate()).padStart(2, '0');
                            drawDate = `${year}-${month}-${day}`;
                        } else {
                            drawDate = entry.drawDate;
                        }
                    }
                } catch (e) {
                    drawDate = entry.drawDate;
                }
            }

            // Get recharge info
            let boundRechargeId = '';
            let rechargeTime = '';
            let rechargeAmount = '';
            if (bruteForceMatch) {
                boundRechargeId = bruteForceMatch.orderNumber || '';
                if (bruteForceMatch.recordTime) {
                    // Format as YYYY-MM-DD HH:MM:SS in Brazilian timezone
                    const rt = bruteForceMatch.recordTime;
                    // Get date components in Brazilian timezone
                    const year = AdminCore.formatBrazilDateTime(rt, { year: 'numeric', timeZone: 'America/Sao_Paulo' });
                    const month = AdminCore.formatBrazilDateTime(rt, { month: '2-digit', timeZone: 'America/Sao_Paulo' });
                    const day = AdminCore.formatBrazilDateTime(rt, { day: '2-digit', timeZone: 'America/Sao_Paulo' });
                    const hour = AdminCore.formatBrazilDateTime(rt, { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
                    const minute = AdminCore.formatBrazilDateTime(rt, { minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                    const second = AdminCore.formatBrazilDateTime(rt, { second: '2-digit', timeZone: 'America/Sao_Paulo' });
                    rechargeTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                }
                rechargeAmount = bruteForceMatch.amount ? String(bruteForceMatch.amount) : '';
            }

            // Determine invalid reason
            let invalidReason = '';
            if (!isValidEntry) {
                if (csvStatus === 'INVALID' || csvStatus === 'INVÁLIDO') {
                    // Check if ticket was before recharge
                    if (bruteForceMatch && entry.parsedDate && bruteForceMatch.recordTime) {
                        if (entry.parsedDate.getTime() < bruteForceMatch.recordTime.getTime()) {
                            invalidReason = 'INVALID_TICKET_BEFORE_RECHARGE';
                        } else {
                            invalidReason = 'INVALID_RECHARGE_WINDOW_EXPIRED';
                        }
                    } else {
                        invalidReason = 'INVALID_RECHARGE_WINDOW_EXPIRED';
                    }
                }
            }

            // Determine cutoff flag
            let cutoffFlag = 'NO';
            if (bruteForceMatch && entry.parsedDate) {
                const rechargeTime = bruteForceMatch.recordTime;
                const ticketTime = entry.parsedDate;
                const window = calculateEligibilityWindow(rechargeTime);
                if (window) {
                    const ticketDate = new Date(ticketTime);
                    ticketDate.setUTCHours(0, 0, 0, 0);
                    const eligDay1Date = new Date(window.eligibilityDay1);
                    eligDay1Date.setUTCHours(0, 0, 0, 0);
                    const eligDay2Date = new Date(window.eligibilityDay2);
                    eligDay2Date.setUTCHours(0, 0, 0, 0);
                    const partDay1Date = new Date(window.day1);
                    partDay1Date.setUTCHours(0, 0, 0, 0);
                    const partDay2Date = new Date(window.day2);
                    partDay2Date.setUTCHours(0, 0, 0, 0);
                    const isOnEligibilityDay1 = ticketDate.getTime() === eligDay1Date.getTime();
                    const isOnEligibilityDay2 = ticketDate.getTime() === eligDay2Date.getTime();
                    const hasDay2Participation = partDay1Date.getTime() !== partDay2Date.getTime();

                    if (isOnEligibilityDay1 && hasDay2Participation) {
                        const utcHour = ticketTime.getUTCHours();
                        const brtHour = (utcHour - 3 + 24) % 24;
                        if (brtHour >= 20) {
                            cutoffFlag = 'YES';
                        }
                    } else if (isOnEligibilityDay2 && hasDay2Participation) {
                        cutoffFlag = 'YES';
                    }
                }
            }

            return [
                validity,
                registrationDate,
                registrationTime,
                entry.platform || '',
                entry.gameId || '',
                entry.whatsapp || '',
                entry.numbers.join(', '),
                drawDate,
                entry.contest || '',
                entry.ticketNumber || '',
                boundRechargeId,
                rechargeTime,
                rechargeAmount,
                invalidReason,
                cutoffFlag
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `entries_export_${new Date().toISOString().replace(/:/g, '_')}.csv`;
        link.click();

        AdminCore.showToast(`${filteredEntries.length} entries exported`, 'success');
    }

    // ============================================
    // RESULTS SECTION
    // ============================================

    function renderResults() {
        const { results } = currentData;

        // Stats
        const total = results.length;
        const validDraws = results.filter(r => !r.isNoDraw).length;
        const noDraws = results.filter(r => r.isNoDraw).length;

        document.getElementById('statTotalResults').textContent = total.toLocaleString();
        document.getElementById('statValidDraws').textContent = validDraws.toLocaleString();
        document.getElementById('statNoDraws').textContent = noDraws.toLocaleString();

        // Latest result card
        const latest = results.find(r => !r.isNoDraw);
        const card = document.getElementById('latestResultCard');
        if (latest && card) {
            card.style.display = 'block';
            document.getElementById('latestResultContest').textContent = `Contest #${latest.contest}`;
            document.getElementById('latestResultDate').textContent = latest.drawDate;
            document.getElementById('latestResultNumbers').innerHTML = latest.numbers.map(n => {
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass}" style="width:48px;height:48px;font-size:1.1rem">${String(n).padStart(2, '0')}</span>`;
            }).join('');
        }

        filteredResults = [...results];
        renderResultsTable();
    }

    /**
     * Format a draw date string to consistent "Wed, 31 Dec 2025" format
     * Handles various input formats: MM/DD/YYYY, YYYY-MM-DD, or already formatted
     * @param {string} dateStr - Raw date string from CSV
     * @returns {string} Formatted date string
     */
    function formatDrawDate(dateStr) {
        if (!dateStr || dateStr === '-') return '-';

        // If already in the correct format (e.g., "Wed, 31 Dec 2025"), return as-is
        if (/^[A-Za-z]{3},\s\d{1,2}\s[A-Za-z]{3}\s\d{4}$/.test(dateStr.trim())) {
            return dateStr.trim();
        }

        let dateObj = null;

        // Try parsing MM/DD/YYYY format (US format from CSV)
        const mmddyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mmddyyyyMatch) {
            const [, month, day, year] = mmddyyyyMatch;
            dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }

        // Try parsing YYYY-MM-DD format (ISO format)
        if (!dateObj) {
            const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (isoMatch) {
                const [, year, month, day] = isoMatch;
                dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
        }

        // If we successfully parsed the date, format it
        if (dateObj && !isNaN(dateObj.getTime())) {
            return dateObj.toLocaleDateString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }

        // Return original if we couldn't parse it
        return dateStr;
    }

    function renderResultsTable() {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        let data = filteredResults;
        if (resultsSearchTerm) {
            const term = resultsSearchTerm.toLowerCase();
            data = data.filter(r => r.contest.toLowerCase().includes(term) || (r.drawDate || '').toLowerCase().includes(term));
        }

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No results found</td></tr>';
            return;
        }

        tbody.innerHTML = data.slice(0, 50).map(result => {
            let numbersHtml = '';
            if (result.isNoDraw) {
                numbersHtml = '<span class="badge badge-warning">No Draw</span>';
            } else {
                numbersHtml = result.numbers.map(n => {
                    const colorClass = AdminCore.getBallColorClass(n);
                    return `<span class="number-badge ${colorClass}" style="width:28px;height:28px;font-size:0.7rem">${String(n).padStart(2, '0')}</span>`;
                }).join('');
            }

            let sourceBadge = '<span class="badge badge-gray">Manual</span>';
            const source = (result.source || '').toLowerCase();
            if (source.includes('caixa')) sourceBadge = '<span class="badge badge-success">Caixa</span>';
            else if (source.includes('api')) sourceBadge = '<span class="badge badge-info">API</span>';

            // Format the draw date consistently
            const formattedDrawDate = formatDrawDate(result.drawDate);

            return `
                <tr>
                    <td><strong>#${result.contest}</strong></td>
                    <td>${formattedDrawDate}</td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td>${sourceBadge}</td>
                </tr>
            `;
        }).join('');
    }

    // ============================================
    // WINNERS SECTION
    // ============================================

    async function renderWinners() {
        const { entries, results } = currentData;
        const platform = AdminCore.getCurrentPlatform();

        try {
            // Calculate winners
            winnersCalculation = await WinnerCalculator.calculateAllWinners(entries, results, platform);
            allWinners = winnersCalculation.allWinners || [];
            filteredWinners = [...allWinners];

            const stats = winnersCalculation.stats;
            document.getElementById('stat5Matches').textContent = (stats.byTier?.[5] || 0).toLocaleString();
            document.getElementById('stat4Matches').textContent = (stats.byTier?.[4] || 0).toLocaleString();
            document.getElementById('stat3Matches').textContent = (stats.byTier?.[3] || 0).toLocaleString();
            document.getElementById('statWinnersTotal').textContent = (stats.totalWinners || 0).toLocaleString();

            // Prize pool label
            const prizePool = WinnerCalculator.getPrizePool(platform === 'ALL' ? 'DEFAULT' : platform);
            const prizeLabel = document.getElementById('prizePoolLabel');
            if (prizeLabel) prizeLabel.textContent = `Prize Pool: R$ ${prizePool.toLocaleString()}`;

            // Winners by contest cards
            renderWinnersCards();

            // Populate filter options
            const contests = [...new Set(allWinners.map(w => w.contest).filter(Boolean))].sort((a, b) => parseInt(b) - parseInt(a));
            const contestSelect = document.getElementById('filterWinnersContest');
            if (contestSelect) {
                contestSelect.innerHTML = '<option value="">All</option>' + contests.map(c => `<option value="${c}">${c}</option>`).join('');
            }

            renderWinnersTable();

        } catch (error) {
            // Error calculating winners
            document.getElementById('winnersTableBody').innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error calculating winners</td></tr>';
        }
    }

    function renderWinnersCards() {
        const container = document.getElementById('winnersByContestContainer');
        if (!container || !winnersCalculation) return;

        const contestsWithResults = winnersCalculation.contestResults.filter(c => c.hasResult).slice(0, 6);

        if (contestsWithResults.length === 0) {
            container.innerHTML = '<div class="card"><div class="card-body text-center text-muted">No contest results available</div></div>';
            return;
        }

        container.innerHTML = contestsWithResults.map(contest => {
            // Always show winning numbers if available
            const numbersHtml = contest.winningNumbers && contest.winningNumbers.length > 0
                ? contest.winningNumbers.map(n => {
                    const colorClass = AdminCore.getBallColorClass(n);
                    return `<span class="number-badge ${colorClass}">${String(n).padStart(2, '0')}</span>`;
                }).join('')
                : '<span class="text-muted">Winning numbers not available</span>';

            const tierCounts = [];
            for (let tier = 5; tier >= 3; tier--) {
                const count = contest.byTier[tier]?.filter(w => w.isValidEntry).length || 0;
                if (count > 0) {
                    const emoji = tier === 5 ? '🏆' : tier === 4 ? '🥈' : '🥉';
                    tierCounts.push(`<span class="badge badge-${tier === 5 ? 'warning' : tier === 4 ? 'info' : 'success'}">${emoji} ${tier}: ${count}</span>`);
                }
            }

            let prizeInfo = '';
            if (contest.winningTier > 0 && contest.prizePerWinner > 0) {
                const winnerCount = contest.byTier[contest.winningTier]?.filter(w => w.isValidEntry).length || 0;
                prizeInfo = `<div class="text-success mt-2" style="font-size:0.8rem">💰 R$ ${contest.prizePerWinner.toFixed(2)} per winner</div>`;
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <strong>Contest #${contest.contest}</strong>
                        <span class="text-muted">${contest.drawDate}</span>
                    </div>
                    <div class="card-body">
                        <div class="numbers-display mb-2" style="justify-content:center">${numbersHtml}</div>
                        <div class="text-center">
                            ${tierCounts.length > 0 ? tierCounts.join(' ') : '<span class="text-muted">No winners</span>'}
                            ${prizeInfo}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function applyWinnersFilters() {
        let result = [...allWinners];

        if (winnersFilters.contest) {
            result = result.filter(w => w.contest === winnersFilters.contest);
        }
        if (winnersFilters.prizeLevel !== 'all') {
            const level = parseInt(winnersFilters.prizeLevel);
            result = result.filter(w => w.matches === level);
        }

        filteredWinners = result;
        renderWinnersTable();
    }

    function renderWinnersTable() {
        const tbody = document.getElementById('winnersTableBody');
        if (!tbody) return;

        if (filteredWinners.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No winners found</td></tr>';
            return;
        }

        const displayWinners = filteredWinners.slice(0, 100);

        tbody.innerHTML = displayWinners.map(winner => {
            let matchBadge = '';
            switch (winner.matches) {
                case 5: matchBadge = '<span class="badge" style="background:#fbbf24;color:#000">🏆 5</span>'; break;
                case 4: matchBadge = '<span class="badge" style="background:#9ca3af;color:#000">🥈 4</span>'; break;
                case 3: matchBadge = '<span class="badge" style="background:#d97706;color:#fff">🥉 3</span>'; break;
                default: matchBadge = `<span class="badge badge-info">${winner.matches}</span>`;
            }

            const matchedSet = new Set(winner.matchedNumbers || []);
            const numbersHtml = winner.numbers.map(n => {
                const isMatched = matchedSet.has(n);
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass} ${isMatched ? 'match' : ''}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2, '0')}</span>`;
            }).join('');

            const matchedHtml = (winner.matchedNumbers || []).map(n => {
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2, '0')}</span>`;
            }).join('');

            return `
                <tr>
                    <td>${matchBadge}</td>
                    <td><strong>${winner.gameId}</strong></td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td><div class="numbers-display">${matchedHtml}</div></td>
                    <td>${winner.contest}</td>
                    <td>${winner.drawDate}</td>
                </tr>
            `;
        }).join('');

        if (filteredWinners.length > 100) {
            tbody.innerHTML += `<tr><td colspan="6" class="text-center text-muted">Showing 100 of ${filteredWinners.length} winners</td></tr>`;
        }
    }

    function exportWinnersCSV() {
        if (filteredWinners.length === 0) {
            AdminCore.showToast('No winners to export', 'warning');
            return;
        }

        const headers = ['Matches', 'Game ID', 'Numbers', 'Matched Numbers', 'Draw Date', 'Contest'];
        const rows = filteredWinners.map(w => [
            w.matches,
            w.gameId,
            w.numbers.join(', '),
            (w.matchedNumbers || []).join(', '),
            w.drawDate,
            w.contest
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `winners_${AdminCore.getBrazilDateString(new Date())}.csv`;
        link.click();

        AdminCore.showToast(`${filteredWinners.length} winners exported`, 'success');
    }

    // ============================================
    // DATA LOADING
    // ============================================

    async function loadAllData(forceRefresh = false) {
        // Loading all data

        try {
            // Ensure loading overlay is shown
            AdminCore.showLoading('Loading data...');
            AdminCore.updateLoadingProgress(0, 'Starting...');

            await DataStore.loadData(forceRefresh);

            AdminCore.updateLoadingProgress(65, 'Preparing data...');
            const platform = AdminCore.getCurrentPlatform();

            // Get platform-filtered data
            currentData.entries = DataStore.getEntries(platform);
            currentData.allEntries = DataStore.getAllEntries();
            // IMPORTANT: Get platform-filtered recharges (only recharges for users in this platform)
            currentData.recharges = DataStore.getRecharges(platform);
            currentData.allRecharges = DataStore.getAllRecharges(); // For validation across all platforms
            currentData.results = DataStore.getResults();

            AdminCore.updateLoadingProgress(70, 'Validating tickets...');
            // Validate only the platform-filtered entries (using ALL recharges for validation lookup)
            // Skip cache when platform is not ALL, since cached results are for all entries
            const skipCache = platform !== 'ALL';
            currentData.validationResults = await RechargeValidator.validateAllTickets(currentData.entries, currentData.allRecharges, skipCache);

            AdminCore.updateLoadingProgress(80, 'Matching recharges...');
            // BRUTE FORCE: Match recharges ONCE when data is loaded
            bruteForceMatchRecharges();

            AdminCore.updateLoadingProgress(85, 'Rendering dashboard...');
            renderDashboard();
            updateStatisticsTitles();

            AdminCore.updateLoadingProgress(90, 'Rendering entries...');
            renderEntries();

            AdminCore.updateLoadingProgress(95, 'Rendering results...');
            renderResults();

            AdminCore.updateLoadingProgress(98, 'Rendering winners...');
            renderWinners();

            AdminCore.updateLoadingProgress(100, 'Complete!');

            // Hide loading after a brief delay to show completion
            setTimeout(() => AdminCore.hideLoading(), 500);

        } catch (error) {
            AdminCore.hideLoading();
            AdminCore.showToast('Error loading data: ' + error.message, 'error');
        }
    }

    // ============================================
    // EVENT BINDING
    // ============================================

    function bindEvents() {
        // Chart metric selector
        document.getElementById('chartMetricSelect')?.addEventListener('change', (e) => {
            const { entries, recharges } = currentData;
            const dailyData = RechargeValidator.analyzeEngagementByDate(entries, recharges, statisticsDays);
            const canvas = document.getElementById('chartLast7Days');
            if (canvas) AdminCharts.createLast7DaysChart(canvas, dailyData, e.target.value);
        });

        // Statistics day range selector
        document.getElementById('statisticsDaysSelect')?.addEventListener('change', (e) => {
            statisticsDays = parseInt(e.target.value, 10) || 7;
            renderCharts();
            renderRechargeTable();
            updateStatisticsTitles();
        });

        // Entries filters
        const debouncedEntriesFilter = AdminCore.debounce(applyEntriesFilters, 300);
        document.getElementById('filterGameId')?.addEventListener('input', (e) => { entriesFilters.gameId = e.target.value; debouncedEntriesFilter(); });
        document.getElementById('filterWhatsapp')?.addEventListener('input', (e) => { entriesFilters.whatsapp = e.target.value; debouncedEntriesFilter(); });
        document.getElementById('filterOrderNumber')?.addEventListener('input', (e) => { entriesFilters.orderNumber = e.target.value; debouncedEntriesFilter(); });
        document.getElementById('filterContest')?.addEventListener('change', (e) => { entriesFilters.contest = e.target.value; applyEntriesFilters(); });
        document.getElementById('filterValidity')?.addEventListener('change', (e) => { entriesFilters.validity = e.target.value; applyEntriesFilters(); });
        document.getElementById('sortBy')?.addEventListener('change', (e) => { sortBy = e.target.value; applyEntriesFilters(); });
        document.getElementById('btnClearFilters')?.addEventListener('click', () => {
            entriesFilters = { gameId: '', whatsapp: '', contest: '', validity: 'all', orderNumber: '' };
            sortBy = 'date-desc';
            document.getElementById('filterGameId').value = '';
            document.getElementById('filterWhatsapp').value = '';
            document.getElementById('filterOrderNumber').value = '';
            document.getElementById('filterContest').value = '';
            document.getElementById('filterValidity').value = 'all';
            document.getElementById('sortBy').value = 'date-desc';
            applyEntriesFilters();
        });
        document.getElementById('btnExportCSV')?.addEventListener('click', exportEntriesCSV);
        document.getElementById('btnPrevPage')?.addEventListener('click', () => { if (entriesPage > 1) { entriesPage--; renderEntriesTable(); renderEntriesPagination(); } });
        document.getElementById('btnNextPage')?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredEntries.length / entriesPerPage);
            if (entriesPage < totalPages) { entriesPage++; renderEntriesTable(); renderEntriesPagination(); }
        });
        document.getElementById('perPageSelect')?.addEventListener('change', (e) => {
            entriesPerPage = parseInt(e.target.value);
            entriesPage = 1;
            renderEntriesTable();
            renderEntriesPagination();
        });

        // Results search
        const debouncedResultsSearch = AdminCore.debounce(renderResultsTable, 300);
        document.getElementById('searchResults')?.addEventListener('input', (e) => { resultsSearchTerm = e.target.value; debouncedResultsSearch(); });

        // Winners filters
        document.getElementById('filterWinnersContest')?.addEventListener('change', (e) => { winnersFilters.contest = e.target.value; applyWinnersFilters(); });
        document.getElementById('filterWinnersPrizeLevel')?.addEventListener('change', (e) => { winnersFilters.prizeLevel = e.target.value; applyWinnersFilters(); });
        document.getElementById('btnClearWinnersFilters')?.addEventListener('click', () => {
            winnersFilters = { contest: '', prizeLevel: 'all' };
            document.getElementById('filterWinnersContest').value = '';
            document.getElementById('filterWinnersPrizeLevel').value = 'all';
            applyWinnersFilters();
        });
        document.getElementById('btnExportWinnersCSV')?.addEventListener('click', exportWinnersCSV);

        // Clear cache button
        document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
            DataStore.clearStorage();
            AdminCore.showToast('Cache cleared! Refreshing...', 'success');
            setTimeout(() => loadAllData(true), 500);
        });
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function init() {
        // Initializing

        bindEvents();

        // Always load fresh data on init
        loadAllData(true);

        isInitialized = true;
    }

    // Event listeners
    if (typeof AdminCore !== 'undefined') {
        // Only initialize when app is shown (after login or if already authenticated)
        AdminCore.on('appShown', () => {
            if (!isInitialized) {
                init();
            }
        });

        // Also listen for login event (in case appShown isn't emitted)
        AdminCore.on('login', () => {
            if (!isInitialized) {
                init();
            }
        });

        AdminCore.on('refresh', () => {
            // Refresh event received
            if (isInitialized) {
                loadAllData(true);
            }
        });

        AdminCore.on('dataStoreReady', ({ fromCache }) => {
            // Only reload if data came from network (not cache) and already initialized
            if (!fromCache && isInitialized) {
                // Fresh data ready, re-rendering
                loadAllData(false); // Don't force refresh again, just re-render
            }
        });

        AdminCore.on('platformChange', ({ platform }) => {
            // Platform changed
            if (isInitialized) {
                loadAllData(false); // Re-render with new platform filter
            }
        });

        // Reset initialization on logout
        AdminCore.on('logout', () => {
            isInitialized = false;
        });
    }

    // ============================================
    // PUBLIC API
    // ============================================
    return {
        init,
        loadAllData,
        goToEntriesPage,
        showTicketDetails,
        exportEntriesCSV,
        exportWinnersCSV
    };
})();

