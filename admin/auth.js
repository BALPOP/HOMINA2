const AUTH_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1PK0qI9PRWaleD6jpn-aQToJ2Mn7PRW0wWfCwd2o0QPE/export?format=csv';
const AUTH_SESSION_KEY = 'ps_admin_session';
const AUTH_SESSION_TTL_HOURS = 12;

async function fetchAccounts() {
    const response = await fetch(AUTH_SHEET_CSV_URL);
    if (!response.ok) {
        throw new Error('Failed to fetch credentials');
    }
    const csvText = await response.text();
    return parseCredentials(csvText);
}

function parseCredentials(csvText) {
    const lines = csvText.split('\n').filter(Boolean);
    const credentials = {};
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 2) continue;
        const account = cols[0].trim();
        const password = cols[1].trim();
        if (account && password) {
            credentials[account] = password;
        }
    }
    return credentials;
}

function setSession(account) {
    const expiresAt = Date.now() + AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000;
    const payload = { account, expiresAt };
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(payload));
}

function getSession() {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (!data.expiresAt || Date.now() > data.expiresAt) {
            sessionStorage.removeItem(AUTH_SESSION_KEY);
            return null;
        }
        return data;
    } catch (e) {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
        return null;
    }
}

function clearSession() {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function ensureAuthenticated() {
    const session = getSession();
    if (!session) {
        const isNested = window.location.pathname.includes('/admin/pages/');
        const target = isNested ? '../login.html' : '/admin/login.html';
        window.location.replace(target);
    }
}

function logout() {
    clearSession();
    const isNested = window.location.pathname.includes('/admin/pages/');
    const target = isNested ? '../login.html' : '/admin/login.html';
    window.location.replace(target);
}
