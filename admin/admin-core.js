/**
 * POP-SORTE ADMIN CORE
 * Clean, modular admin dashboard
 */

const API_BASE = 'https://popsorte-api.danilla-vargas1923.workers.dev';
const SESSION_KEY = 'popsorte_admin_session';

// ============================================
// RECHARGE VALIDATOR CLASS (Advanced Validation)
// ============================================

const BRT_OFFSET_HOURS = 3;
const BRT_OFFSET_MS = BRT_OFFSET_HOURS * 60 * 60 * 1000;

function brtFields(date) {
  const shifted = new Date(date.getTime() - BRT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function makeDateFromBrt(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month, day, hour + BRT_OFFSET_HOURS, minute, second));
}

function startOfDayBrt(date) {
  const f = brtFields(date);
  return makeDateFromBrt(f.year, f.month, f.day, 0, 0, 0);
}

function addDaysBrt(date, n) {
  const start = startOfDayBrt(date);
  return new Date(start.getTime() + n * 24 * 60 * 60 * 1000);
}

class RechargeValidator {
  constructor() {
    this.recharges = [];
    this.validatedEntries = [];
    this.lastFetchTime = null;

    this.noDrawHolidays = [
      '12-25',
      '01-01'
    ];
  }

  isNoDrawDay(dateObj) {
    const f = brtFields(dateObj);
    if (f.weekday === 0) return true; // Sunday
    const m = String(f.month + 1).padStart(2, '0');
    const d = String(f.day).padStart(2, '0');
    const key = `${m}-${d}`;
    if (this.noDrawHolidays.includes(key)) return true;
    return false;
  }

  getCutoffTime(dateObj) {
    const f = brtFields(dateObj);
    const m = f.month + 1;
    const d = f.day;
    if ((m === 12 && d === 24) || (m === 12 && d === 31)) {
      return { hour: 20, minute: 0, second: 0 };
    }
    return { hour: 20, minute: 0, second: 0 };
  }

  buildCutoffDateTime(dateObj) {
    const f = brtFields(dateObj);
    const { hour, minute, second } = this.getCutoffTime(dateObj);
    return makeDateFromBrt(f.year, f.month, f.day, hour, minute, second);
  }

  firstDrawDayAfter(timeObj) {
    let probe = startOfDayBrt(timeObj);
    for (let i = 0; i < 60; i++) {
      if (!this.isNoDrawDay(probe)) {
        const cutoff = this.buildCutoffDateTime(probe);
        if (cutoff > timeObj) {
          return probe;
        }
      }
      probe = addDaysBrt(probe, 1);
    }
    return null;
  }

  ticketDrawDay(ticketTime) {
    let probe = startOfDayBrt(ticketTime);
    for (let i = 0; i < 60; i++) {
      if (!this.isNoDrawDay(probe)) {
        const cutoff = this.buildCutoffDateTime(probe);
        if (cutoff >= ticketTime) {
          return probe;
        }
      }
      probe = addDaysBrt(probe, 1);
    }
    return null;
  }

  computeEligibleDraws(rechargeTimeObj) {
    if (!rechargeTimeObj) return { eligible1: null, eligible2: null };

    let eligible1Day = startOfDayBrt(rechargeTimeObj);
    for (let i = 0; i < 60 && this.isNoDrawDay(eligible1Day); i++) {
      eligible1Day = addDaysBrt(eligible1Day, 1);
    }
    const eligible1Cutoff = this.buildCutoffDateTime(eligible1Day);

    let eligible2Day = addDaysBrt(eligible1Day, 1);
    for (let i = 0; i < 60 && this.isNoDrawDay(eligible2Day); i++) {
      eligible2Day = addDaysBrt(eligible2Day, 1);
    }

    return {
      eligible1: eligible1Cutoff > rechargeTimeObj ? eligible1Day : null,
      eligible2: eligible2Day
    };
  }

  parseRechargeCSV(csvText) {
    const lines = csvText.split('\n').filter(Boolean);
    this.recharges = [];
    
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      
      const recharge = {
        timestamp: this.parseBrazilTime(cols[0]),
        gameId: cols[1].trim(),
        whatsapp: cols[2].trim(),
        amount: parseFloat(cols[3]) || 0,
        status: cols[4].trim()
      };
      
      if (recharge.timestamp && recharge.gameId) {
        this.recharges.push(recharge);
      }
    }
  }

  parseBrazilTime(timeString) {
    try {
      const date = new Date(timeString);
      if (isNaN(date.getTime())) return null;
      return date;
    } catch (e) {
      return null;
    }
  }

  validateEntries(entries) {
    this.validatedEntries = entries.map(entry => {
      const recharge = this.recharges.find(r => r.gameId === entry.gameId);
      if (!recharge) {
        return { ...entry, validity: false, reason: 'No recharge found', bound: null, cutoffFlag: false };
      }
      
      const ticketTime = new Date(entry.registrationDateTime);
      if (!ticketTime || isNaN(ticketTime.getTime())) {
        return { ...entry, validity: false, reason: 'Invalid ticket time', bound: null, cutoffFlag: false };
      }
      
      const eligible = this.computeEligibleDraws(recharge.timestamp);
      const ticketDraw = this.ticketDrawDay(ticketTime);
      
      if (!ticketDraw) {
        return { ...entry, validity: false, reason: 'No valid draw day', bound: null, cutoffFlag: false };
      }
      
      const isEligible1 = eligible.eligible1 && ticketDraw.getTime() === eligible.eligible1.getTime();
      const isEligible2 = eligible.eligible2 && ticketDraw.getTime() === eligible.eligible2.getTime();
      
      if (isEligible1 || isEligible2) {
        return { ...entry, validity: true, reason: 'Valid', bound: isEligible1 ? 1 : 2, cutoffFlag: false };
      }
      
      return { ...entry, validity: false, reason: 'Draw day not eligible', bound: null, cutoffFlag: false };
    });
    
    return this.validatedEntries;
  }

  getValidatedEntries() {
    return this.validatedEntries;
  }

  getValidEntries() {
    return this.validatedEntries.filter(e => e.validity);
  }

  getInvalidEntries() {
    return this.validatedEntries.filter(e => !e.validity);
  }

  getStatistics() {
    const valid = this.getValidEntries();
    const invalid = this.getInvalidEntries();
    return {
      totalValidated: this.validatedEntries.length,
      valid: valid.length,
      invalid: invalid.length,
      validRate: this.validatedEntries.length > 0 ? (valid.length / this.validatedEntries.length * 100).toFixed(2) : '0'
    };
  }
}

// Global validator instance
const rechargeValidator = new RechargeValidator();

// Global state
let entries = [];
let results = [];
let recharges = [];
let authToken = null;

/**
 * AUTHENTICATION
 */
function getSession() {
    try {
        const session = localStorage.getItem(SESSION_KEY);
        if (!session) return null;
        
        const data = JSON.parse(session);
        if (Date.now() >= data.expiresAt) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('Session error:', err);
        return null;
    }
}

function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = '/admin/login.html';
}

function checkAuth() {
    const session = getSession();
    if (!session) {
        window.location.href = '/admin/login.html';
        return false;
    }
    
    authToken = session.token;
    document.getElementById('accountInfo').textContent = session.account || 'Admin';
    return true;
}

/**
 * API CALLS
 */
async function apiCall(endpoint, options = {}) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            showAlert('Session expired. Please login again.', 'error');
            setTimeout(() => logout(), 2000);
            throw new Error('Unauthorized');
        }
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`API Error (${response.status}):`, text);
            throw new Error(`API Error: ${response.status} - ${text.substring(0, 100)}`);
        }
        
        return response;
    } catch (err) {
        console.error('API call failed:', err);
        throw err;
    }
}

/**
 * DATA FETCHING
 */
async function fetchEntries() {
    try {
        console.log('Fetching entries...');
        const response = await apiCall('/api/admin/entries');
        const csv = await response.text();
        
        entries = parseCSV(csv, [
            'registrationDateTime',
            'platform',
            'gameId',
            'whatsapp',
            'chosenNumbers',
            'drawDate',
            'contest',
            'ticketNumber',
            'status'
        ]);
        
        console.log(`✅ Fetched ${entries.length} entries`);
        return entries;
    } catch (err) {
        console.error('❌ Fetch entries failed:', err);
        showAlert(`Failed to fetch entries: ${err.message}`, 'error');
        return [];
    }
}

async function fetchResults() {
    try {
        console.log('Fetching results...');
        const response = await apiCall('/api/admin/results');
        const csv = await response.text();
        
        results = parseCSV(csv, [
            'contest',
            'drawDate',
            'winningNumbers',
            'savedAt'
        ]);
        
        console.log(`✅ Fetched ${results.length} results`);
        return results;
    } catch (err) {
        console.error('❌ Fetch results failed:', err);
        showAlert(`Failed to fetch results: ${err.message}`, 'error');
        return [];
    }
}

async function fetchRecharges() {
    try {
        console.log('Fetching recharges...');
        const response = await apiCall('/api/admin/recharge');
        const csv = await response.text();
        
        rechargeValidator.parseRechargeCSV(csv);
        recharges = rechargeValidator.recharges;
        
        console.log(`✅ Fetched ${recharges.length} recharges`);
        return recharges;
    } catch (err) {
        console.error('❌ Fetch recharges failed:', err);
        // Don't show alert for recharges, it's optional
        return [];
    }
}

/**
 * CSV PARSER
 */
function parseCSV(csvText, columns) {
    const lines = csvText.trim().split('\n');
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        if (values.length < columns.length) continue;
        
        const row = {};
        columns.forEach((col, idx) => {
            row[col] = values[idx] || '';
        });
        
        data.push(row);
    }
    
    return data;
}

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    
    values.push(current.trim().replace(/^"|"$/g, ''));
    return values;
}

/**
 * UI HELPERS
 */
function showAlert(message, type = 'info') {
    const container = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    container.innerHTML = '';
    container.appendChild(alert);
    
    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    }, 5000);
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    // Load tab data
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'entries':
            renderEntries();
            break;
        case 'results':
            renderResults();
            break;
        case 'winners':
            renderWinners();
            break;
    }
}

/**
 * RENDER FUNCTIONS
 */
function renderDashboard() {
    const validEntries = rechargeValidator.getValidEntries();
    const invalidEntries = rechargeValidator.getInvalidEntries();
    const stats = rechargeValidator.getStatistics();
    
    document.getElementById('totalTickets').textContent = validEntries.length;
    document.getElementById('invalidTickets').textContent = invalidEntries.length;
    
    const contests = [...new Set(validEntries.map(e => e.contest))];
    document.getElementById('totalContests').textContent = contests.length;
    
    const pending = validEntries.filter(e => e.status?.toUpperCase() === 'PENDENTE').length;
    document.getElementById('pendingTickets').textContent = pending;
    
    document.getElementById('validationRate').textContent = `${stats.validRate}%`;
    
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('pt-BR');
    
    // Recent activity (show valid entries)
    const recent = validEntries.slice(-10).reverse();
    const activityHtml = recent.length > 0 ? `
        <table>
            <thead>
                <tr>
                    <th>Game ID</th>
                    <th>WhatsApp</th>
                    <th>Contest</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Validity</th>
                </tr>
            </thead>
            <tbody>
                ${recent.map(e => `
                    <tr>
                        <td><strong>${e.gameId}</strong></td>
                        <td>${e.whatsapp}</td>
                        <td><span class="badge badge-info">${e.contest}</span></td>
                        <td>${e.drawDate}</td>
                        <td><span class="badge ${e.status === 'VALIDADO' ? 'badge-success' : 'badge-warning'}">${e.status}</span></td>
                        <td><span class="badge ${e.validity ? 'badge-success' : 'badge-danger'}">${e.validity ? 'Valid' : 'Invalid'}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<div class="empty-state">No recent activity</div>';
    
    document.getElementById('recentActivity').innerHTML = activityHtml;
}

function renderEntries() {
    const container = document.getElementById('entriesTable');
    const validatedEntries = rechargeValidator.getValidatedEntries();
    
    if (validatedEntries.length === 0) {
        container.innerHTML = '<div class="empty-state">No entries found</div>';
        return;
    }
    
    // Populate filter
    const contests = [...new Set(validatedEntries.map(e => e.contest))];
    const contestFilter = document.getElementById('filterContest');
    contestFilter.innerHTML = '<option value="">All Contests</option>' + 
        contests.map(c => `<option value="${c}">${c}</option>`).join('');
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Game ID</th>
                    <th>WhatsApp</th>
                    <th>Numbers</th>
                    <th>Contest</th>
                    <th>Draw Date</th>
                    <th>Ticket #</th>
                    <th>Status</th>
                    <th>Validity</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>
                ${validatedEntries.map(e => `
                    <tr>
                        <td><strong>${e.gameId}</strong></td>
                        <td>${e.whatsapp}</td>
                        <td>${e.chosenNumbers}</td>
                        <td><span class="badge badge-info">${e.contest}</span></td>
                        <td>${e.drawDate}</td>
                        <td>${e.ticketNumber}</td>
                        <td><span class="badge ${e.status === 'VALIDADO' ? 'badge-success' : 'badge-warning'}">${e.status}</span></td>
                        <td><span class="badge ${e.validity ? 'badge-success' : 'badge-danger'}">${e.validity ? 'Valid' : 'Invalid'}</span></td>
                        <td>${e.reason || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

function renderResults() {
    const container = document.getElementById('resultsTable');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="empty-state">No results found</div>';
        return;
    }
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Contest</th>
                    <th>Draw Date</th>
                    <th>Winning Numbers</th>
                    <th>Saved At</th>
                </tr>
            </thead>
            <tbody>
                ${results.map(r => `
                    <tr>
                        <td><span class="badge badge-info">${r.contest}</span></td>
                        <td>${r.drawDate}</td>
                        <td><strong style="font-size: 18px; color: #667eea;">${r.winningNumbers}</strong></td>
                        <td>${new Date(r.savedAt).toLocaleString('pt-BR')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

function renderWinners() {
    const container = document.getElementById('winnersTable');
    const validEntries = rechargeValidator.getValidEntries();
    
    if (results.length === 0 || validEntries.length === 0) {
        container.innerHTML = '<div class="empty-state">No data to calculate winners</div>';
        return;
    }
    
    // Calculate winners from valid entries only
    const winners = [];
    
    validEntries.forEach(entry => {
        const result = results.find(r => 
            r.contest === entry.contest && 
            r.drawDate === entry.drawDate
        );
        
        if (!result) return;
        
        const chosenNums = entry.chosenNumbers.split(',').map(n => parseInt(n.trim()));
        const winningNums = result.winningNumbers.split(',').map(n => parseInt(n.trim()));
        
        const matches = chosenNums.filter(n => winningNums.includes(n));
        
        if (matches.length >= 2) {
            winners.push({
                ...entry,
                matches: matches.length,
                matchedNumbers: matches,
                winningNumbers: winningNums
            });
        }
    });
    
    if (winners.length === 0) {
        container.innerHTML = '<div class="empty-state">No winners yet</div>';
        return;
    }
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Matches</th>
                    <th>Game ID</th>
                    <th>WhatsApp</th>
                    <th>Chosen Numbers</th>
                    <th>Matched</th>
                    <th>Contest</th>
                </tr>
            </thead>
            <tbody>
                ${winners.map(w => `
                    <tr>
                        <td><strong style="font-size: 24px; color: ${w.matches === 5 ? '#10b981' : w.matches === 4 ? '#3b82f6' : '#f59e0b'};">${w.matches}</strong></td>
                        <td><strong>${w.gameId}</strong></td>
                        <td>${w.whatsapp}</td>
                        <td>${w.chosenNumbers}</td>
                        <td><strong style="color: #10b981;">${w.matchedNumbers.join(', ')}</strong></td>
                        <td><span class="badge badge-info">${w.contest}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

/**
 * FILTERS
 */
function applyFilters() {
    const gameId = document.getElementById('filterGameId').value.toLowerCase();
    const whatsapp = document.getElementById('filterWhatsApp').value.toLowerCase();
    const contest = document.getElementById('filterContest').value;
    
    let filtered = entries;
    
    if (gameId) {
        filtered = filtered.filter(e => e.gameId.toLowerCase().includes(gameId));
    }
    
    if (whatsapp) {
        filtered = filtered.filter(e => e.whatsapp.toLowerCase().includes(whatsapp));
    }
    
    if (contest) {
        filtered = filtered.filter(e => e.contest === contest);
    }
    
    // Temporarily replace entries for rendering
    const originalEntries = entries;
    entries = filtered;
    renderEntries();
    entries = originalEntries;
    
    showAlert(`Found ${filtered.length} entries`, 'info');
}

function clearFilters() {
    document.getElementById('filterGameId').value = '';
    document.getElementById('filterWhatsApp').value = '';
    document.getElementById('filterContest').value = '';
    renderEntries();
}

async function refreshData() {
    showAlert('Refreshing data...', 'info');
    
    try {
        await Promise.all([
            fetchEntries(),
            fetchResults(),
            fetchRecharges()
        ]);
        
        // Validate entries based on recharge rules
        rechargeValidator.validateEntries(entries);
        
        loadTabData(document.querySelector('.tab.active').textContent.split(' ')[1].toLowerCase());
        showAlert('Data refreshed successfully!', 'success');
    } catch (err) {
        console.error('Refresh failed:', err);
        showAlert('Failed to refresh data', 'error');
    }
}

/**
 * INIT
 */
async function init() {
    if (!checkAuth()) return;
    
    console.log('🚀 Initializing admin dashboard...');
    
    try {
        await Promise.all([
            fetchEntries(),
            fetchResults(),
            fetchRecharges()
        ]);
        
        // Validate entries based on recharge rules
        rechargeValidator.validateEntries(entries);
        
        renderDashboard();
        showAlert('Dashboard loaded successfully!', 'success');
    } catch (err) {
        console.error('❌ Initialization failed:', err);
        showAlert('Failed to load dashboard data. Check console for details.', 'error');
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
