/**
 * POP-SORTE Admin Dashboard - Results Page Module
 * 
 * This module renders the contest results page with:
 * - Read-only table from Results sheet
 * - Columns: Contest, Draw Date, Winning Numbers, Saved At, Source
 * - Search and filter functionality
 * 
 * Dependencies: AdminCore, ResultsFetcher
 */

// ============================================
// Results Page Module
// ============================================
window.ResultsPage = (function() {
    'use strict';

    // ============================================
    // State
    // ============================================
    let isInitialized = false;
    let results = [];
    let filteredResults = [];
    let searchTerm = '';

    // ============================================
    // HTML Templates
    // ============================================
    
    function getTemplate() {
        return `
            <div class="results-content">
                <!-- Header -->
                <div class="section-header mb-4">
                    <div>
                        <h2 class="section-title">🎯 Contest Results</h2>
                        <p class="section-subtitle">Official Quina results (read-only)</p>
                    </div>
                </div>

                <!-- Stats -->
                <div class="stats-grid mb-4">
                    <div class="stat-card primary">
                        <span class="stat-label">Total Results</span>
                        <span class="stat-value" id="statTotalResults">--</span>
                    </div>
                    <div class="stat-card success">
                        <span class="stat-label">Valid Draws</span>
                        <span class="stat-value" id="statValidDraws">--</span>
                    </div>
                    <div class="stat-card warning">
                        <span class="stat-label">No Draw</span>
                        <span class="stat-value" id="statNoDraws">--</span>
                    </div>
                    <div class="stat-card info">
                        <span class="stat-label">Latest Result</span>
                        <span class="stat-value" id="statLatestContest">--</span>
                    </div>
                </div>

                <!-- Latest Result Card -->
                <div class="card mb-4" id="latestResultCard" style="display: none;">
                    <div class="card-header">
                        <div>
                            <h3 class="card-title">🎱 Latest Result</h3>
                            <span class="text-muted" id="latestResultDate">--</span>
                        </div>
                        <span class="badge badge-success" id="latestResultContest">--</span>
                    </div>
                    <div class="card-body">
                        <div class="numbers-display" id="latestResultNumbers" style="justify-content: center;">
                            <!-- Numbers will be rendered here -->
                        </div>
                    </div>
                </div>

                <!-- Search -->
                <div class="filters-row">
                    <div class="filter-group" style="flex: 1;">
                        <label>Search Contest</label>
                        <input type="text" id="searchResults" placeholder="Enter contest number...">
                    </div>
                </div>

                <!-- Results Table -->
                <div class="card">
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Contest</th>
                                    <th>Draw Date</th>
                                    <th>Winning Numbers</th>
                                    <th>Saved At</th>
                                    <th>Source</th>
                                </tr>
                            </thead>
                            <tbody id="resultsTableBody">
                                <tr><td colspan="5" class="text-center text-muted">Loading results...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Info -->
                <div class="mt-4 text-center text-muted" style="font-size: 0.85rem;">
                    <p>📢 Results are obtained from the official Quina lottery.</p>
                    <p>Source: <a href="https://loterias.caixa.gov.br" target="_blank">loterias.caixa.gov.br</a></p>
                </div>
            </div>
        `;
    }

    // ============================================
    // Render Functions
    // ============================================
    
    function renderStats() {
        const total = results.length;
        const validDraws = results.filter(r => !r.isNoDraw).length;
        const noDraws = results.filter(r => r.isNoDraw).length;
        
        document.getElementById('statTotalResults').textContent = total.toLocaleString();
        document.getElementById('statValidDraws').textContent = validDraws.toLocaleString();
        document.getElementById('statNoDraws').textContent = noDraws.toLocaleString();
        
        // Latest contest
        const latest = results.find(r => !r.isNoDraw);
        if (latest) {
            document.getElementById('statLatestContest').textContent = `#${latest.contest}`;
        }
    }

    function renderLatestResult() {
        const card = document.getElementById('latestResultCard');
        const latest = results.find(r => !r.isNoDraw);
        
        if (!latest || !card) {
            if (card) card.style.display = 'none';
            return;
        }
        
        card.style.display = 'block';
        
        document.getElementById('latestResultContest').textContent = `Contest #${latest.contest}`;
        document.getElementById('latestResultDate').textContent = latest.drawDate;
        
        const numbersContainer = document.getElementById('latestResultNumbers');
        numbersContainer.innerHTML = latest.numbers.map(n => {
            const colorClass = AdminCore.getBallColorClass(n);
            return `<span class="number-badge ${colorClass}" style="width: 48px; height: 48px; font-size: 1.1rem;">${String(n).padStart(2, '0')}</span>`;
        }).join('');
    }

    function renderTable() {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;
        
        if (filteredResults.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No results found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filteredResults.map(result => {
            // Numbers
            let numbersHtml = '';
            if (result.isNoDraw) {
                numbersHtml = '<span class="badge badge-warning">No Draw</span>';
            } else {
                numbersHtml = result.numbers.map(n => {
                    const colorClass = AdminCore.getBallColorClass(n);
                    return `<span class="number-badge ${colorClass}" style="width: 28px; height: 28px; font-size: 0.7rem;">${String(n).padStart(2, '0')}</span>`;
                }).join('');
            }
            
            // Source badge
            let sourceBadge = '';
            const source = (result.source || '').toLowerCase();
            if (source.includes('caixa')) {
                sourceBadge = '<span class="badge badge-success">Caixa</span>';
            } else if (source.includes('api')) {
                sourceBadge = '<span class="badge badge-info">API</span>';
            } else if (source) {
                sourceBadge = `<span class="badge badge-gray">${result.source}</span>`;
            } else {
                sourceBadge = '<span class="badge badge-gray">Manual</span>';
            }
            
            // Format draw date as "Day, Date Month Year" (e.g., "Monday, 22 December 2025")
            let formattedDrawDate = '-';
            if (result.drawDate) {
                try {
                    // Try to parse the date - could be DD/MM/YYYY or "Mon, 22 Dec 2025" format
                    let dateObj = null;
                    if (result.drawDateParsed) {
                        dateObj = result.drawDateParsed;
                    } else {
                        // Try parsing DD/MM/YYYY format
                        const parts = result.drawDate.split('/');
                        if (parts.length === 3) {
                            const [d, m, y] = parts.map(Number);
                            dateObj = new Date(y, m - 1, d);
                        }
                    }
                    
                    if (dateObj && !isNaN(dateObj.getTime())) {
                        // Format as "Day, Date Month Year" in Brazilian timezone
                        formattedDrawDate = AdminCore.formatBrazilDateTime(dateObj, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                        });
                        // Capitalize first letter
                        formattedDrawDate = formattedDrawDate.charAt(0).toUpperCase() + formattedDrawDate.slice(1);
                    } else {
                        formattedDrawDate = result.drawDate;
                    }
                } catch (e) {
                    formattedDrawDate = result.drawDate;
                }
            }
            
            return `
                <tr>
                    <td><strong>#${result.contest}</strong></td>
                    <td>${formattedDrawDate}</td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td style="font-size: 0.8rem;">${result.savedAt || '-'}</td>
                    <td>${sourceBadge}</td>
                </tr>
            `;
        }).join('');
    }

    // ============================================
    // Search Function
    // ============================================
    
    function applySearch() {
        if (!searchTerm) {
            filteredResults = [...results];
        } else {
            const term = searchTerm.toLowerCase();
            filteredResults = results.filter(r => 
                r.contest.toLowerCase().includes(term) ||
                (r.drawDate || '').toLowerCase().includes(term)
            );
        }
        renderTable();
    }

    // ============================================
    // Data Loading
    // ============================================
    
    async function loadData() {
        try {
            // Use DataStore for consistent caching
            await DataStore.loadData();
            results = DataStore.getResults();
            
            filteredResults = [...results];
            
            renderStats();
            renderLatestResult();
            renderTable();
            
        } catch (error) {
            console.error('Error loading results:', error);
            AdminCore.showToast('Error loading results: ' + error.message, 'error');
            
            const tbody = document.getElementById('resultsTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading data</td></tr>';
            }
        }
    }

    // ============================================
    // Event Handlers
    // ============================================
    
    // Debounced search function (300ms delay)
    const debouncedApplySearch = AdminCore.debounce(applySearch, 300);
    
    function bindEvents() {
        const searchInput = document.getElementById('searchResults');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchTerm = e.target.value;
                debouncedApplySearch();
            });
        }
    }

    // ============================================
    // Initialization
    // ============================================
    
    function init() {
        const container = document.getElementById('page-results');
        if (!container) return;
        
        container.innerHTML = getTemplate();
        bindEvents();
        
        // Load data asynchronously - don't block initialization
        loadData().catch(error => {
            console.error('Error loading results data:', error);
            AdminCore.showToast('Error loading results: ' + error.message, 'error');
        });
        
        isInitialized = true;
    }

    function refresh() {
        if (isInitialized) {
            loadData();
        }
    }

    // Listen for page changes
    if (typeof AdminCore !== 'undefined') {
        AdminCore.on('pageChange', ({ page, isFirstVisit }) => {
            if (page === 'results') {
                if (!isInitialized) {
                    init();
                } else {
                    // Reload data when returning to results
                    console.log('Results: Page revisited, reloading data');
                    loadData();
                }
            }
        });
        
        // Only refresh on explicit refresh action
        AdminCore.on('refresh', () => {
            if (AdminCore.getCurrentPage() === 'results' && isInitialized) {
                refresh();
            }
        });
    }

    // ============================================
    // Public API
    // ============================================
    return {
        init,
        refresh,
        loadData
    };
})();
