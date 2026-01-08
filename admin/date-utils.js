// date-utils.js - Strict date parsing utilities for admin system
// No new Date(string), no locale-dependent parsing
// Only accepts: weekday dates (Fri, 02 Jan 2026), DD/MM/YYYY, ISO

const MONTH_NAMES = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
};

const MONTH_NUMBERS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Parse "Fri, 02 Jan 2026" or "Fri, 02 Jan 2026 19:59:56" to Date object
// Assumes BRT wall time for recharges, local time for others
function parseWeekdayDate(dateStr) {
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length < 4) return null;

  const day = parseInt(parts[1], 10);
  const month = MONTH_NAMES[parts[2]];
  const year = parseInt(parts[3], 10);

  if (isNaN(day) || month === undefined || isNaN(year)) return null;

  let hour = 0, min = 0, sec = 0;
  if (parts.length >= 5 && parts[4]) {
    const timeParts = parts[4].split(':');
    if (timeParts.length >= 3) {
      hour = parseInt(timeParts[0], 10);
      min = parseInt(timeParts[1], 10);
      sec = parseInt(timeParts[2], 10);
    }
  }

  // Create Date as local time (assumes system is in BRT for recharges)
  return new Date(year, month, day, hour, min, sec);
}

// Parse "02/01/2026" or "02/01/2026 19:59:56" to Date object
function parseDDMMYYYY(dateStr) {
  const parts = dateStr.trim().split(/\s+/);
  const dateParts = parts[0].split('/');
  if (dateParts.length !== 3) return null;

  const day = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1; // JS months are 0-based
  const year = parseInt(dateParts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  let hour = 0, min = 0, sec = 0;
  if (parts.length >= 2) {
    const timeParts = parts[1].split(':');
    if (timeParts.length >= 3) {
      hour = parseInt(timeParts[0], 10);
      min = parseInt(timeParts[1], 10);
      sec = parseInt(timeParts[2], 10);
    }
  }

  return new Date(year, month, day, hour, min, sec);
}

// Parse ISO "2026-01-02" or "2026-01-02T19:59:56Z" or "2026-01-02 19:59:56" to Date object
function parseISO(dateStr) {
  const isoRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})Z?)?$/;
  const match = dateStr.trim().match(isoRegex);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const min = match[5] ? parseInt(match[5], 10) : 0;
  const sec = match[6] ? parseInt(match[6], 10) : 0;

  return new Date(year, month, day, hour, min, sec);
}

// Normalize Date to "YYYY-MM-DD"
function normalizeToYYYYMMDD(date) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Normalize Date to "YYYY-MM-DD HH:MM:SS"
function normalizeToYYYYMMDDHHMMSS(date, timeString) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  const ymd = normalizeToYYYYMMDD(date);
  
  // If timeString is provided (HH:MM:SS), use it
  if (timeString && typeof timeString === 'string') {
    return `${ymd} ${timeString}`;
  }
  
  // Otherwise use date's time components
  const hour = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${ymd} ${hour}:${min}:${sec}`;
}

// Format Date to human readable "2 January 2026"
function formatHumanReadable(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const day = date.getDate();
  const month = MONTH_NUMBERS[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

// Format Date to "02/01/2026 19:59:56"
function formatTimestamp(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${min}:${sec}`;
}

// Parse any allowed format
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  // Try weekday format first
  let date = parseWeekdayDate(dateStr);
  if (date) return date;

  // Try DD/MM/YYYY
  date = parseDDMMYYYY(dateStr);
  if (date) return date;

  // Try ISO
  date = parseISO(dateStr);
  if (date) return date;

  return null; // Reject anything else
}

window.DateUtils = {
  parseWeekdayDate,
  parseDDMMYYYY,
  parseISO,
  parseDate,
  normalizeToYYYYMMDD,
  normalizeToYYYYMMDDHHMMSS,
  formatHumanReadable,
  formatTimestamp
};