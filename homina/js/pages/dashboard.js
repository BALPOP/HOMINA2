/**
 * POP-SORTE Admin Dashboard - Dashboard Page Module
 * 
 * This module renders the main dashboard with:
 * 1. All-Time Stats section (with platform breakdown)
 * 2. Engagement Overview section
 * 3. 7-Day Ticket Creators chart
 * 4. Last 7 Days Statistics chart
 * 5. Recharge vs Tickets table
 * 6. Winners by Contest cards (with prize info)
 * 7. Top Entrants table
 * 8. Latest Entries table
 * 
 * Supports platform filtering (ALL, POPN1, POPLUZ)
 * 
 * Dependencies: AdminCore, DataFetcher, DataStore, ResultsFetcher, RechargeValidator, WinnerCalculator, AdminCharts
 */

window.DashboardPage = (function() {
    'use strict';

    // ============================================
    // State
    // ============================================
    let isInitialized = false;
    let currentData = {
        entries: [],
        recharges: [],
        results: [],
        allEntries: [] // Unfiltered entries for platform breakdown
    };

    // ============================================
    // HTML Templates
    // ============================================
    
    function getTemplate() {
        return `
            <div class="dashboard-content">
                <!-- All-Time Stats -->
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">📊 General Data (All Time)</h2>
                        <span id="platformStatsLabel" class="badge badge-info"></span>
                    </div>
                    <div class="stats-grid" id="allTimeStats">
                        <div class="stat-card primary">
                            <span class="stat-label">Total Tickets</span>
                            <span class="stat-value" id="statTotalTickets">--</span>
                        </div>
                        <div class="stat-card info">
                            <span class="stat-label">Total Contests</span>
                            <span class="stat-value" id="statTotalContests">--</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-label">Draw Dates</span>
                            <span class="stat-value" id="statDrawDates">--</span>
                        </div>
                        <div class="stat-card warning">
                            <span class="stat-label">Pending</span>
                            <span class="stat-value" id="statPending">--</span>
                        </div>
                        <div class="stat-card success">
                            <span class="stat-label">Total Winners</span>
                            <span class="stat-value" id="statTotalWinners">--</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-label">Win Rate</span>
                            <span class="stat-value" id="statWinRate">--</span>
                        </div>
                    </div>
                    <!-- Platform Breakdown (shown in ALL view) -->
                    <div id="platformBreakdown" class="platform-breakdown" style="display: none;">
                        <div class="platform-breakdown-item">
                            <span class="platform-name">
                                <span class="platform-badge popn1">🎰 POPN1</span>
                            </span>
                            <span class="platform-value" id="statPOPN1Tickets">--</span>
                        </div>
                        <div class="platform-breakdown-item">
                            <span class="platform-name">
                                <span class="platform-badge popluz">💡 POPLUZ</span>
                            </span>
                            <span class="platform-value" id="statPOPLUZTickets">--</span>
                        </div>
                    </div>
                </section>

                <!-- Engagement Overview -->
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">👥 Engagement Overview</h2>
                    </div>
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-body">
                                <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
                                    <div class="stat-card success">
                                        <span class="stat-label">Rechargers</span>
                                        <span class="stat-value" id="statRechargers">--</span>
                                    </div>
                                    <div class="stat-card primary">
                                        <span class="stat-label">Participants</span>
                                        <span class="stat-value" id="statParticipants">--</span>
                                    </div>
                                    <div class="stat-card warning">
                                        <span class="stat-label">Recharged No Ticket</span>
                                        <span class="stat-value" id="statNoTicket">--</span>
                                    </div>
                                    <div class="stat-card info">
                                        <span class="stat-label">Participation Rate</span>
                                        <span class="stat-value" id="statParticipationRate">--</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-header">
                                <h3 class="card-title">🎫 Ticket Creators (7 Days)</h3>
                                <span class="text-muted">Unique creators per day</span>
                            </div>
                            <div class="card-body">
                                <div class="chart-container" style="height: 180px;">
                                    <canvas id="chartTicketCreators7Day"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Last 7 Days Chart -->
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">📈 Last 7 Days Statistics</h2>
                        <div class="section-actions">
                            <select id="chartMetricSelect" class="form-select form-select-sm">
                                <option value="all">All Metrics</option>
                                <option value="entries">Entries Only</option>
                                <option value="rechargers">Rechargers Only</option>
                                <option value="participants">Participants Only</option>
                            </select>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-body">
                            <div class="chart-container">
                                <canvas id="chartLast7Days"></canvas>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Recharge vs Tickets Table -->
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">💰 Recharge vs Tickets (Last 7 Days)</h2>
                    </div>
                    <div class="card">
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Rechargers</th>
                                        <th>Participants</th>
                                        <th>Recharged No Ticket</th>
                                        <th>Participation %</th>
                                        <th>Non-Participation %</th>
                                        <th>Total Entries</th>
                                    </tr>
                                </thead>
                                <tbody id="rechargeVsTicketsBody">
                                    <tr><td colspan="7" class="text-center text-muted">Loading...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <!-- Winners by Contest -->
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">🏆 Winners by Contest</h2>
                        <span id="prizePoolLabel" class="badge badge-warning"></span>
                    </div>
                    <div class="grid-3" id="winnersByContestContainer">
                        <div class="card"><div class="card-body text-center text-muted">Loading...</div></div>
                    </div>
                </section>

                <!-- Two Column Layout: Top Entrants & Latest Entries -->
                <div class="grid-2">
                    <!-- Top Entrants -->
                    <section class="section">
                        <div class="section-header">
                            <h2 class="section-title">🔥 Top Entrants</h2>
                        </div>
                        <div class="card">
                            <div class="table-container">
                                <table class="table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Game ID</th>
                                            <th>WhatsApp</th>
                                            <th>Entries</th>
                                        </tr>
                                    </thead>
                                    <tbody id="topEntrantsBody">
                                        <tr><td colspan="4" class="text-center text-muted">Loading...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    <!-- Latest Entries -->
                    <section class="section">
                        <div class="section-header">
                            <h2 class="section-title">🎫 Latest Entries</h2>
                        </div>
                        <div class="card">
                            <div class="table-container">
                                <table class="table" id="latestEntriesTable">
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Game ID</th>
                                            <th>Platform</th>
                                            <th>Numbers</th>
                                            <th>Contest</th>
                                        </tr>
                                    </thead>
                                    <tbody id="latestEntriesContainer">
                                        <tr><td colspan="5" class="text-center text-muted">Loading...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        `;
    }

    // ============================================
    // Render Functions
    // ============================================
    
    function renderAllTimeStats() {
        const { entries, allEntries } = currentData;
        const platform = AdminCore.getCurrentPlatform();
        
        // Update platform label
        const platformLabel = document.getElementById('platformStatsLabel');
        if (platformLabel) {
            platformLabel.textContent = platform === 'ALL' ? 'All Platforms' : platform;
            platformLabel.className = `badge badge-${platform === 'ALL' ? 'info' : platform === 'POPN1' ? 'primary' : 'warning'}`;
        }
        
        // Show/hide platform breakdown
        const breakdownEl = document.getElementById('platformBreakdown');
        if (breakdownEl) {
            breakdownEl.style.display = platform === 'ALL' ? 'grid' : 'none';
        }
        
        // Stats for current view
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
        
        // Platform breakdown (only in ALL view)
        if (platform === 'ALL' && allEntries.length > 0) {
            const breakdown = DataStore.getEntriesByPlatform(allEntries);
            document.getElementById('statPOPN1Tickets').textContent = breakdown.POPN1.count.toLocaleString() + ' tickets';
            document.getElementById('statPOPLUZTickets').textContent = breakdown.POPLUZ.count.toLocaleString() + ' tickets';
        }
    }

    async function renderWinnersStats() {
        try {
            const { entries, results } = currentData;
            const platform = AdminCore.getCurrentPlatform();
            const winnerStats = await WinnerCalculator.getWinnerStats(entries, results, platform);
            
            document.getElementById('statTotalWinners').textContent = winnerStats.totalWinners.toLocaleString();
            document.getElementById('statWinRate').textContent = `${winnerStats.winRate}%`;
        } catch (error) {
            console.error('Error rendering winners stats:', error);
        }
    }

    function renderEngagementOverview() {
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
        
        // Render 7-day ticket creators chart
        renderTicketCreators7DayChart();
    }

    function renderTicketCreators7DayChart() {
        const { entries } = currentData;
        const dailyData = WinnerCalculator.getTicketCreatorsByDay(entries, 7);
        
        const canvas = document.getElementById('chartTicketCreators7Day');
        if (canvas) {
            AdminCharts.createTicketCreators7DayChart(canvas, dailyData);
        }
    }

    function renderLast7DaysChart(metric = 'all') {
        const { entries, recharges } = currentData;
        const dailyData = RechargeValidator.analyzeEngagementByDate(entries, recharges, 7);
        
        const canvas = document.getElementById('chartLast7Days');
        if (canvas) {
            AdminCharts.createLast7DaysChart(canvas, dailyData, metric);
        }
    }

    function renderRechargeVsTicketsTable() {
        const { entries, recharges } = currentData;
        const dailyData = RechargeValidator.analyzeEngagementByDate(entries, recharges, 7);
        
        const tbody = document.getElementById('rechargeVsTicketsBody');
        if (!tbody) return;
        
        if (dailyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No data</td></tr>';
            return;
        }
        
        const hasRechargeData = recharges && recharges.length > 0;
        
        tbody.innerHTML = dailyData.map(day => {
            const nonParticipationRate = day.totalRechargers > 0
                ? ((day.rechargedNoTicket / day.totalRechargers) * 100).toFixed(1)
                : '-';
            
            return `
                <tr>
                    <td><strong>${day.displayDate}</strong></td>
                    <td>${hasRechargeData ? day.totalRechargers : '<span class="text-muted">-</span>'}</td>
                    <td>${hasRechargeData ? day.totalParticipants : '<span class="text-muted">-</span>'}</td>
                    <td class="text-warning">${hasRechargeData ? day.rechargedNoTicket : '<span class="text-muted">-</span>'}</td>
                    <td class="text-success">${hasRechargeData ? day.participationRate + '%' : '<span class="text-muted">-</span>'}</td>
                    <td class="text-danger">${hasRechargeData && day.totalRechargers > 0 ? nonParticipationRate + '%' : '<span class="text-muted">-</span>'}</td>
                    <td><strong>${day.totalEntries}</strong></td>
                </tr>
            `;
        }).join('');
    }

    async function renderWinnersByContest() {
        const container = document.getElementById('winnersByContestContainer');
        if (!container) return;
        
        try {
            const { entries, results } = currentData;
            const platform = AdminCore.getCurrentPlatform();
            const prizePool = WinnerCalculator.getPrizePool(platform === 'ALL' ? 'DEFAULT' : platform);
            
            // Update prize pool label
            const prizeLabel = document.getElementById('prizePoolLabel');
            if (prizeLabel) {
                prizeLabel.textContent = `Prize Pool: R$ ${prizePool.toLocaleString()}`;
            }
            
            const calculation = await WinnerCalculator.calculateAllWinners(entries, results, platform);
            
            const contestsWithResults = calculation.contestResults
                .filter(c => c.hasResult)
                .slice(0, 6);
            
            if (contestsWithResults.length === 0) {
                container.innerHTML = '<div class="card"><div class="card-body text-center text-muted">No contest results available</div></div>';
                return;
            }
            
            container.innerHTML = contestsWithResults.map(contest => {
                const numbersHtml = contest.winningNumbers.map(n => {
                    const colorClass = AdminCore.getBallColorClass(n);
                    return `<span class="number-badge ${colorClass}">${String(n).padStart(2, '0')}</span>`;
                }).join('');
                
                const tierCounts = [];
                for (let tier = 5; tier >= 3; tier--) {
                    const count = contest.byTier[tier]?.filter(w => w.isValidEntry).length || 0;
                    if (count > 0) {
                        const emoji = tier === 5 ? '🏆' : tier === 4 ? '🥈' : '🥉';
                        tierCounts.push(`<span class="badge badge-${tier === 5 ? 'warning' : tier === 4 ? 'info' : 'success'}">${emoji} ${tier}: ${count}</span>`);
                    }
                }
                
                // Calculate prize info for winning tier
                let prizeInfo = '';
                if (contest.winningTier > 0 && contest.prizePerWinner > 0) {
                    const winnerCount = contest.byTier[contest.winningTier]?.filter(w => w.isValidEntry).length || 0;
                    prizeInfo = `<div class="text-success mt-2" style="font-size: 0.8rem;">
                        💰 R$ ${contest.prizePerWinner.toFixed(2)} per winner (${winnerCount} winner${winnerCount > 1 ? 's' : ''})
                    </div>`;
                }
                
                return `
                    <div class="card">
                        <div class="card-header">
                            <strong>Contest #${contest.contest}</strong>
                            <span class="text-muted">${contest.drawDate}</span>
                        </div>
                        <div class="card-body">
                            <div class="numbers-display mb-2" style="justify-content: center;">${numbersHtml}</div>
                            <div class="text-center">
                                ${tierCounts.length > 0 ? tierCounts.join(' ') : '<span class="text-muted">No winners</span>'}
                                ${prizeInfo}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error rendering winners by contest:', error);
            container.innerHTML = '<div class="card"><div class="card-body text-center text-danger">Error loading data</div></div>';
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
                <td>${AdminCore.maskWhatsApp(entrant.whatsapp)}</td>
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
                return `<span class="number-badge ${colorClass}" style="width:22px;height:22px;font-size:0.6rem">${String(n).padStart(2,'0')}</span>`;
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

    // ============================================
    // Data Loading
    // ============================================
    
    async function loadData() {
        try {
            // Use DataStore for cached data
            await DataStore.loadData();
            
            const platform = AdminCore.getCurrentPlatform();
            
            // Get filtered entries based on platform
            const entries = DataStore.getEntries(platform);
            const allEntries = DataStore.getAllEntries();
            const results = DataStore.getResults();
            const recharges = DataStore.getRecharges();
            
            currentData = { entries, allEntries, recharges, results };
            
            // Render all sections
            renderAllTimeStats();
            renderLatestEntries();
            renderEngagementOverview();
            renderRechargeVsTicketsTable();
            renderLast7DaysChart('all');
            renderWinnersStats();
            renderWinnersByContest();
            renderTopEntrants();
            
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            AdminCore.showToast('Error loading data: ' + error.message, 'error');
        }
    }

    function handleMetricChange(e) {
        renderLast7DaysChart(e.target.value);
    }

    // ============================================
    // Initialization
    // ============================================
    
    function init() {
        const container = document.getElementById('page-dashboard');
        if (!container) return;
        
        container.innerHTML = getTemplate();
        
        const metricSelect = document.getElementById('chartMetricSelect');
        if (metricSelect) {
            metricSelect.addEventListener('change', handleMetricChange);
        }
        
        loadData();
        
        isInitialized = true;
    }

    function refresh() {
        if (isInitialized) {
            loadData();
        }
    }

    // Event listeners
    if (typeof AdminCore !== 'undefined') {
        AdminCore.on('pageChange', ({ page, isFirstVisit }) => {
            if (page === 'dashboard') {
                if (!isInitialized) {
                    init();
                } else {
                    // Reload data when returning to dashboard
                    console.log('Dashboard: Page revisited, reloading data');
                    loadData();
                }
            }
        });
        
        AdminCore.on('refresh', () => {
            if (AdminCore.getCurrentPage() === 'dashboard') {
                DataStore.loadData(true).then(refresh);
            }
        });
        
        AdminCore.on('dataStoreReady', () => {
            if (AdminCore.getCurrentPage() === 'dashboard' && isInitialized) {
                refresh();
            }
        });
        
        // Listen for platform changes
        AdminCore.on('platformChange', ({ platform }) => {
            if (AdminCore.getCurrentPage() === 'dashboard' && isInitialized) {
                console.log('Dashboard: Platform changed to', platform);
                loadData();
            }
        });
    }

    // Initial load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!isInitialized && (window.location.hash === '#dashboard' || window.location.hash === '')) {
                init();
            }
        });
    } else {
        if (!isInitialized && (window.location.hash === '#dashboard' || window.location.hash === '')) {
            init();
        }
    }

    return { init, refresh, loadData };
})();
