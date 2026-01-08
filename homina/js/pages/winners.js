/**
 * POP-SORTE Admin Dashboard - Winners Page Module
 * 
 * LAZY LOADING ARCHITECTURE:
 * - Calculates winners ON-DEMAND when page is first visited
 * - Results are cached for subsequent visits
 * - Uses DataStore for raw data access
 * 
 * Dependencies: AdminCore, DataStore, WinnerCalculator
 */

window.WinnersPage = (function() {
    'use strict';

    // ============================================
    // State
    // ============================================
    let isInitialized = false;
    let winnersCalculated = false;
    let allWinners = [];
    let filteredWinners = [];
    let calculation = null;
    let filters = {
        contest: '',
        drawDate: '',
        prizeLevel: 'all',
        whatsapp: ''
    };

    // ============================================
    // HTML Template
    // ============================================
    
    function getTemplate() {
        return `
            <div class="winners-content">
                <!-- Header -->
                <div class="section-header mb-4">
                    <h2 class="section-title">🏆 Winners</h2>
                    <p class="text-muted">Entries with 3+ matching numbers</p>
                </div>

                <!-- Summary Stats -->
                <div class="stats-grid mb-4" id="winnersSummaryStats">
                    <div class="stat-card" style="border-left-color: #fbbf24;">
                        <span class="stat-label">🏆 5 Matches</span>
                        <span class="stat-value" id="stat5Matches">--</span>
                    </div>
                    <div class="stat-card" style="border-left-color: #9ca3af;">
                        <span class="stat-label">🥈 4 Matches</span>
                        <span class="stat-value" id="stat4Matches">--</span>
                    </div>
                    <div class="stat-card" style="border-left-color: #d97706;">
                        <span class="stat-label">🥉 3 Matches</span>
                        <span class="stat-value" id="stat3Matches">--</span>
                    </div>
                    <div class="stat-card success">
                        <span class="stat-label">Total Winners</span>
                        <span class="stat-value" id="statTotalWinners">--</span>
                    </div>
                </div>

                <!-- Filters -->
                <div class="filters-row mb-4">
                    <div class="filter-group">
                        <label>Contest</label>
                        <select id="filterWinnersContest"><option value="">All</option></select>
                    </div>
                    <div class="filter-group">
                        <label>Draw Date</label>
                        <select id="filterWinnersDrawDate"><option value="">All</option></select>
                    </div>
                    <div class="filter-group">
                        <label>Matches</label>
                        <select id="filterWinnersPrizeLevel">
                            <option value="all">All</option>
                            <option value="5">5 Matches</option>
                            <option value="4">4 Matches</option>
                            <option value="3">3 Matches</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>WhatsApp</label>
                        <input type="text" id="filterWinnersWhatsapp" placeholder="Search...">
                    </div>
                    <div class="filter-actions">
                        <button id="btnClearWinnersFilters" class="btn btn-secondary btn-sm">Clear</button>
                        <button id="btnExportWinnersCSV" class="btn btn-primary btn-sm">📥 Export</button>
                    </div>
                </div>

                <!-- Winners Table -->
                <div class="card">
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Matches</th>
                                    <th>Game ID</th>
                                    <th>Numbers</th>
                                    <th>Matched</th>
                                    <th>Contest</th>
                                    <th>Draw Date</th>
                                </tr>
                            </thead>
                            <tbody id="winnersTableBody">
                                <tr><td colspan="6" class="text-center text-muted">Calculating winners...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // Render Functions
    // ============================================
    
    function renderStats() {
        if (!calculation) return;
        
        const stats = calculation.stats;
        // Stats are in stats.byTier[5], stats.byTier[4], etc.
        document.getElementById('stat5Matches').textContent = (stats.byTier?.[5] || 0).toLocaleString();
        document.getElementById('stat4Matches').textContent = (stats.byTier?.[4] || 0).toLocaleString();
        document.getElementById('stat3Matches').textContent = (stats.byTier?.[3] || 0).toLocaleString();
        document.getElementById('statTotalWinners').textContent = (stats.totalWinners || 0).toLocaleString();
    }

    function renderFilterOptions() {
        // Contests from winners
        const contests = [...new Set(allWinners.map(w => w.contest).filter(Boolean))]
            .sort((a, b) => parseInt(b) - parseInt(a));
        const contestSelect = document.getElementById('filterWinnersContest');
        if (contestSelect) {
            contestSelect.innerHTML = '<option value="">All</option>' +
                contests.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        
        // Draw dates from winners
        const dates = [...new Set(allWinners.map(w => w.drawDate).filter(Boolean))].sort().reverse();
        const dateSelect = document.getElementById('filterWinnersDrawDate');
        if (dateSelect) {
            dateSelect.innerHTML = '<option value="">All</option>' +
                dates.map(d => `<option value="${d}">${d}</option>`).join('');
        }
    }

    function applyFilters() {
        let result = [...allWinners];
        
        if (filters.contest) {
            result = result.filter(w => w.contest === filters.contest);
        }
        if (filters.drawDate) {
            result = result.filter(w => w.drawDate === filters.drawDate);
        }
        if (filters.prizeLevel !== 'all') {
            const level = parseInt(filters.prizeLevel);
            result = result.filter(w => w.matchCount === level);
        }
        if (filters.whatsapp) {
            const term = filters.whatsapp.toLowerCase();
            result = result.filter(w => (w.whatsapp || '').toLowerCase().includes(term));
        }
        
        filteredWinners = result;
        renderTable();
    }

    function clearFilters() {
        filters = { contest: '', drawDate: '', prizeLevel: 'all', whatsapp: '' };
        document.getElementById('filterWinnersContest').value = '';
        document.getElementById('filterWinnersDrawDate').value = '';
        document.getElementById('filterWinnersPrizeLevel').value = 'all';
        document.getElementById('filterWinnersWhatsapp').value = '';
        applyFilters();
    }

    function renderTable() {
        const tbody = document.getElementById('winnersTableBody');
        if (!tbody) return;
        
        if (filteredWinners.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No winners found</td></tr>';
            return;
        }
        
        // Show first 100 winners (pagination could be added)
        const displayWinners = filteredWinners.slice(0, 100);
        
        tbody.innerHTML = displayWinners.map(winner => {
            // Match count badge
            let matchBadge = '';
            switch (winner.matchCount) {
                case 5: matchBadge = '<span class="badge" style="background:#fbbf24;color:#000">🏆 5</span>'; break;
                case 4: matchBadge = '<span class="badge" style="background:#9ca3af;color:#000">🥈 4</span>'; break;
                case 3: matchBadge = '<span class="badge" style="background:#d97706;color:#fff">🥉 3</span>'; break;
                default: matchBadge = `<span class="badge badge-info">${winner.matchCount}</span>`;
            }
            
            // All numbers with highlights for matched ones
            const matchedSet = new Set(winner.matchedNumbers || []);
            const numbersHtml = winner.numbers.map(n => {
                const isMatched = matchedSet.has(n);
                const colorClass = AdminCore.getBallColorClass(n);
                const matchClass = isMatched ? 'matched' : '';
                return `<span class="number-badge ${colorClass} ${matchClass}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2,'0')}</span>`;
            }).join('');
            
            // Matched numbers only
            const matchedHtml = (winner.matchedNumbers || []).map(n => {
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2,'0')}</span>`;
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
        
        // Show count info
        if (filteredWinners.length > 100) {
            tbody.innerHTML += `<tr><td colspan="6" class="text-center text-muted">Showing 100 of ${filteredWinners.length} winners</td></tr>`;
        }
    }

    function exportCSV() {
        if (filteredWinners.length === 0) {
            AdminCore.showToast('No winners to export', 'warning');
            return;
        }
        
        const headers = ['Matches', 'Game ID', 'WhatsApp', 'Numbers', 'Matched Numbers', 'Draw Date', 'Contest'];
        const rows = filteredWinners.map(w => [
            w.matchCount,
            w.gameId,
            w.whatsapp,
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
    // Data Loading - ON DEMAND
    // ============================================
    
    async function calculateWinners(forceRecalculate = false) {
        const platform = AdminCore.getCurrentPlatform();
        
        // Check if we can use cached results for this platform
        if (!forceRecalculate && winnersCalculated && allWinners.length > 0 && calculation?.platform === platform) {
            // Use cached calculation
            return;
        }
        
        const tbody = document.getElementById('winnersTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center"><span class="spinner"></span> Calculating winners...</td></tr>';
        }
        
        try {
            // Get data from DataStore
            const entries = DataStore.getEntries(platform);
            const results = DataStore.getResults();
            
            if (entries.length === 0 || results.length === 0) {
                // Wait for data to load
                await DataStore.loadData();
            }
            
            // Calculate winners (this is the heavy operation)
            // Pass platform for platform-specific prize calculation
            calculation = await WinnerCalculator.calculateAllWinners(
                DataStore.getEntries(platform),
                DataStore.getResults(),
                platform
            );
            
            allWinners = calculation.allWinners || [];
            filteredWinners = [...allWinners];
            winnersCalculated = true;
            
            renderStats();
            renderFilterOptions();
            renderTable();
            
        } catch (error) {
            console.error('Error calculating winners:', error);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error calculating winners</td></tr>';
            }
        }
    }

    // ============================================
    // Event Handlers
    // ============================================
    
    const debouncedFilter = AdminCore.debounce(applyFilters, 300);
    
    function bindEvents() {
        document.getElementById('filterWinnersContest')?.addEventListener('change', e => { filters.contest = e.target.value; applyFilters(); });
        document.getElementById('filterWinnersDrawDate')?.addEventListener('change', e => { filters.drawDate = e.target.value; applyFilters(); });
        document.getElementById('filterWinnersPrizeLevel')?.addEventListener('change', e => { filters.prizeLevel = e.target.value; applyFilters(); });
        document.getElementById('filterWinnersWhatsapp')?.addEventListener('input', e => { filters.whatsapp = e.target.value; debouncedFilter(); });
        document.getElementById('btnClearWinnersFilters')?.addEventListener('click', clearFilters);
        document.getElementById('btnExportWinnersCSV')?.addEventListener('click', exportCSV);
    }

    // ============================================
    // Initialization
    // ============================================
    
    async function init() {
        const container = document.getElementById('page-winners');
        if (!container) return;
        
        container.innerHTML = getTemplate();
        bindEvents();
        
        // Ensure data is loaded first
        await DataStore.loadData();
        
        // Calculate winners (heavy operation - only done once per session)
        await calculateWinners();
        
        isInitialized = true;
    }

    function refresh() {
        if (!isInitialized) return;
        
        // Force recalculation on refresh
        winnersCalculated = false;
        calculateWinners();
    }

    // Event listeners
    if (typeof AdminCore !== 'undefined') {
        AdminCore.on('pageChange', ({ page, isFirstVisit }) => {
            if (page === 'winners') {
                if (!isInitialized) {
                    init();
                } else {
                    // Recalculate winners when returning to page
                    console.log('Winners: Page revisited, recalculating');
                    calculateWinners(false);
                }
            }
        });
        
        AdminCore.on('refresh', () => {
            if (AdminCore.getCurrentPage() === 'winners') {
                DataStore.loadData(true).then(() => refresh());
            }
        });
        
        // Listen for platform changes
        AdminCore.on('platformChange', ({ platform }) => {
            if (AdminCore.getCurrentPage() === 'winners' && isInitialized) {
                console.log('Winners: Platform changed to', platform);
                calculateWinners(true); // Force recalculate for new platform
            }
        });
    }

    return { init, refresh, exportCSV };
})();
