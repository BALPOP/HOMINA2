/**
 * POP-SORTE Admin Dashboard - Core Module
 * 
 * This module provides:
 * - Scroll-based navigation for unified single-page layout
 * - Session management with 12-hour TTL
 * - Shared utility functions (BRT timezone, CSV parsing)
 * - Auto-refresh mechanism (3 minutes)
 * - Event bus for inter-module communication
 * - Toast notification system
 * - Platform switching (ALL, POPN1, POPLUZ)
 */

// ============================================
// Global Admin Namespace
// ============================================
window.AdminCore = (function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const SESSION_KEY = 'popsorte_admin_session';
    const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    const REFRESH_INTERVAL = 180 * 1000; // 3 minutes
    const VALID_SECTIONS = ['dashboard', 'entries', 'results', 'winners'];
    const DEFAULT_SECTION = 'dashboard';
    
    /**
     * Available platforms - detected from entries data
     * 'ALL' shows combined data with platform breakdown
     */
    const PLATFORMS = ['ALL', 'POPN1', 'POPLUZ'];
    const DEFAULT_PLATFORM = 'ALL';
    
    /**
     * Platform-specific prize pools (R$)
     * Can be configured per platform
     */
    const PLATFORM_PRIZES = {
        'POPN1': 1000,
        'POPLUZ': 1000,
        'DEFAULT': 1000
    };

    // ============================================
    // State
    // ============================================
    let currentSection = null;
    let currentPlatform = DEFAULT_PLATFORM;
    let refreshTimer = null;
    let isRefreshing = false;
    let isPageLoading = false;
    const eventListeners = {};

    // ============================================
    // Event Bus
    // ============================================
    
    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    function on(event, callback) {
        if (!eventListeners[event]) {
            eventListeners[event] = [];
        }
        eventListeners[event].push(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     */
    function off(event, callback) {
        if (!eventListeners[event]) return;
        eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Data to pass to callbacks
     */
    function emit(event, data) {
        if (!eventListeners[event]) return;
        eventListeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }

    // ============================================
    // Brazil Timezone Utilities
    // ============================================
    
    // Cached DateTimeFormat for getBrazilTime (performance optimization)
    const brazilTimeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    /**
     * Get current time in Brazil timezone (BRT)
     * @returns {Date} Date object representing current Brazil time
     */
    function getBrazilTime() {
        const now = new Date();
        const parts = brazilTimeFormatter.formatToParts(now);
        const year = parts.find(p => p.type === 'year').value;
        const month = parts.find(p => p.type === 'month').value;
        const day = parts.find(p => p.type === 'day').value;
        const hour = parts.find(p => p.type === 'hour').value;
        const minute = parts.find(p => p.type === 'minute').value;
        const second = parts.find(p => p.type === 'second').value;
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
    }

    /**
     * Format date/time in Brazil timezone
     * @param {Date} date - Date to format
     * @param {Object} options - Intl.DateTimeFormat options
     * @returns {string} Formatted date string
     */
    function formatBrazilDateTime(date, options = {}) {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
            return '—';
        }
        return date.toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            ...options
        });
    }

    // Cached DateTimeFormat for Brazil date string (performance optimization)
    const brazilDateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    /**
     * Get date string in YYYY-MM-DD format for Brazil timezone
     * @param {Date} date - Date to format
     * @returns {string} Date string in YYYY-MM-DD format, or empty string if invalid
     */
    function getBrazilDateString(date) {
        // Validate date before formatting to prevent RangeError
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
            return '';
        }
        
        try {
            const parts = brazilDateFormatter.formatToParts(date);
            const year = parts.find(p => p.type === 'year').value;
            const month = parts.find(p => p.type === 'month').value;
            const day = parts.find(p => p.type === 'day').value;
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.warn('getBrazilDateString: Invalid date provided', error);
            return '';
        }
    }

    /**
     * Parse Brazilian date/time string to Date object
     * @param {string} str - Date string in format "DD/MM/YYYY HH:MM:SS"
     * @returns {Date|null} Parsed date or null if invalid
     */
    function parseBrazilDateTime(str) {
        if (!str) return null;
        try {
            const [datePart, timePart = '00:00:00'] = str.trim().split(' ');
            const [d, m, y] = datePart.split(/[\/\-]/).map(Number);
            const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
            if (!d || !m || !y) return null;
            // Create date in BRT (UTC-3)
            return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, ss));
        } catch {
            return null;
        }
    }

    // ============================================
    // CSV Parsing Utilities
    // ============================================
    
    /**
     * Detect the delimiter used in a CSV header line
     * @param {string} headerLine - First line of CSV
     * @returns {string} Detected delimiter
     */
    function detectDelimiter(headerLine) {
        const counts = {
            ',': (headerLine.match(/,/g) || []).length,
            ';': (headerLine.match(/;/g) || []).length,
            '\t': (headerLine.match(/\t/g) || []).length,
            '|': (headerLine.match(/\|/g) || []).length,
        };
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
    }

    /**
     * Parse a single CSV line respecting quoted fields
     * @param {string} line - CSV line to parse
     * @param {string} delimiter - Field delimiter
     * @returns {string[]} Array of field values
     */
    function parseCSVLine(line, delimiter = ',') {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === delimiter && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        values.push(current.trim());
        return values;
    }

    /**
     * Parse complete CSV text to array of objects
     * @param {string} csvText - Raw CSV text
     * @returns {Object[]} Array of row objects with header keys
     */
    function parseCSV(csvText) {
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return [];

        const delimiter = detectDelimiter(lines[0]);
        const headers = parseCSVLine(lines[0], delimiter);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i], delimiter);
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            rows.push(row);
        }

        return rows;
    }

    // ============================================
    // WhatsApp Masking
    // ============================================
    
    /**
     * Mask WhatsApp number showing only last 4 digits
     * @param {string} number - Full phone number
     * @returns {string} Masked number
     */
    function maskWhatsApp(number) {
        if (!number) return '****';
        const digits = number.replace(/\D/g, '');
        if (digits.length < 4) return '****';
        return '***' + digits.slice(-4);
    }

    // ============================================
    // Number Ball Color Utility
    // ============================================
    
    /**
     * Get CSS class for lottery ball color based on number
     * @param {number} num - Lottery number
     * @returns {string} CSS class name
     */
    function getBallColorClass(num) {
        return `ball-color-${num % 10}`;
    }

    // ============================================
    // Toast Notifications
    // ============================================
    
    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: 'default', 'success', 'error', 'warning'
     * @param {number} duration - Duration in ms (default 3000)
     */
    function showToast(message, type = 'default', duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.className = 'toast show';
        
        if (type !== 'default') {
            toast.classList.add(type);
        }

        setTimeout(() => {
            toast.className = 'toast';
        }, duration);
    }

    /**
     * Hide toast notification immediately
     */
    function hideToast() {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.className = 'toast';
        }
    }

    // ============================================
    // Loading Overlay
    // ============================================
    
    /**
     * Show loading overlay
     * @param {string} text - Loading message
     */
    function showLoading(text = 'Loading data...') {
        isPageLoading = true;
        const overlay = document.getElementById('loadingOverlay');
        const textEl = document.getElementById('loadingText');
        const progressEl = document.getElementById('loadingProgress');
        
        if (overlay) {
            overlay.classList.remove('hidden');
            if (textEl) textEl.textContent = text;
            if (progressEl) progressEl.style.width = '0%';
        }
    }

    /**
     * Update loading progress
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} text - Optional new text
     */
    function updateLoadingProgress(percent, text) {
        const progressEl = document.getElementById('loadingProgress');
        const textEl = document.getElementById('loadingText');
        
        if (progressEl) {
            progressEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        }
        if (text && textEl) {
            textEl.textContent = text;
        }
    }

    /**
     * Hide loading overlay
     */
    function hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
        isPageLoading = false;
    }

    /**
     * Set page loading state (blocks auto-refresh)
     * @param {boolean} loading - Whether page is loading
     */
    function setPageLoading(loading) {
        isPageLoading = loading;
    }

    // ============================================
    // Performance Utilities
    // ============================================
    
    /**
     * Debounce function - delays execution until after wait ms have elapsed
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    function debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle function - limits execution to once per wait ms
     * @param {Function} func - Function to throttle
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Throttled function
     */
    function throttle(func, wait = 100) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, wait);
            }
        };
    }

    /**
     * Request idle callback with fallback for Safari
     * @param {Function} callback - Function to execute during idle time
     */
    function requestIdleExecution(callback) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 2000 });
        } else {
            setTimeout(callback, 1);
        }
    }

    // ============================================
    // Session Management
    // ============================================
    
    /**
     * Get current session from sessionStorage
     * @returns {Object|null} Session object or null if expired/invalid
     */
    function getSession() {
        try {
            const sessionData = sessionStorage.getItem(SESSION_KEY);
            if (!sessionData) return null;

            const session = JSON.parse(sessionData);
            const now = Date.now();

            // Check if session has expired
            if (session.expiresAt && now > session.expiresAt) {
                clearSession();
                return null;
            }

            return session;
        } catch {
            clearSession();
            return null;
        }
    }

    /**
     * Create a new session
     * @param {string} username - Authenticated username
     * @returns {Object} Created session object
     */
    function createSession(username) {
        const session = {
            username,
            createdAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return session;
    }

    /**
     * Clear current session
     */
    function clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    /**
     * Check if user is authenticated
     * @returns {boolean} True if valid session exists
     */
    function isAuthenticated() {
        return getSession() !== null;
    }

    // ============================================
    // Platform Management
    // ============================================
    
    /**
     * Get current platform
     * @returns {string} Current platform code
     */
    function getCurrentPlatform() {
        return currentPlatform;
    }

    /**
     * Set current platform and emit change event
     * @param {string} platform - Platform code (ALL, POPN1, POPLUZ)
     */
    function setCurrentPlatform(platform) {
        if (!PLATFORMS.includes(platform)) {
            platform = DEFAULT_PLATFORM;
        }
        
        if (platform === currentPlatform) return;
        
        currentPlatform = platform;
        
        // Update platform switcher UI
        updatePlatformSwitcherUI();
        
        // Emit platform change event
        emit('platformChange', { platform });
        
        console.log('Platform changed to:', platform);
    }

    /**
     * Get prize pool for a specific platform
     * @param {string} platform - Platform code
     * @returns {number} Prize pool amount in R$
     */
    function getPlatformPrize(platform) {
        return PLATFORM_PRIZES[platform] || PLATFORM_PRIZES.DEFAULT;
    }

    /**
     * Update platform switcher button states
     */
    function updatePlatformSwitcherUI() {
        document.querySelectorAll('.platform-btn').forEach(btn => {
            const isActive = btn.dataset.platform === currentPlatform;
            btn.classList.toggle('active', isActive);
        });
        
        // Update platform indicator in title
        const platformIndicator = document.getElementById('platformIndicator');
        if (platformIndicator) {
            platformIndicator.textContent = currentPlatform === 'ALL' ? '' : `[${currentPlatform}]`;
        }
    }

    /**
     * Initialize platform switcher
     */
    function initPlatformSwitcher() {
        const buttons = document.querySelectorAll('.platform-btn');
        console.log('Initializing platform switcher, found', buttons.length, 'buttons');
        
        buttons.forEach(btn => {
            const platform = btn.dataset.platform;
            if (!platform) {
                console.warn('Platform button missing data-platform attribute');
                return;
            }
            
            // Remove any existing listeners by cloning
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            // Add click handler
            newBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Platform button clicked:', this.dataset.platform);
                setCurrentPlatform(this.dataset.platform);
            }, false);
            
            // Also handle mousedown for immediate feedback
            newBtn.addEventListener('mousedown', function(e) {
                e.stopPropagation();
            }, false);
        });
        
        updatePlatformSwitcherUI();
        console.log('Platform switcher initialized, current platform:', currentPlatform);
    }

    // ============================================
    // Scroll Navigation
    // ============================================
    
    /**
     * Scroll to a section smoothly
     * @param {string} section - Section name (dashboard, entries, results, winners)
     */
    function scrollToSection(section) {
        if (!VALID_SECTIONS.includes(section)) {
            section = DEFAULT_SECTION;
        }
        
        const sectionEl = document.getElementById(`section-${section}`);
        if (sectionEl) {
            sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            updateActiveNavLink(section);
        }
    }

    /**
     * Update active nav link based on current section
     * @param {string} section - Active section name
     */
    function updateActiveNavLink(section) {
        currentSection = section;
        document.querySelectorAll('.nav-link').forEach(link => {
            const linkSection = link.dataset.section;
            link.classList.toggle('active', linkSection === section);
        });
    }

    /**
     * Handle scroll to detect active section
     * Uses getBoundingClientRect which works regardless of scroll container
     */
    function handleScrollDetection() {
        const sections = VALID_SECTIONS.map(name => ({
            name,
            el: document.getElementById(`section-${name}`)
        })).filter(s => s.el);

        if (sections.length === 0) return;

        // Use viewport-relative positioning
        const viewportHeight = window.innerHeight;
        const triggerPoint = viewportHeight * 0.35; // 35% from top of viewport

        let activeSection = DEFAULT_SECTION;
        
        // Find the section that is currently most visible
        for (const section of sections) {
            const rect = section.el.getBoundingClientRect();
            // If section top is above trigger point (in view), it becomes active
            if (rect.top <= triggerPoint) {
                activeSection = section.name;
            }
        }

        if (activeSection !== currentSection) {
            updateActiveNavLink(activeSection);
        }
    }

    // Throttled scroll handler
    const handleScroll = throttle(handleScrollDetection, 100);

    /**
     * Initialize scroll navigation
     */
    function initScrollNav() {
        // Handle nav link clicks - scroll to section
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                if (section) {
                    scrollToSection(section);
                    // Close sidebar on mobile
                    document.querySelector('.sidebar')?.classList.remove('open');
                }
            });
        });

        // Listen for scroll on the page container (where scrolling actually happens)
        const pageContainer = document.getElementById('pageContainer');
        if (pageContainer) {
            pageContainer.addEventListener('scroll', handleScroll, { passive: true });
            console.log('Scroll listener attached to pageContainer');
        }
        
        // Also listen on window for edge cases
        window.addEventListener('scroll', handleScroll, { passive: true });

        // Initial detection
        setTimeout(handleScrollDetection, 200);

        // Handle hash on load - clean up invalid hashes
        const hash = window.location.hash.slice(1).replace('section-', '');
        if (hash) {
            if (VALID_SECTIONS.includes(hash)) {
                setTimeout(() => scrollToSection(hash), 100);
            } else {
                // Invalid hash (like "undefined") - clean it up
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        }
    }

    // ============================================
    // Auto-Refresh
    // ============================================
    
    /**
     * Update last refresh timestamp display
     */
    function updateLastRefreshDisplay() {
        const el = document.getElementById('lastRefresh');
        if (el) {
            el.textContent = `Last update: ${formatBrazilDateTime(new Date(), {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })}`;
        }
    }

    /**
     * Trigger data refresh
     */
    async function refreshData() {
        // Skip refresh if page is loading or already refreshing
        if (isRefreshing || isPageLoading) {
            console.log('Skipping auto-refresh - page is loading or already refreshing');
            return;
        }
        
        isRefreshing = true;
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳';
        }

        try {
            emit('refresh');
            updateLastRefreshDisplay();
        } catch (error) {
            console.error('Refresh error:', error);
            showToast('Error refreshing data', 'error');
        } finally {
            isRefreshing = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄';
            }
        }
    }

    /**
     * Start auto-refresh timer
     */
    function startAutoRefresh() {
        stopAutoRefresh();
        refreshTimer = setInterval(refreshData, REFRESH_INTERVAL);
    }

    /**
     * Stop auto-refresh timer
     */
    function stopAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // ============================================
    // UI Utilities
    // ============================================
    
    // Track if navigation has been initialized
    let navigationInitialized = false;

    /**
     * Show the main app container and hide login
     */
    function showApp() {
        const loginModal = document.getElementById('loginModal');
        const appContainer = document.getElementById('appContainer');
        
        if (loginModal) loginModal.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';

        // Update user display
        const session = getSession();
        const userNameEl = document.getElementById('currentUser');
        if (userNameEl && session) {
            userNameEl.textContent = session.username;
        }

        // Initialize navigation and platform switcher when app is shown
        // This ensures they're initialized both on refresh (when already logged in)
        // and on fresh login
        if (!navigationInitialized) {
            // Small delay to ensure DOM is fully rendered
            setTimeout(() => {
                initScrollNav();
                initPlatformSwitcher();
                navigationInitialized = true;
            }, 50);
        }
        
        // Emit appShown event so UnifiedPage can initialize
        emit('appShown', {});
    }

    /**
     * Show login modal and hide app
     */
    function showLogin() {
        const loginModal = document.getElementById('loginModal');
        const appContainer = document.getElementById('appContainer');
        
        if (loginModal) loginModal.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        
        // Reset navigation flag so it reinitializes on next login
        navigationInitialized = false;
    }

    /**
     * Toggle sidebar on mobile
     */
    function toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.toggle('open');
        }
    }

    /**
     * Open a modal by ID
     * @param {string} modalId - Modal element ID
     */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    /**
     * Close a modal by ID
     * @param {string} modalId - Modal element ID
     */
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /**
     * Update connection status indicator
     * @param {boolean} online - Whether online
     */
    function setConnectionStatus(online) {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            statusEl.className = `connection-status ${online ? 'online' : 'offline'}`;
            const textEl = statusEl.querySelector('.status-text');
            if (textEl) textEl.textContent = online ? 'Online' : 'Offline';
        }
    }

    // ============================================
    // Initialization
    // ============================================
    
    /**
     * Initialize core module
     */
    function init() {
        // AdminCore initializing
        
        // Sidebar toggle
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', toggleSidebar);
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', refreshData);
        }

        // Modal close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                closeModal(btn.dataset.close);
            });
        });

        // Close modal on overlay click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && overlay.id !== 'loginModal') {
                    overlay.style.display = 'none';
                }
            });
        });

        // Online/offline detection
        window.addEventListener('online', () => setConnectionStatus(true));
        window.addEventListener('offline', () => setConnectionStatus(false));
        setConnectionStatus(navigator.onLine);

        // Check authentication
        if (isAuthenticated()) {
            showApp(); // This now initializes scroll nav and platform switcher
            startAutoRefresh();
            updateLastRefreshDisplay();
        } else {
            showLogin();
        }
        
        // AdminCore initialized
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ============================================
    // Public API
    // ============================================
    return {
        // Event bus
        on,
        off,
        emit,
        
        // Session
        getSession,
        createSession,
        clearSession,
        isAuthenticated,
        
        // Navigation
        scrollToSection,
        getCurrentSection: () => currentSection,
        
        // Platform management
        getCurrentPlatform,
        setCurrentPlatform,
        getPlatformPrize,
        
        // UI
        showApp,
        showLogin,
        showToast,
        hideToast,
        openModal,
        closeModal,
        showLoading,
        updateLoadingProgress,
        hideLoading,
        setPageLoading,
        
        // Refresh
        refreshData,
        startAutoRefresh,
        stopAutoRefresh,
        
        // Utilities
        getBrazilTime,
        formatBrazilDateTime,
        getBrazilDateString,
        parseBrazilDateTime,
        parseCSV,
        parseCSVLine,
        detectDelimiter,
        maskWhatsApp,
        getBallColorClass,
        
        // Performance utilities
        debounce,
        throttle,
        requestIdleExecution,
        
        // Constants
        VALID_SECTIONS,
        DEFAULT_SECTION,
        PLATFORMS,
        DEFAULT_PLATFORM,
        PLATFORM_PRIZES
    };
})();
