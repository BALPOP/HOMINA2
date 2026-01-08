/**
 * POP-SORTE Admin Dashboard - Authentication Module
 * 
 * This module handles:
 * - Login form submission and validation
 * - Credential verification against Google Sheets
 * - Session creation and management
 * - Logout functionality
 * 
 * Dependencies: admin-core.js (AdminCore)
 */

// ============================================
// Auth Module
// ============================================
window.AdminAuth = (function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    
    /**
     * Google Sheet URL for admin credentials
     * Sheet contains: username, password columns
     */
    const AUTH_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1PK0qI9PRWaleD6jpn-aQToJ2Mn7PRW0wWfCwd2o0QPE/export?format=csv';

    // ============================================
    // State
    // ============================================
    let credentials = null;
    let isLoading = false;

    // ============================================
    // Credential Loading
    // ============================================
    
    /**
     * Fetch credentials from Google Sheet
     * @returns {Promise<Object[]>} Array of credential objects {username, password}
     */
    async function fetchCredentials() {
        try {
            const url = `${AUTH_SHEET_URL}&t=${Date.now()}`;
            const response = await fetch(url, {
                cache: 'no-store',
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const csvText = await response.text();
            
            // Check if we got HTML instead of CSV
            if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
                throw new Error('Sheet not publicly accessible');
            }

            const lines = csvText.split(/\r?\n/).filter(Boolean);
            if (lines.length <= 1) {
                throw new Error('No credentials found');
            }

            const delimiter = AdminCore.detectDelimiter(lines[0]);
            const creds = [];

            for (let i = 1; i < lines.length; i++) {
                const row = AdminCore.parseCSVLine(lines[i], delimiter);
                if (row.length >= 2 && row[0] && row[1]) {
                    creds.push({
                        username: row[0].trim(),
                        password: row[1].trim()
                    });
                }
            }

            return creds;
        } catch (error) {
            console.error('Error fetching credentials:', error);
            throw error;
        }
    }

    // ============================================
    // Validation
    // ============================================
    
    /**
     * Validate username and password against credentials
     * @param {string} username - Username to validate
     * @param {string} password - Password to validate
     * @returns {Promise<boolean>} True if valid
     */
    async function validateCredentials(username, password) {
        // Fetch fresh credentials if not cached
        if (!credentials) {
            credentials = await fetchCredentials();
        }

        const normalizedUsername = username.trim().toLowerCase();
        const normalizedPassword = password.trim();

        return credentials.some(cred => 
            cred.username.toLowerCase() === normalizedUsername &&
            cred.password === normalizedPassword
        );
    }

    // ============================================
    // Login Handler
    // ============================================
    
    /**
     * Handle login form submission
     * @param {Event} e - Form submit event
     */
    async function handleLogin(e) {
        e.preventDefault();

        if (isLoading) return;

        const form = e.target;
        const usernameInput = form.querySelector('#username');
        const passwordInput = form.querySelector('#password');
        const errorEl = form.querySelector('#loginError');
        const submitBtn = form.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        // Basic validation
        if (!username || !password) {
            showError(errorEl, 'Please fill in all fields');
            return;
        }

        // Show loading state
        isLoading = true;
        btnText.style.display = 'none';
        btnLoading.style.display = 'inline';
        submitBtn.disabled = true;
        hideError(errorEl);

        try {
            const isValid = await validateCredentials(username, password);

            if (isValid) {
                // Create session
                AdminCore.createSession(username);
                
                // Clear form
                form.reset();
                
                // Show app
                AdminCore.showApp();
                
                // Initialize navigation (no hash needed for scroll-based nav)
                AdminCore.startAutoRefresh();
                
                // Emit login event
                AdminCore.emit('login', { username });
                
                AdminCore.showToast(`Welcome, ${username}!`, 'success');
            } else {
                showError(errorEl, 'Invalid username or password');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (error) {
            console.error('Login error:', error);
            showError(errorEl, 'Error verifying credentials. Please try again.');
        } finally {
            isLoading = false;
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
            submitBtn.disabled = false;
        }
    }

    /**
     * Show error message
     * @param {HTMLElement} el - Error element
     * @param {string} message - Error message
     */
    function showError(el, message) {
        if (el) {
            el.textContent = message;
            el.classList.add('show');
        }
    }

    /**
     * Hide error message
     * @param {HTMLElement} el - Error element
     */
    function hideError(el) {
        if (el) {
            el.textContent = '';
            el.classList.remove('show');
        }    }

    // ============================================
    // Logout Handler
    // ============================================
    
    /**
     * Handle logout
     */
    function handleLogout() {
        // Clear session
        AdminCore.clearSession();
        
        // Stop auto-refresh
        AdminCore.stopAutoRefresh();
        
        // Clear cached credentials
        credentials = null;
        
        // Show login
        AdminCore.showLogin();
        
        // Emit logout event
        AdminCore.emit('logout');
        
        AdminCore.showToast('Session ended', 'default');
    }

    // ============================================
    // Session Check
    // ============================================
    
    /**
     * Check session validity and redirect if expired
     */
    function checkSession() {
        const session = AdminCore.getSession();
        
        if (!session) {
            handleLogout();
            return false;
        }
        
        return true;
    }

    // ============================================
    // Initialization
    // ============================================
    
    /**
     * Initialize auth module
     */
    function init() {
        // Login form handler
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', handleLogin);
        }

        // Logout button handler
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Check session periodically (every minute)
        setInterval(checkSession, 60 * 1000);

        // Listen for storage events (logout from another tab)
        window.addEventListener('storage', (e) => {
            if (e.key === 'popsorte_admin_session' && !e.newValue) {
                handleLogout();
            }
        });
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
        validateCredentials,
        handleLogout,
        checkSession,
        refreshCredentials: () => { credentials = null; }
    };
})();

