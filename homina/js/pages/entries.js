/**
 * POP-SORTE Admin Dashboard - Entries Page Module
 * 
 * This module renders the entries management page with:
 * - Validation status banner
 * - Statistics row (Valid/Invalid/Day2Valid/Total)
 * - Full entries table with filters
 * - Pagination (25/50/100 per page)
 * - CSV export
 * - Ticket details modal
 * 
 * Dependencies: AdminCore, DataFetcher, DataStore, RechargeValidator
 */

window.EntriesPage = (function() {
    'use strict';

    // ============================================
    // State
    // ============================================
    let isInitialized = false;
    let currentData = {
        entries: [],
        recharges: [],
        validationResults: null
    };
    let filteredEntries = [];
    let currentPage = 1;
    let perPage = 25;
    let filters = {
        gameId: '',
        whatsapp: '',
        contest: '',
        drawDate: '',
        validity: 'all',
        day2: 'all'
    };
    let cachedValidationMap = null;
    let isFiltering = false;

    // ============================================
    // HTML Templates
    // ============================================
    
    function getTemplate() {
        return `
            <div class="entries-content">
                <!-- Validation Status Banner -->
                <div id="validationBanner" class="status-banner info">
                    <span class="status-banner-icon">ℹ️</span>
                    <span class="status-banner-text">Loading validation data...</span>
                </div>

                <!-- Statistics -->
                <div class="stats-grid mb-4" id="entriesStats">
                    <div class="stat-card success">
                        <span class="stat-label" title="Entries with valid recharge match">✓ Valid</span>
                        <span class="stat-value" id="statValid">--</span>
                    </div>
                    <div class="stat-card danger">
                        <span class="stat-label" title="No recharge found, or timing mismatch">✗ Invalid</span>
                        <span class="stat-value" id="statInvalid">--</span>
                    </div>
                    <div class="stat-card warning">
                        <span class="stat-label" title="Valid tickets using Day 2 eligibility">⚠️ Day 2 Valid</span>
                        <span class="stat-value" id="statDay2Valid">--</span>
                    </div>
                    <div class="stat-card primary">
                        <span class="stat-label" title="Total recharge transactions">📊 Total Recharges</span>
                        <span class="stat-value" id="statRecharges">--</span>
                    </div>
                </div>

                <!-- Filters -->
                <div class="filters-row">
                    <div class="filter-group">
                        <label>Game ID</label>
                        <input type="text" id="filterGameId" placeholder="Search ID...">
                    </div>
                    <div class="filter-group">
                        <label>WhatsApp</label>
                        <input type="text" id="filterWhatsapp" placeholder="Search WhatsApp...">
                    </div>
                    <div class="filter-group">
                        <label>Contest</label>
                        <select id="filterContest">
                            <option value="">All</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Draw Date</label>
                        <select id="filterDrawDate">
                            <option value="">All</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Validity</label>
                        <select id="filterValidity">
                            <option value="all">All</option>
                            <option value="valid">Valid</option>
                            <option value="invalid">Invalid</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Eligibility</label>
                        <select id="filterDay2">
                            <option value="all">All</option>
                            <option value="day1">Day 1 Only</option>
                            <option value="day2">Day 2 Only</option>
                        </select>
                    </div>
                    <div class="filter-actions">
                        <button id="btnClearFilters" class="btn btn-secondary btn-sm">Clear</button>
                        <button id="btnExportCSV" class="btn btn-primary btn-sm">📥 Export CSV</button>
                    </div>
                </div>

                <!-- Entries Table -->
                <div class="card">
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Date/Time</th>
                                    <th>Platform</th>
                                    <th>Game ID</th>
                                    <th>WhatsApp</th>
                                    <th>Numbers</th>
                                    <th>Draw</th>
                                    <th>Contest</th>
                                    <th>Ticket #</th>
                                    <th>Recharge</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="entriesTableBody">
                                <tr><td colspan="11" class="text-center text-muted">Loading entries...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination -->
                    <div class="pagination">
                        <div class="pagination-info" id="paginationInfo">
                            Showing 0-0 of 0 entries
                        </div>
                        <div class="pagination-controls">
                            <select id="perPageSelect" class="pagination-btn">
                                <option value="25">25</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                            </select>
                            <button id="btnPrevPage" class="pagination-btn" disabled>← Previous</button>
                            <span id="pageNumbers"></span>
                            <button id="btnNextPage" class="pagination-btn">Next →</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // Validation Map Helpers
    // ============================================
    
    function buildValidationMap() {
        if (cachedValidationMap && currentData.validationResults) {
            return cachedValidationMap;
        }
        
        const map = new Map();
        if (!currentData.validationResults) {
            cachedValidationMap = map;
            return map;
        }
        
        currentData.validationResults.results.forEach(v => {
            const ticketNumber = v.ticket?.ticketNumber;
            if (ticketNumber) {
                map.set(ticketNumber, v);
            }
        });
        
        cachedValidationMap = map;
        return map;
    }
    
    function clearValidationMapCache() {
        cachedValidationMap = null;
    }
    
    function findValidationForEntry(entry, validationMap) {
        if (!validationMap || !entry.ticketNumber) return null;
        return validationMap.get(entry.ticketNumber) || null;
    }

    // ============================================
    // Render Functions
    // ============================================
    
    function renderStats() {
        const { validationResults, recharges } = currentData;
        
        if (validationResults) {
            document.getElementById('statValid').textContent = validationResults.stats.valid.toLocaleString();
            document.getElementById('statInvalid').textContent = validationResults.stats.invalid.toLocaleString();
            document.getElementById('statDay2Valid').textContent = (validationResults.stats.day2Valid || 0).toLocaleString();
        }
        
        document.getElementById('statRecharges').textContent = recharges.length.toLocaleString();
    }

    function renderValidationBanner() {
        const banner = document.getElementById('validationBanner');
        const { validationResults, recharges } = currentData;
        
        if (!banner) return;
        
        if (recharges.length === 0) {
            banner.className = 'status-banner warning';
            banner.innerHTML = `
                <span class="status-banner-icon">⚠️</span>
                <span class="status-banner-text">Recharge data not loaded. Validation may be incomplete.</span>
            `;
        } else if (validationResults) {
            const lastUpdate = AdminCore.formatBrazilDateTime(new Date(), {
                hour: '2-digit',
                minute: '2-digit'
            });
            banner.className = 'status-banner success';
            banner.innerHTML = `
                <span class="status-banner-icon">✅</span>
                <span class="status-banner-text">Validation complete. ${recharges.length} recharges processed. Last update: ${lastUpdate}</span>
            `;
        }
    }

    function renderFilterOptions() {
        const { entries } = currentData;
        
        const contests = [...new Set(entries.map(e => e.contest).filter(Boolean))].sort((a, b) => {
            return parseInt(b, 10) - parseInt(a, 10);
        });
        
        const contestSelect = document.getElementById('filterContest');
        if (contestSelect) {
            contestSelect.innerHTML = '<option value="">All</option>' +
                contests.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        
        const drawDates = [...new Set(entries.map(e => e.drawDate).filter(Boolean))].sort().reverse();
        
        const drawDateSelect = document.getElementById('filterDrawDate');
        if (drawDateSelect) {
            drawDateSelect.innerHTML = '<option value="">All</option>' +
                drawDates.map(d => `<option value="${d}">${d}</option>`).join('');
        }
    }

    // ============================================
    // Filter Functions
    // ============================================
    
    function applyFilters() {
        if (isFiltering) return;
        isFiltering = true;
        
        try {
            let result = [...currentData.entries];
            const validationMap = buildValidationMap();
            
            if (filters.gameId) {
                const term = filters.gameId.toLowerCase();
                result = result.filter(e => e.gameId.toLowerCase().includes(term));
            }
            
            if (filters.whatsapp) {
                const term = filters.whatsapp.toLowerCase();
                result = result.filter(e => (e.whatsapp || '').toLowerCase().includes(term));
            }
            
            if (filters.contest) {
                result = result.filter(e => e.contest === filters.contest);
            }
            
            if (filters.drawDate) {
                result = result.filter(e => e.drawDate === filters.drawDate);
            }
            
            if (filters.validity !== 'all') {
                result = result.filter(e => {
                    const validation = findValidationForEntry(e, validationMap);
                    const status = validation?.status || 'UNKNOWN';
                    
                    switch (filters.validity) {
                        case 'valid': return status === 'VALID';
                        case 'invalid': return status === 'INVALID';
                        default: return true;
                    }
                });
            }
            
            if (filters.day2 !== 'all') {
                result = result.filter(e => {
                    const validation = findValidationForEntry(e, validationMap);
                    const status = validation?.status || 'UNKNOWN';
                    const isDay2 = validation?.isDay2 || false;
                    
                    // Only filter valid tickets by day2
                    if (status !== 'VALID') return false;
                    
                    switch (filters.day2) {
                        case 'day1': return !isDay2;
                        case 'day2': return isDay2;
                        default: return true;
                    }
                });
            }
            
            filteredEntries = result;
            currentPage = 1;
            renderTable();
            renderPagination();
        } finally {
            isFiltering = false;
        }
    }

    function clearFilters() {
        filters = {
            gameId: '',
            whatsapp: '',
            contest: '',
            drawDate: '',
            validity: 'all',
            day2: 'all'
        };
        
        document.getElementById('filterGameId').value = '';
        document.getElementById('filterWhatsapp').value = '';
        document.getElementById('filterContest').value = '';
        document.getElementById('filterDrawDate').value = '';
        document.getElementById('filterValidity').value = 'all';
        document.getElementById('filterDay2').value = 'all';
        
        applyFilters();
    }

    // ============================================
    // Table Rendering
    // ============================================
    
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
    
    function renderTable() {
        const tbody = document.getElementById('entriesTableBody');
        if (!tbody) return;
        
        const validationMap = buildValidationMap();
        
        const start = (currentPage - 1) * perPage;
        const end = start + perPage;
        const pageEntries = filteredEntries.slice(start, end);
        
        if (pageEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">No entries found</td></tr>';
            return;
        }
        
        tbody.innerHTML = pageEntries.map(entry => {
            const validation = findValidationForEntry(entry, validationMap);
            const status = validation?.status || 'UNKNOWN';
            const isDay2 = validation?.isDay2 || false;
            
            const reason = validation?.reason || '';
            let statusBadge = '';
            switch (status) {
                case 'VALID':
                    statusBadge = `<span class="badge badge-success" title="${reason}">✅ VALID</span>`;
                    // Add Day 2 badge for valid tickets using Day 2 eligibility
                    if (isDay2) {
                        statusBadge += ' <span class="badge badge-warning" title="Used Day 2 eligibility">⚠️ DAY 2</span>';
                    }
                    break;
                case 'INVALID':
                    statusBadge = `<span class="badge badge-danger" title="${reason}">❌ INVALID</span>`;
                    break;
                default:
                    statusBadge = '<span class="badge badge-warning" title="Validation pending">⏳ PENDING</span>';
            }
            
            const numbersHtml = entry.numbers.map(n => {
                const colorClass = AdminCore.getBallColorClass(n);
                return `<span class="number-badge ${colorClass}" style="width: 24px; height: 24px; font-size: 0.6rem;">${String(n).padStart(2, '0')}</span>`;
            }).join('');
            
            const formattedTime = entry.parsedDate
                ? AdminCore.formatBrazilDateTime(entry.parsedDate, {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
                : entry.timestamp;
            
            let rechargeInfo = '-';
            // ONLY show recharge info for VALID status
            if (status === 'VALID' && validation?.matchedRecharge) {
                const r = validation.matchedRecharge;
                const day2Badge = isDay2 ? '<br><span class="badge badge-warning" style="font-size: 0.6rem; padding: 2px 4px;">⚠️ DAY 2</span>' : '';
                const orderNumShort = r.rechargeId ? r.rechargeId.substring(0, 12) + '...' : '-';
                rechargeInfo = `<div style="font-size: 0.7rem; line-height: 1.3;">
                    <strong class="text-success">R$${r.amount?.toFixed(2) || '?'}</strong><br>
                    <span style="color: var(--text-tertiary);" title="${r.rechargeId || ''}">${orderNumShort}</span>${day2Badge}
                </div>`;
            }
            
            const formattedDrawDate = formatDrawDate(entry.drawDate);
            
            return `
                <tr>
                    <td>${statusBadge}</td>
                    <td style="font-size: 0.8rem; white-space: nowrap;">${formattedTime}</td>
                    <td><span class="platform-badge ${(entry.platform || 'POPN1').toLowerCase()}">${entry.platform || 'POPN1'}</span></td>
                    <td><strong>${entry.gameId}</strong></td>
                    <td>${AdminCore.maskWhatsApp(entry.whatsapp)}</td>
                    <td><div class="numbers-display">${numbersHtml}</div></td>
                    <td>${formattedDrawDate}</td>
                    <td>${entry.contest}</td>
                    <td style="font-size: 0.75rem;">${entry.ticketNumber}</td>
                    <td>${rechargeInfo}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="EntriesPage.showDetails('${entry.ticketNumber}')">
                            Details
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderPagination() {
        const total = filteredEntries.length;
        const totalPages = Math.ceil(total / perPage);
        const start = (currentPage - 1) * perPage + 1;
        const end = Math.min(currentPage * perPage, total);
        
        document.getElementById('paginationInfo').textContent = 
            `Showing ${total > 0 ? start : 0}-${end} of ${total} entries`;
        
        document.getElementById('btnPrevPage').disabled = currentPage <= 1;
        document.getElementById('btnNextPage').disabled = currentPage >= totalPages;
        
        const pageNumbers = document.getElementById('pageNumbers');
        if (pageNumbers) {
            let html = '';
            for (let i = 1; i <= Math.min(totalPages, 5); i++) {
                html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
                    onclick="EntriesPage.goToPage(${i})">${i}</button>`;
            }
            if (totalPages > 5) {
                html += `<span class="text-muted">... ${totalPages}</span>`;
            }
            pageNumbers.innerHTML = html;
        }
    }

    // ============================================
    // Modal Functions
    // ============================================
    
    function showDetails(ticketNumber) {
        const entry = currentData.entries.find(e => e.ticketNumber === ticketNumber);
        if (!entry) return;
        
        const validationMap = buildValidationMap();
        const validation = findValidationForEntry(entry, validationMap);
        
        const modalContent = document.getElementById('ticketModalContent');
        if (!modalContent) return;
        
        let statusHtml = '';
        if (validation) {
            const status = validation.status;
            const statusClass = {
                'VALID': 'success',
                'INVALID': 'danger',
                'UNKNOWN': 'warning'
            }[status] || 'warning';
            
            const day2Badge = validation.isDay2 ? '<br><span class="text-warning">⚠️ Used Day 2 eligibility</span>' : '';
            statusHtml = `
                <div class="status-banner ${statusClass} mb-4">
                    <span class="status-banner-icon">${status === 'VALID' ? '✅' : status === 'INVALID' ? '❌' : '⏳'}</span>
                    <span class="status-banner-text">
                        <strong>${status}</strong> - ${validation.reason || 'Checking...'}
                        ${day2Badge}
                    </span>
                </div>
            `;
        }
        
        const numbersHtml = entry.numbers.map(n => {
            const colorClass = AdminCore.getBallColorClass(n);
            return `<span class="number-badge ${colorClass}">${String(n).padStart(2, '0')}</span>`;
        }).join('');
        
        let rechargeHtml = '<p class="text-muted">No linked recharge</p>';
        // ONLY show for VALID status
        if (validation?.status === 'VALID' && validation?.matchedRecharge) {
            const r = validation.matchedRecharge;
            const eligible1Str = r.eligible1 ? AdminCore.formatBrazilDateTime(r.eligible1, {day: '2-digit', month: '2-digit', year: 'numeric'}) : '-';
            const eligible2Str = r.eligible2 ? AdminCore.formatBrazilDateTime(r.eligible2, {day: '2-digit', month: '2-digit', year: 'numeric'}) : '-';
            const dayUsed = validation.isDay2 ? '(Used Day 2)' : '(Used Day 1)';
            const cutoffNote = r.isCutoff ? '<span class="badge badge-warning">⚠️ After 8 PM Cutoff</span>' : '';
            
            rechargeHtml = `
                <div class="ticket-info-grid">
                    <div class="ticket-info-item">
                        <span class="label">Amount</span>
                        <span class="value">R$ ${r.amount?.toFixed(2) || '?'}</span>
                    </div>
                    <div class="ticket-info-item">
                        <span class="label">Recharge ID</span>
                        <span class="value" style="font-size: 0.7rem;">${r.rechargeId || '-'}</span>
                    </div>
                    <div class="ticket-info-item">
                        <span class="label">Recharge Time</span>
                        <span class="value">
                            ${r.rechargeTime ? AdminCore.formatBrazilDateTime(r.rechargeTime, {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '-'}
                            ${cutoffNote}
                        </span>
                    </div>
                    <div class="ticket-info-item">
                        <span class="label">Eligibility Window</span>
                        <span class="value">${eligible1Str} - ${eligible2Str} ${dayUsed}</span>
                    </div>
                </div>
            `;
        }
        
        modalContent.innerHTML = `
            ${statusHtml}
            
            <h4 class="mb-3">Ticket Information</h4>
            <div class="ticket-info-grid mb-4">
                <div class="ticket-info-item">
                    <span class="label">Ticket #</span>
                    <span class="value">${entry.ticketNumber}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Game ID</span>
                    <span class="value">${entry.gameId}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">WhatsApp</span>
                    <span class="value">${entry.whatsapp || '-'}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Platform</span>
                    <span class="value">${entry.platform}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Contest</span>
                    <span class="value">${entry.contest}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Draw Date</span>
                    <span class="value">${entry.drawDate}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Registered</span>
                    <span class="value">${entry.parsedDate ? AdminCore.formatBrazilDateTime(entry.parsedDate) : entry.timestamp}</span>
                </div>
                <div class="ticket-info-item">
                    <span class="label">Original Status</span>
                    <span class="value">${entry.status}</span>
                </div>
            </div>
            
            <h4 class="mb-3">Selected Numbers</h4>
            <div class="numbers-display mb-4">
                ${numbersHtml}
            </div>
            
            <h4 class="mb-3">Linked Recharge</h4>
            ${rechargeHtml}
        `;
        
        AdminCore.openModal('ticketModal');
    }

    // ============================================
    // Export Functions
    // ============================================
    
    function exportCSV() {
        const data = filteredEntries;
        if (data.length === 0) {
            AdminCore.showToast('No data to export', 'warning');
            return;
        }
        
        const headers = [
            'Status', 'Day2', 'Date/Time', 'Platform', 'Game ID', 'WhatsApp',
            'Numbers', 'Draw Date', 'Contest', 'Ticket #', 'Recharge Order', 'Recharge Amount', 'Original Status'
        ];
        
        const validationMap = buildValidationMap();
        
        const rows = data.map(entry => {
            const validation = findValidationForEntry(entry, validationMap);
            const status = validation?.status || 'UNKNOWN';
            const isDay2 = validation?.isDay2 ? 'YES' : 'NO';
            const rechargeOrder = validation?.matchedRecharge?.rechargeId || '-';
            const rechargeAmount = validation?.matchedRecharge?.amount || '-';
            
            return [
                status,
                isDay2,
                entry.timestamp,
                entry.platform,
                entry.gameId,
                entry.whatsapp,
                entry.numbers.join(', '),
                entry.drawDate,
                entry.contest,
                entry.ticketNumber,
                rechargeOrder,
                rechargeAmount,
                entry.status
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });
        
        const csv = [headers.join(','), ...rows].join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `entries_${AdminCore.getBrazilDateString(new Date())}.csv`;
        link.click();
        
        AdminCore.showToast(`${data.length} entries exported`, 'success');
    }

    // ============================================
    // Page Navigation
    // ============================================
    
    function goToPage(page) {
        currentPage = page;
        renderTable();
        renderPagination();
    }

    function nextPage() {
        const totalPages = Math.ceil(filteredEntries.length / perPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
            renderPagination();
        }
    }

    function prevPage() {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
            renderPagination();
        }
    }

    function changePerPage(value) {
        perPage = parseInt(value, 10);
        currentPage = 1;
        renderTable();
        renderPagination();
    }

    // ============================================
    // Data Loading
    // ============================================
    
    async function loadData() {
        try {
            // Use DataStore for cached data
            await DataStore.loadData();
            
            // Get platform-filtered entries
            const platform = AdminCore.getCurrentPlatform();
            const entries = DataStore.getEntries(platform);
            const recharges = DataStore.getRecharges();
            
            // Validate all tickets using RechargeValidator
            const validationResults = await RechargeValidator.validateAllTickets(entries, recharges);
            
            currentData = { entries, recharges, validationResults };
            filteredEntries = [...entries];
            
            clearValidationMapCache();
            
            renderStats();
            renderValidationBanner();
            renderFilterOptions();
            applyFilters();
            
        } catch (error) {
            console.error('Error loading entries data:', error);
            AdminCore.showToast('Error loading entries: ' + error.message, 'error');
        }
    }

    // ============================================
    // Event Handlers
    // ============================================
    
    const debouncedApplyFilters = AdminCore.debounce(applyFilters, 300);
    
    function bindEvents() {
        document.getElementById('filterGameId')?.addEventListener('input', (e) => {
            filters.gameId = e.target.value;
            debouncedApplyFilters();
        });
        
        document.getElementById('filterWhatsapp')?.addEventListener('input', (e) => {
            filters.whatsapp = e.target.value;
            debouncedApplyFilters();
        });
        
        document.getElementById('filterContest')?.addEventListener('change', (e) => {
            filters.contest = e.target.value;
            applyFilters();
        });
        
        document.getElementById('filterDrawDate')?.addEventListener('change', (e) => {
            filters.drawDate = e.target.value;
            applyFilters();
        });
        
        document.getElementById('filterValidity')?.addEventListener('change', (e) => {
            filters.validity = e.target.value;
            applyFilters();
        });
        
        document.getElementById('filterDay2')?.addEventListener('change', (e) => {
            filters.day2 = e.target.value;
            applyFilters();
        });
        
        document.getElementById('btnClearFilters')?.addEventListener('click', clearFilters);
        document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);
        
        document.getElementById('btnPrevPage')?.addEventListener('click', prevPage);
        document.getElementById('btnNextPage')?.addEventListener('click', nextPage);
        document.getElementById('perPageSelect')?.addEventListener('change', (e) => {
            changePerPage(e.target.value);
        });
    }

    // ============================================
    // Initialization
    // ============================================
    
    function init() {
        const container = document.getElementById('page-entries');
        if (!container) return;
        
        container.innerHTML = getTemplate();
        bindEvents();
        loadData();
        
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
            if (page === 'entries') {
                if (!isInitialized) {
                    init();
                } else {
                    // Reload data when returning to entries
                    console.log('Entries: Page revisited, reloading data');
                    loadData();
                }
            }
        });
        
        AdminCore.on('refresh', () => {
            if (AdminCore.getCurrentPage() === 'entries' && isInitialized) {
                refresh();
            }
        });
        
        // Listen for platform changes
        AdminCore.on('platformChange', ({ platform }) => {
            if (AdminCore.getCurrentPage() === 'entries' && isInitialized) {
                console.log('Entries: Platform changed to', platform);
                loadData();
            }
        });
    }

    // ============================================
    // Public API
    // ============================================
    return {
        init,
        refresh,
        loadData,
        showDetails,
        goToPage,
        exportCSV
    };
})();
