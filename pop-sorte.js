// POP-SORTE LOTTERY SYSTEM - FULL REVAMP WITH SECURE WORKER API
// ✅ WORKER URL CONFIGURED
const API_BASE_URL = 'https://popsorte-api.danilla-vargas1923.workers.dev';

// Changes: WhatsApp instead of Pedido, UNLIMITED registrations per Game ID, proper Concurso system, no SN
let selectedNumbers = []; // Array to preserve order
let selectedPlatform = null;
let serverTimeOffset = 0; // Difference between server time and client time

// ============================================
// AUTO RETRY WITH EXPONENTIAL BACKOFF
// ============================================
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            
            // Check if error is retryable
            const shouldRetry = 
                error.message?.includes('Too Many Requests') ||
                error.message?.includes('429') ||
                error.message?.includes('503') ||
                error.message?.includes('timeout') ||
                error.message?.includes('Network') ||
                error.message?.includes('Failed to fetch');
            
            if (!shouldRetry) throw error;
            
            // Fast retry: 1s, 2s, 3s
            const delay = baseDelay * (i + 1) + Math.random() * 500;
            console.log(`⏳ Retry ${i + 1}/${maxRetries} aguardando ${Math.round(delay/1000)}s...`);
            
            // Show retry message to user
            const btn = document.getElementById('confirmEntryBtn');
            if (btn) {
                btn.textContent = `⏳ Tentativa ${i + 2}/${maxRetries}...`;
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

const CONCURSO_REFERENCE = {
    number: 6903,
    date: new Date('2025-12-15T00:00:00-03:00') // Explicit Brazil time
};

// Sync time with server to prevent client-side clock skew
async function syncServerTime() {
    try {
        console.log('⏳ Syncing time with server...');
        const start = Date.now();
        const response = await fetch(API_BASE_URL, { method: 'HEAD', cache: 'no-store' });
        const end = Date.now();
        const latency = (end - start) / 2;

        const serverDateHeader = response.headers.get('date');
        if (serverDateHeader) {
            const serverTime = new Date(serverDateHeader).getTime();
            const clientTime = Date.now();
            // Calculate offset: Server Time - Client Time + Latency
            serverTimeOffset = serverTime - clientTime + latency;
            console.log(`✅ Time synced! Offset: ${Math.round(serverTimeOffset)}ms`);
        }
    } catch (e) {
        console.warn('⚠️ Failed to sync time with server, using local time:', e);
    }
}

// Helper to get current time (corrected with server offset)
function getBrazilTime() {
    return new Date(Date.now() + serverTimeOffset);
}

// Helper to get Brazil Date Components (Manual UTC-3 Calculation)
// This bypasses browser timezone bugs by doing raw math
function getBrazilDateComponents(date) {
    // Brazil is UTC-3 (Fixed, no DST)
    const utcTime = date.getTime();
    const brazilTime = utcTime - (3 * 60 * 60 * 1000);
    const brDate = new Date(brazilTime);

    return {
        year: brDate.getUTCFullYear(),
        month: brDate.getUTCMonth() + 1, // 0-indexed
        day: brDate.getUTCDate(),
        hour: brDate.getUTCHours(),
        minute: brDate.getUTCMinutes(),
        second: brDate.getUTCSeconds()
    };
}

// Helper to format date/time in Brazil timezone (Manual)
function formatBrazilDateTime(date, options = {}) {
    const c = getBrazilDateComponents(date);

    // Simple formatter that mimics toLocaleString for common cases
    // If options has 'month': 'long', we might need a map. 
    // For now, let's support the specific usages in this file.

    const pad = (n) => n.toString().padStart(2, '0');
    const d = pad(c.day);
    const m = pad(c.month);
    const y = c.year;
    const h = pad(c.hour);
    const min = pad(c.minute);
    const s = pad(c.second);

    // Custom formatting based on options passed in code
    if (options.month === 'long') {
        const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        return `${d} de ${months[c.month - 1]} de ${y}`;
    }

    if (options.year === '2-digit') {
        return `${d}/${m}/${y.toString().slice(-2)}`;
    }

    if (options.hour) {
        // If asking for time, return full string or just time?
        // Usage 1: generateTime (HH:MM:SS)
        if (!options.day) return `${h}:${min}:${s}`;
    }

    // Default: DD/MM/YYYY
    return `${d}/${m}/${y}`;
}

// Helper to get YYYY-MM-DD in Brazil timezone
function getBrazilDateString(date) {
    const c = getBrazilDateComponents(date);
    return `${c.year}-${c.month.toString().padStart(2, '0')}-${c.day.toString().padStart(2, '0')}`;
}

// Helper to get day of week in Brazil timezone (0 = Sunday, 6 = Saturday)
function getBrazilDayOfWeek(date) {
    const c = getBrazilDateComponents(date);
    // Construct date from components to get day of week
    return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

// Helper to get day of week in Brazil timezone (0 = Sunday, 6 = Saturday)
function getBrazilDayOfWeek(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'short'
    });
    const weekday = formatter.format(date);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.indexOf(weekday);
}

// Helper to get month in Brazil timezone (0-indexed: 0 = January)
function getBrazilMonth(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        month: 'numeric'
    });
    return parseInt(formatter.format(date)) - 1;
}

// Helper to get day of month in Brazil timezone
function getBrazilDayOfMonth(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        day: 'numeric'
    });
    return parseInt(formatter.format(date));
}

// Draw calendar helpers (BRT)
function isNoDrawDay(date) {
    const month = getBrazilMonth(date); // 0-indexed, Brazil timezone
    const day = getBrazilDayOfMonth(date); // Brazil timezone
    const isChristmas = month === 11 && day === 25;
    const isNewYear = month === 0 && day === 1;
    return isChristmas || isNewYear;
}

function isEarlyDrawDay(date) {
    const month = getBrazilMonth(date); // Brazil timezone
    const day = getBrazilDayOfMonth(date); // Brazil timezone
    return (month === 11 && (day === 24 || day === 31));
}

function getDrawTimeHour(date) {
    return isEarlyDrawDay(date) ? 17 : 20;
}

function isValidDrawDay(date) {
    const isSunday = getBrazilDayOfWeek(date) === 0; // Brazil timezone
    return !isSunday && !isNoDrawDay(date);
}

function buildScheduleForDate(dateInput) {
    const dateStr = typeof dateInput === 'string'
        ? dateInput.split('T')[0]
        : getBrazilDateString(dateInput);

    const drawDate = new Date(`${dateStr}T00:00:00-03:00`);
    const drawHour = getDrawTimeHour(drawDate);

    const cutoff = new Date(`${dateStr}T${drawHour.toString().padStart(2, '0')}:00:00-03:00`);
    cutoff.setSeconds(cutoff.getSeconds() - 1); // 19:59:59 or 16:59:59

    const regStartDate = new Date(drawDate);
    regStartDate.setDate(regStartDate.getDate() - 1);
    const regStartStr = getBrazilDateString(regStartDate);
    const regStart = new Date(`${regStartStr}T20:00:01-03:00`); // 20:00:01 of previous day

    return { drawDate, drawHour, cutoff, regStart };
}

function getNextValidDrawDate(fromDate) {
    const probe = new Date(fromDate);
    probe.setHours(0, 0, 0, 0);

    for (let i = 0; i < 14; i++) {
        if (i > 0) probe.setDate(probe.getDate() + 1);
        if (isValidDrawDay(probe)) {
            return new Date(probe);
        }
    }
    throw new Error('No valid draw date found in range');
}

function getCurrentDrawSchedule() {
    const spNow = getBrazilTime(); // Use corrected Brazil time function
    const todayStr = getBrazilDateString(spNow);
    const today = new Date(`${todayStr}T00:00:00-03:00`);

    const todayValid = isValidDrawDay(today);
    if (todayValid) {
        const schedule = buildScheduleForDate(todayStr);
        if (spNow <= schedule.cutoff) {
            return { ...schedule, now: spNow };
        }
    }

    // After cutoff or today invalid: pick next valid draw day (skipping Sundays and blocked days)
    let probe = new Date(today);
    for (let i = 0; i < 14; i++) {
        probe.setDate(probe.getDate() + 1);
        const probeStr = getBrazilDateString(probe);
        const probeDate = new Date(`${probeStr}T00:00:00-03:00`);
        if (isValidDrawDay(probeDate)) {
            const nextSchedule = buildScheduleForDate(probeStr);
            return { ...nextSchedule, now: spNow };
        }
    }
    throw new Error('No valid draw date found');
}

// Calculate concurso number based on draw date while skipping non-draw days (Sundays + holiday closures)
function calculateConcurso(drawDate) {
    const refDateStr = getBrazilDateString(CONCURSO_REFERENCE.date);
    const targetDateStr = typeof drawDate === 'string'
        ? drawDate.split('T')[0]
        : getBrazilDateString(drawDate);

    const refDate = new Date(`${refDateStr}T12:00:00Z`);      // use noon UTC to avoid DST issues
    const targetDate = new Date(`${targetDateStr}T12:00:00Z`);

    let daysDiff = 0;
    let cursor = new Date(refDate);
    const step = targetDate >= refDate ? 1 : -1;

    while ((step === 1 && cursor < targetDate) || (step === -1 && cursor > targetDate)) {
        cursor.setUTCDate(cursor.getUTCDate() + step);
        const cursorStr = cursor.toISOString().split('T')[0];
        const cursorBrazil = new Date(`${cursorStr}T12:00:00-03:00`);
        if (isValidDrawDay(cursorBrazil)) {
            daysDiff += 1;
        }
    }

    return CONCURSO_REFERENCE.number + daysDiff * step;
}

// Get weekday name in Portuguese (Brazil timezone)
function getWeekdayName(date) {
    const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    return days[getBrazilDayOfWeek(date)];
}

// Initialize everything immediately (since script is at bottom of body)
syncServerTime(); // Start time sync
generateNumberGrid();
updateSelectedDisplay();
updateSubmitButton();
initCountdown();
updateDrawDateDisplay();
updateConfirmationWarning();
setupGameIdInput();
setupWhatsappInput();
initPlatformSelection();
fetchAndPopulateResults();
bindUiEvents();
initLatestFiveWidget();

// Show winner announcement popup on page load
setTimeout(() => {
    showWinnerPopup();
}, 2000); // Show after 2 seconds to let page load

// ✅ Fetch latest results directly from Google Sheets (public CSV exports)
async function fetchAndPopulateResults() {
    // Google Sheets CSV export URLs (public read-only)
    const RESULTS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OttNYHiecAuGG6IRX7lW6lkG5ciEcL8gp3g6lNrN9H8/export?format=csv&gid=300277644';
    const ENTRIES_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OttNYHiecAuGG6IRX7lW6lkG5ciEcL8gp3g6lNrN9H8/export?format=csv&gid=0';

    const marqueeBalls = document.getElementById('marqueeBalls');
    const marqueeContainer = document.querySelector('.results-marquee');
    const marqueeContent = document.getElementById('marqueeContent');

    if (!marqueeBalls || !marqueeContainer || !marqueeContent) return;

    // Helper function to check if a draw is valid
    const isValidDraw = (row) => {
        if (row.length < 7) return false;
        const contest = row[0].trim();
        const dateStr = row[1].trim();
        const nums = row.slice(2, 7).map(v => parseInt(v, 10)).filter(n => !isNaN(n));

        // Must have contest number, date, and 5 numbers
        if (!contest || !dateStr || nums.length !== 5) return false;

        // Check if it's a "No draw" entry
        const fullRow = row.join(' ').toLowerCase();
        if (fullRow.includes('no draw')) return false;

        return true;
    };

    // Helper function to count matches between entry numbers and winning numbers
    const countMatches = (entryNumbers, winningNumbers) => {
        return entryNumbers.filter(n => winningNumbers.includes(n)).length;
    };

    // Helper function to check if entry is valid (not explicitly invalid)
    const isValidEntry = (entry) => {
        const status = (entry.status || '').toUpperCase();
        const invalidStatuses = ['INVALID', 'INVÁLIDO', 'REJECTED', 'CANCELLED'];
        return !invalidStatuses.includes(status);
    };

    const updateAndAnimate = (latestResult, winners = []) => {
        if (!marqueeBalls || !marqueeContent) return;

        marqueeBalls.innerHTML = '';

        // Destructure with fallbacks for local JSON format vs CSV format
        const nums = latestResult.numbers || [];
        const drawNumber = latestResult.drawNumber || latestResult.contest || '---';
        const dateStr = latestResult.date || '';

        // Format date for Brazil
        let formattedDate = '';
        if (dateStr) {
            try {
                // Try YYYY-MM-DD
                if (dateStr.includes('-')) {
                    const [y, m, d] = dateStr.split('-').map(Number);
                    const dateObj = new Date(y, m - 1, d);
                    formattedDate = dateObj.toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                } else {
                    formattedDate = dateStr;
                }
            } catch (e) { formattedDate = dateStr; }
        }

        // Create/Update prefix
        let prefix = document.getElementById('marqueePrefix');
        if (!prefix) {
            prefix = document.createElement('span');
            prefix.id = 'marqueePrefix';
            marqueeBalls.parentNode.insertBefore(prefix, marqueeBalls);
        }
        prefix.innerHTML = `<span style="color:#ffffff;">ÚLTIMO RESULTADO: </span>`;

        // Remove any old suffix sibling (we will place it inside the flow)
        const oldSuffix = document.getElementById('marqueeSuffix');
        if (oldSuffix) oldSuffix.remove();

        // Add result balls
        if (nums && nums.length > 0) {
            nums.forEach(num => {
                const badge = document.createElement('div');
                badge.className = 'number-badge ' + getBallColorClass(num);
                const numberText = document.createElement('span');
                numberText.className = 'number-text';
                numberText.textContent = num.toString().padStart(2, '0');
                badge.appendChild(numberText);
                marqueeBalls.appendChild(badge);
            });
        }

        // Insert suffix right after numbers (before winners)
        if (drawNumber) {
            const suffixInside = document.createElement('span');
            suffixInside.id = 'marqueeSuffix';
            suffixInside.innerHTML = ` <span style="padding:2px 8px; border-radius:8px; font-weight:700; color:#ffffff; display:inline-flex; gap:6px; align-items:center;">
                <span style="color:#ffffff;">[ CONCURSO <b>#${drawNumber}</b></span>
                <span style="color:#ffffff;"> 📅 DATA: <b>${formattedDate}</b> ]</span>
               </span> `;
            marqueeBalls.appendChild(suffixInside);
        }

        // Add winners directly into marqueeBalls to ensure they are visible and looped
        if (winners && winners.length > 0) {
            const sep = document.createElement('span');
            sep.innerHTML = ' 🏆 ';
            sep.style.margin = '0 10px';
            sep.style.fontWeight = 'bold';
            marqueeBalls.appendChild(sep);

            const winnersTitle = document.createElement('span');
            winnersTitle.innerHTML = '<b>GANHADOR(ES):</b> ';
            winnersTitle.style.color = '#cb24e9ff';
            winnersTitle.style.marginRight = '8px';
            marqueeBalls.appendChild(winnersTitle);

            winners.forEach((win) => {
                const winTag = document.createElement('span');
                winTag.className = 'winner-info';
                winTag.style.display = 'inline-flex';
                winTag.style.alignItems = 'center';
                winTag.style.gap = '6px';
                winTag.style.background = 'linear-gradient(180deg, #FFF 0%, #FFF 50%, #FFF 100%)';
                winTag.style.animation = 'pulseWinner 1.2s ease-in-out infinite';
                winTag.style.padding = '3px 10px';
                winTag.style.borderRadius = '8px';
                winTag.style.border = '2px solid #cb24e9ff';
                winTag.style.fontSize = '0.85rem';
                winTag.style.marginRight = '12px';
                winTag.style.color = '#1e293b';
                winTag.style.cursor = 'pointer';
                winTag.title = 'Clique para ver detalhes do ganhador';

                const gameIdShort = win.gameId || 'N/A';
                const platform = (win.platform || 'POPN1').toUpperCase();

                // Construct inner HTML with Game ID and Numbers (as requested: GAME ID + NUMBER)
                let innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">
                    <span style="font-weight:800; color:#6c2bd9;">ID: ${gameIdShort}</span>
                    <span style="padding:2px 8px;border-radius:999px;background:#0ea5e9;color:#0b1c33;font-weight:800;font-size:0.7rem;">${platform}</span>
                </span> ` +
                    `<span style="color:#b45309; font-weight:700;">NÚMEROS: [</span>`;

                // Add numbers with conditional ball badge styling (highlight matched numbers)
                win.chosenNumbers.forEach((num, idx) => {
                    const isMatch = nums.includes(num);
                    if (isMatch) {
                        innerHTML += `<div class="number-badge ${getBallColorClass(num)}" style="width:22px; height:22px; font-size:0.65rem; margin:0 2px; display:inline-flex; align-items:center; justify-content:center;">` +
                            `<span class="number-text">${num.toString().padStart(2, '0')}</span>` +
                            `</div>`;
                    } else {
                        innerHTML += `<span style="margin:0 2px; color:#64748b;">${num.toString().padStart(2, '0')}</span>`;
                    }

                    if (idx < win.chosenNumbers.length - 1) {
                        innerHTML += `<span style="opacity:0.5;">,</span>`;
                    }
                });

                innerHTML += `<span style="color:#b45309; font-weight:700;">]</span>`;
                winTag.innerHTML = innerHTML;

                // Add click event to scroll to winners carousel section
                winTag.addEventListener('click', () => {
                    const carouselSection = document.getElementById('winnersCarouselSection');
                    if (carouselSection) {
                        carouselSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });

                marqueeBalls.appendChild(winTag);
            });
        } else {
            // No winners yet - show default message
            const noWinnersMsg = document.createElement('span');
            noWinnersMsg.innerHTML = '<span style="color:#ffffff; font-weight:600;">CARREGANDO RESULTADOS...</span>';
            noWinnersMsg.style.marginLeft = '10px';
            marqueeBalls.appendChild(noWinnersMsg);
        }

        // UPDATE WINNERS CAROUSEL
        updateWinnersCarousel(winners, nums);

        startMarquee();
    };

    const updateWinnersCarousel = (winners, winningNums) => {
        const carouselSection = document.getElementById('winnersCarouselSection');
        const track = document.getElementById('winnersCarouselTrack');
        const dotsContainer = document.getElementById('carouselDots');

        if (!carouselSection || !track || !dotsContainer) return;

        if (!winners || winners.length === 0) {
            carouselSection.style.display = 'none';
            return;
        }

        carouselSection.style.display = 'block';
        track.innerHTML = '';
        dotsContainer.innerHTML = '';

        winners.forEach((win, index) => {
            const card = document.createElement('div');
            card.className = 'winner-card';

            const winDate = (win.drawDate || '').split(' ')[0];
            const platform = (win.platform || 'POPN1').toUpperCase();

            let numsHTML = '';
            win.chosenNumbers.forEach(num => {
                const isMatch = winningNums.includes(num);
                if (isMatch) {
                    numsHTML += `<div class="winner-num-item match number-badge ${getBallColorClass(num)}">` +
                        `<span class="number-text">${num.toString().padStart(2, '0')}</span></div>`;
                } else {
                    numsHTML += `<div class="winner-num-item">${num.toString().padStart(2, '0')}</div>`;
                }
            });

            card.innerHTML = `
                <div class="winner-card-header">
                    <div class="winner-badge-pill">🏆 GANHADOR</div>
                    <span style="color: #64748b; font-size: 0.85rem; font-weight: 600;">SORTEIO: ${winDate}</span>
                    <span style="margin-left:auto; padding:4px 10px; border-radius:999px; background:#0ea5e9; color:#0b1c33; font-weight:800; font-size:0.75rem;">${platform}</span>
                </div>
                <div class="winner-id-text">ID: <strong>${win.gameId}</strong></div>
                <div class="winner-numbers-display">
                    ${numsHTML}
                </div>
                <div style="font-size: 0.85rem; color: #10b981; font-weight: 800;">
                    ${win.matches} ACERTOS! PARABÉNS! 🎉
                </div>
            `;
            track.appendChild(card);

            // Add dots
            const dot = document.createElement('div');
            dot.className = `carousel-dot ${index === 0 ? 'active' : ''}`;
            dot.onclick = () => goToSlide(index);
            dotsContainer.appendChild(dot);
        });

        // Initialize Carousel
        let currentSlide = 0;
        const totalSlides = winners.length;

        function goToSlide(n) {
            currentSlide = n;
            track.style.transform = `translateX(-${n * 100}%)`;

            // Update dots
            const dots = dotsContainer.querySelectorAll('.carousel-dot');
            dots.forEach((dot, idx) => {
                dot.classList.toggle('active', idx === n);
            });
        }

        // Auto-slide if more than 1 winner
        if (totalSlides > 1) {
            if (window.winnersCarouselInterval) clearInterval(window.winnersCarouselInterval);
            window.winnersCarouselInterval = setInterval(() => {
                currentSlide = (currentSlide + 1) % totalSlides;
                goToSlide(currentSlide);
            }, 5000);
        }
    };

    const startMarquee = () => {
        if (!marqueeContainer || !marqueeContent) return;

        // RE-SYNC ANIMATION
        const existingClones = marqueeContainer.querySelectorAll('.marquee-content:not([id="marqueeContent"])');
        existingClones.forEach(el => el.remove());

        marqueeContent.classList.remove('is-animating');

        const clone = marqueeContent.cloneNode(true);
        clone.id = "";
        clone.classList.remove('is-animating');
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        marqueeContainer.appendChild(clone);

        void marqueeContent.offsetWidth;
        void clone.offsetWidth;

        marqueeContent.classList.add('is-animating');
        clone.classList.add('is-animating');
    };

    try {
        // 1. Fetch Results from Google Sheets
        let latestResult = null;
        try {
            const res = await fetch(`${RESULTS_SHEET_URL}&t=${Date.now()}`, { cache: 'no-store' });
            if (res.ok) {
                const csv = await res.text();

                // Check if we got HTML instead of CSV
                if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
                    throw new Error('Sheet not publicly accessible');
                }

                const lines = csv.split(/\r?\n/).filter(Boolean);
                if (lines.length > 1) {
                    const delimiter = detectDelimiter(lines[0] || '');

                    // Find the last valid draw (skip "No draw" entries)
                    for (let i = lines.length - 1; i >= 1; i--) {
                        const row = parseCSVLine(lines[i], delimiter);
                        if (isValidDraw(row)) {
                            const nums = row.slice(2, 7).map(v => parseInt(v, 10)).filter(n => !isNaN(n));
                            const dateParts = (row[1] || '').split('/');
                            const dateISO = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}` : getBrazilDateString(new Date());
                            latestResult = {
                                drawNumber: row[0],
                                contest: row[0],
                                date: dateISO,
                                numbers: nums
                            };
                            break; // Found the latest valid draw
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Results fetch failed:', e);
        }

        if (!latestResult) throw new Error('Could not fetch results');

        // 2. Calculate Winners from Entries and Results
        let winners = [];
        try {
            const entriesRes = await fetch(`${ENTRIES_SHEET_URL}&t=${Date.now()}`, { cache: 'no-store' });
            if (entriesRes.ok) {
                const entriesCsv = await entriesRes.text();

                // Check if we got HTML instead of CSV
                if (entriesCsv.trim().startsWith('<!DOCTYPE') || entriesCsv.trim().startsWith('<html')) {
                    throw new Error('Entries sheet not publicly accessible');
                }

                const entriesLines = entriesCsv.split(/\r?\n/).filter(Boolean);

                if (entriesLines.length > 1) {
                    const delimiter = detectDelimiter(entriesLines[0] || '');
                    const targetContest = String(latestResult.drawNumber || latestResult.contest || '').trim();
                    const winningNumbers = latestResult.numbers || [];

                    // Parse entries
                    const entries = [];
                    for (let i = 1; i < entriesLines.length; i++) {
                        const row = parseCSVLine(entriesLines[i], delimiter);
                        if (row.length >= 9) {
                            const entryContest = String(row[6] || '').trim(); // contest column

                            if (entryContest === targetContest) {
                                const chosenNumbers = (row[4] || '').split(/[,;|\t]/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));

                                if (chosenNumbers.length === 5) {
                                    entries.push({
                                        platform: (row[1] || 'POPN1').toString().trim().toUpperCase(),
                                        gameId: row[2] || '',
                                        whatsapp: row[3] || '',
                                        chosenNumbers: chosenNumbers,
                                        drawDate: row[5] || '',
                                        contest: row[6] || '',
                                        status: row[8] || 'PENDING'
                                    });
                                }
                            }
                        }
                    }

                    // Calculate winners (3+ matches required)
                    // RULE: Only the HIGHEST matching tier wins PER PLATFORM
                    // Each platform (POPLUZ, POPN1) calculates winners independently
                    // Example: POPLUZ highest = 4 matches, POPN1 highest = 3 matches
                    //          Both platforms' top-tier winners are displayed
                    const MIN_MATCHES_TO_WIN = 3;
                    const allPotentialWinners = [];
                    
                    entries.forEach(entry => {
                        if (!isValidEntry(entry)) return;

                        const matches = countMatches(entry.chosenNumbers, winningNumbers);

                        if (matches >= MIN_MATCHES_TO_WIN) {
                            allPotentialWinners.push({
                                ...entry,
                                matches: matches,
                                matchedNumbers: entry.chosenNumbers.filter(n => winningNumbers.includes(n))
                            });
                        }
                    });

                    // Group potential winners by platform
                    const winnersByPlatform = {};
                    allPotentialWinners.forEach(w => {
                        const platform = (w.platform || 'POPN1').toUpperCase();
                        if (!winnersByPlatform[platform]) {
                            winnersByPlatform[platform] = [];
                        }
                        winnersByPlatform[platform].push(w);
                    });

                    // For each platform, find highest match count and filter to only top-tier
                    winners = [];
                    Object.keys(winnersByPlatform).forEach(platform => {
                        const platformWinners = winnersByPlatform[platform];
                        const highestMatchCount = Math.max(...platformWinners.map(w => w.matches));
                        
                        // Only include winners with the highest match count for this platform
                        const topTierWinners = platformWinners.filter(w => w.matches === highestMatchCount);
                        winners.push(...topTierWinners);
                    });

                    // Sort winners by matches desc (show higher matches first), then by platform, then by gameId
                    winners.sort((a, b) => {
                        if (b.matches !== a.matches) return b.matches - a.matches;
                        if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
                        return a.gameId.localeCompare(b.gameId);
                    });
                }
            }
        } catch (e) {
            console.warn('Winners calculation failed:', e);
        }

        updateAndAnimate(latestResult, winners);

    } catch (error) {
        console.error('All results sources failed:', error);
        // Marquee MUST always have content, never empty
        if (marqueeBalls) {
            marqueeBalls.innerHTML = '<span class="marquee-loading">CARREGANDO RESULTADOS...</span>';
        }
        startMarquee();
    }
}

// Simple CSV line parser
function parseCSVLine(line, delimiter = ',') {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else current += ch;
    }
    values.push(current.trim());
    return values;
}

function detectDelimiter(headerLine) {
    const counts = {
        ',': (headerLine.match(/,/g) || []).length,
        ';': (headerLine.match(/;/g) || []).length,
        '\t': (headerLine.match(/\t/g) || []).length,
        '|': (headerLine.match(/\|/g) || []).length,
    };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

function parseBrDateTime(str) {
    if (!str) return null;
    try {
        const [datePart, timePart = '00:00:00'] = str.trim().split(' ');
        const [d, m, y] = datePart.split(/[\/-]/).map(Number);
        const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
        if (!d || !m || !y) return null;
        return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, ss));
    } catch {
        return null;
    }
}

function maskWhatsappNumber(value) {
    if (!value) return '****';
    const digits = value.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return '***' + digits.slice(-4);
}

function normalizeTicketStatus(status) {
    const up = (status || '').toUpperCase();
    if (up === 'VALID' || up === 'VALIDADO') return 'valid';
    if (up === 'INVALID' || up === 'INVÁLIDO') return 'invalid';
    return 'pending';
}

function ticketStatusLabel(cls) {
    if (cls === 'valid') return 'VÁLIDO';
    if (cls === 'invalid') return 'INVÁLIDO';
    return '⏳ Em verificação...';
}

// ✅ SECURE: Latest 5 widget fetches via Worker API (public data)
function initLatestFiveWidget() {
    const listEl = document.getElementById('latest5List');
    const errEl = document.getElementById('latest5Error');
    if (!listEl) return;

    // Use Google Sheets CSV export with blurred data (secure)
    const latest5Url = 'https://docs.google.com/spreadsheets/d/1OttNYHiecAuGG6IRX7lW6lkG5ciEcL8gp3g6lNrN9H8/export?format=csv&gid=0';

    const render = (entries) => {
        if (errEl) errEl.style.display = 'none';
        listEl.innerHTML = '';

        if (!entries.length) {
            listEl.innerHTML = '<div class="latest5-loading">Nenhum bilhete carregado.</div>';
            return;
        }

        entries.forEach(entry => {
            const badgeCls = normalizeTicketStatus(entry.status);
            const numbersHTML = (entry.numbers || []).slice(0, 5).map(num => {
                const colorClass = getBallColorClass(num);
                return `<span class="number-badge ${colorClass}">${String(num).padStart(2, '0')}</span>`;
            }).join('');

            const card = document.createElement('div');
            card.className = 'latest5-card';
            card.innerHTML = `
                <div class="latest5-main">
                    <div class="latest5-top">
                        <span class="latest5-id">ID De Jogo: ${entry.gameId || '—'}</span>
                        <span class="latest5-ticket">${entry.ticketNumber || '—'}</span>
                    </div>
                    <div class="latest5-meta">
                        <span>Concurso: ${entry.contest || '—'}</span>
                        <span>Data: ${entry.drawDate || '—'}</span>
                        <span>WhatsApp: ${maskWhatsappNumber(entry.whatsapp)}</span>
                    </div>
                    <div class="latest5-numbers">${numbersHTML}</div>
                </div>
                <div class="latest5-badge is-${badgeCls}">${ticketStatusLabel(badgeCls)}</div>
            `;
            listEl.appendChild(card);
        });
    };

    const showError = (msg) => {
        if (!errEl) return;
        errEl.textContent = msg;
        errEl.style.display = 'block';
    };

    const loadLatest = async () => {
        if (errEl) errEl.style.display = 'none';
        listEl.innerHTML = '<div class="latest5-loading">Carregando últimos bilhetes...</div>';

        try {
            // Append cache-busting parameter with & since URL already has query params
            const url = `${latest5Url}&t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const csv = await res.text();

            // Check if we got HTML instead of CSV (Google Sheets might return login page)
            if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
                throw new Error('Received HTML instead of CSV. Sheet may not be publicly accessible.');
            }
            const lines = csv.split(/\r?\n/).filter(Boolean);
            if (lines.length <= 1) throw new Error('CSV vazio');

            const delimiter = detectDelimiter(lines[0]);
            const entries = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i], delimiter);
                if (row.length < 9) continue;

                const parsedDate = parseBrDateTime(row[0] || '');
                entries.push({
                    timestamp: row[0] || '',
                    parsedDate,
                    platform: row[1] || 'POPN1',
                    gameId: row[2] || '',
                    whatsapp: row[3] || '',
                    numbers: (row[4] || '').split(/[,;|\t]/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n)),
                    drawDate: row[5] || '',
                    contest: row[6] || '',
                    ticketNumber: row[7] || '',
                    status: row[8] || 'PENDING'
                });
            }

            entries.sort((a, b) => {
                const ta = a.parsedDate ? a.parsedDate.getTime() : 0;
                const tb = b.parsedDate ? b.parsedDate.getTime() : 0;
                return tb - ta;
            });

            render(entries.slice(0, 5));
        } catch (e) {
            showError('Não foi possível carregar os últimos bilhetes.');
        }
    };

    loadLatest();
    setInterval(loadLatest, 30000);
}

// GAME ID VALIDATION - EXACTLY 10 DIGITS
const GAME_ID_REGEX = /^[0-9]{10}$/;

function isValidGameId(id) {
    return typeof id === 'string' && GAME_ID_REGEX.test(id);
}

function normalizeGameId(id) {
    if (!isValidGameId(id)) {
        throw new Error('ID de Jogo deve ter exatamente 10 dígitos');
    }
    return id;
}

// WHATSAPP BRAZIL VALIDATION - 10 or 11 DIGITS
const WHATSAPP_REGEX = /^[0-9]{10,11}$/;

function isValidWhatsApp(number) {
    return typeof number === 'string' && WHATSAPP_REGEX.test(number);
}

// Setup Game ID input with exactly 10 digit validation
function setupGameIdInput() {
    const gameIdInput = document.getElementById('gameId');

    gameIdInput.addEventListener('input', function (e) {
        // Remove all non-digit characters
        let value = e.target.value.replace(/\D/g, '');

        // Limit to exactly 10 digits
        if (value.length > 10) {
            value = value.slice(0, 10);
        }

        e.target.value = value;

        // Visual feedback
        if (value.length === 10) {
            e.target.style.borderColor = '#22c55e';
        } else {
            e.target.style.borderColor = '#e5e7eb';
        }
    });
}

// Setup WhatsApp input with Brazil format validation
function setupWhatsappInput() {
    const whatsappInput = document.getElementById('whatsappNumber');

    whatsappInput.addEventListener('input', function (e) {
        // Remove all non-digit characters
        let value = e.target.value.replace(/\D/g, '');

        // Limit to 11 digits (Brazil mobile: 11 99988 7766)
        if (value.length > 11) {
            value = value.slice(0, 11);
        }

        // Format for Brazil: XX XXXXX XXXX or XX XXXX XXXX
        let formatted = value;
        if (value.length > 2) {
            formatted = value.slice(0, 2) + ' ' + value.slice(2);
        }
        if (value.length > 7) {
            formatted = value.slice(0, 2) + ' ' + value.slice(2, 7) + ' ' + value.slice(7);
        }

        e.target.value = formatted;

        // Visual feedback (10-11 digits valid)
        const raw = value;
        if (raw.length >= 10 && raw.length <= 11) {
            e.target.style.borderColor = '#22c55e';
        } else {
            e.target.style.borderColor = '#e5e7eb';
        }
    });

    // Store raw value in data attribute for submission
    whatsappInput.addEventListener('blur', function (e) {
        const raw = e.target.value.replace(/\D/g, '');
        e.target.dataset.raw = raw;
    });
}

// Toggle WhatsApp field visibility (opt-out logic)
function toggleWhatsappField() {
    const checkbox = document.getElementById('whatsappOptOut');
    const whatsappGroup = document.getElementById('whatsappGroup');
    const whatsappInput = document.getElementById('whatsappNumber');

    // Checkbox is optional in the current markup; default to showing WhatsApp field
    if (!checkbox) {
        whatsappGroup.style.display = 'block';
        whatsappInput.required = true;
        return;
    }

    if (checkbox.checked) {
        // User doesn't want to provide WhatsApp - hide field
        whatsappGroup.style.display = 'none';
        whatsappInput.required = false;
        whatsappInput.value = '';
    } else {
        // Show WhatsApp field (default)
        whatsappGroup.style.display = 'block';
        whatsappInput.required = true;
    }
}

function initPlatformSelection() {
    const radios = document.querySelectorAll('input[name="platformChoice"]');
    const pill = document.getElementById('platformBadgePopup');
    const switchEl = document.querySelector('.platform-switch');
    if (radios.length === 0) return;

    const apply = (platform) => {
        selectedPlatform = platform || null;
        const badge = document.getElementById('platformBadgePopup');
        if (badge) {
            badge.textContent = selectedPlatform || 'ESCOLHA UMA PLATAFORMA';
        }
        updatePlatformStyles(platform);
    };

    const updatePlatformStyles = (platform) => {
        const upper = (platform || '').toUpperCase();
        const hasSelection = !!upper;
        if (switchEl) switchEl.classList.toggle('platform-active', hasSelection);
        if (pill) {
            pill.classList.toggle('platform-active', hasSelection);
            pill.setAttribute('data-platform', upper || '');
        }
        const labels = document.querySelectorAll('.platform-option');
        labels.forEach(label => {
            const input = label.querySelector('input[type="radio"]');
            const checked = !!(input && input.checked);
            label.classList.toggle('is-selected', checked);
            label.classList.toggle('is-unselected', hasSelection && !checked);
        });
    };

    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) apply(radio.value);
        });
    });

    const preselected = Array.from(radios).find(r => r.checked);
    apply(preselected ? preselected.value : null);
}

function getSelectedPlatform() {
    const radios = document.querySelectorAll('input[name="platformChoice"]');
    const checked = Array.from(radios).find(r => r.checked);
    return (checked?.value || selectedPlatform || '').toUpperCase();
}

// Generate 80 numbers
function generateNumberGrid() {
    const grid = document.getElementById('numberGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= 80; i++) {
        const ball = document.createElement('div');
        ball.className = 'number-ball';
        ball.textContent = i.toString().padStart(2, '0');
        ball.dataset.number = i;
        ball.onclick = () => toggleNumber(i);
        grid.appendChild(ball);
    }
}

// Toggle number selection - ALWAYS SORTED
function toggleNumber(num) {
    const ball = document.querySelector(`.number-ball[data-number="${num}"]`);
    const maxNumbers = 5;

    const index = selectedNumbers.indexOf(num);

    if (index > -1) {
        selectedNumbers.splice(index, 1);
        ball.classList.remove('selected');
    } else {
        if (selectedNumbers.length < maxNumbers) {
            selectedNumbers.push(num);
            ball.classList.add('selected');
        } else {
            showToast('MÁXIMO 5 NÚMEROS!');
        }
    }

    // Sort numbers from smallest to largest
    selectedNumbers.sort((a, b) => a - b);

    updateSelectedDisplay();
    updateSubmitButton();
}

// Calculate ball color class based on grid position (matches CSS nth-child(10n+x) pattern)
function getBallColorClass(num) {
    const remainder = num % 10;
    return `ball-color-${remainder}`;
}

// Update display - SHOWS SELECTED NUMBERS WITHOUT ORDER INDICATORS
function updateSelectedDisplay() {
    const container = document.getElementById('selectedNumbers');
    const countDisplay = document.getElementById('selectedCount');

    container.innerHTML = '';

    if (selectedNumbers.length === 0) {
        container.innerHTML = '<span class="empty-state">Nenhum número selecionado</span>';
    } else {
        selectedNumbers.forEach((num) => {
            const badge = document.createElement('div');
            badge.className = 'number-badge ' + getBallColorClass(num);

            const numberText = document.createElement('span');
            numberText.className = 'number-text';
            numberText.textContent = num.toString().padStart(2, '0');

            badge.appendChild(numberText);
            container.appendChild(badge);
        });
    }

    countDisplay.textContent = `${selectedNumbers.length}/5 números`;
    countDisplay.className = 'selected-count';

    if (selectedNumbers.length >= 5 && selectedNumbers.length <= 20) {
        countDisplay.classList.add('complete');
    }
}

// Clear numbers
function clearNumbers() {
    selectedNumbers = [];
    document.querySelectorAll('.number-ball.selected').forEach(ball => {
        ball.classList.remove('selected');
    });
    updateSelectedDisplay();
    updateSubmitButton();
}

// Surpresinha - random EXACTLY 5 numbers with sorting
function surpresinha() {
    clearNumbers();

    const quantity = 5;
    const numbers = [];

    for (let i = 1; i <= 80; i++) {
        numbers.push(i);
    }

    // Shuffle using Fisher-Yates algorithm
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }

    // Select first 5 numbers and SORT them
    const selectedRandom = numbers.slice(0, quantity).sort((a, b) => a - b);

    selectedRandom.forEach(num => {
        selectedNumbers.push(num);
        const ball = document.querySelector(`.number-ball[data-number="${num}"]`);
        ball.classList.add('selected');
    });

    // Ensure selectedNumbers is sorted
    selectedNumbers.sort((a, b) => a - b);

    updateSelectedDisplay();
    updateSubmitButton();

    // Show selected numbers in toast
    const displayNumbers = selectedNumbers.map(n => n.toString().padStart(2, '0')).join(', ');
    showToast(`🎲 ${displayNumbers}`);
}

// Update submit button
function updateSubmitButton() {
    const btn = document.getElementById('submitBtn');

    if (selectedNumbers.length >= 5 && selectedNumbers.length <= 20) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

// Show user info popup
function showUserInfoPopup() {
    if (selectedNumbers.length < 5 || selectedNumbers.length > 20) {
        showToast('SELECIONE ENTRE 5 NÚMEROS!');
        return;
    }

    updateConfirmationWarning(); // Update warning with current concurso info
    document.getElementById('userInfoPopup').style.display = 'block';
}

// Update confirmation warning text
function updateConfirmationWarning() {
    const drawDate = getDrawDate();
    const drawHour = getDrawHour();
    const concurso = calculateConcurso(drawDate);
    const weekday = getWeekdayName(drawDate);
    const formattedDate = formatBrazilDateTime(drawDate, {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
    });

    const warningText = `Está prestes a se cadastrar no <strong>CONCURSO ${concurso}</strong> (${weekday} <strong>${formattedDate}</strong>) às <strong>${drawHour.toString().padStart(2, '0')}:00</strong> BRT.<br><br>
    Resultado será atualizado no oficial: <a href="https://loterias.caixa.gov.br/Paginas/quina.aspx" target="_blank" style="color: #0b3eccff; text-decoration: underline;">https://loterias.caixa.gov.br/Paginas/quina.aspx</a>.`;

    const warningElement = document.getElementById('confirmationWarning');
    if (warningElement) {
        warningElement.innerHTML = warningText;
    }
}

// Close popup
function closeUserInfoPopup() {
    document.getElementById('userInfoPopup').style.display = 'none';
    document.getElementById('gameId').value = '';
    document.getElementById('whatsappNumber').value = '';
    const optOut = document.getElementById('whatsappOptOut');
    if (optOut) {
        optOut.checked = false;
        toggleWhatsappField();
    }
}

// Show winner announcement popup
function showWinnerPopup() {
    const popup = document.getElementById('winnerPopup');
    popup.style.display = 'block';
    
    // Close popup when clicking outside the content
    const closeOnOutsideClick = (e) => {
        if (e.target === popup) {
            closeWinnerPopup();
        }
    };
    
    popup.addEventListener('click', closeOnOutsideClick);
    
    // Store the event listener so we can remove it later
    popup._closeOnOutsideClick = closeOnOutsideClick;
}

// Close winner popup
function closeWinnerPopup() {
    const popup = document.getElementById('winnerPopup');
    popup.style.display = 'none';
    
    // Remove the outside click listener to prevent memory leaks
    if (popup._closeOnOutsideClick) {
        popup.removeEventListener('click', popup._closeOnOutsideClick);
        delete popup._closeOnOutsideClick;
    }
}

// Calculate draw date/time with holiday and early-draw rules (BRT)
function getDrawDate() {
    const schedule = getCurrentDrawSchedule();
    return schedule.drawDate;
}

function getDrawHour() {
    const schedule = getCurrentDrawSchedule();
    return schedule.drawHour;
}

// Get cutoff period identifier
function getCutoffPeriod() {
    const drawDate = getDrawDate();
    return drawDate.toISOString().split('T')[0];
}

// ✅ SECURE: CONFIRM ENTRY via Worker API
let isSubmitting = false; // Prevent double submissions

async function confirmEntry() {
    // CRITICAL: Prevent double-click / double submission
    if (isSubmitting) {
        console.log('⚠️ Already submitting, ignoring duplicate click');
        return;
    }
    isSubmitting = true;
    
    const gameIdRaw = document.getElementById('gameId').value.trim();
    const whatsappOptOut = document.getElementById('whatsappOptOut');
    const whatsappInput = document.getElementById('whatsappNumber');

    // Validate Game ID - EXACTLY 10 digits
    let gameId;
    try {
        gameId = normalizeGameId(gameIdRaw);
    } catch (error) {
        showToast('❌ ID DE JOGO INVÁLIDO! Digite exatamente 10 dígitos', 'error');
        isSubmitting = false; // Reset flag on validation error
        return;
    }

    // Get WhatsApp number - clean format +55XXXXXXXXXXX (no spaces)
    let whatsappNumber = 'N/A';
    const isOptOutChecked = whatsappOptOut ? whatsappOptOut.checked : false;
    if (!isOptOutChecked) {
        // User wants to provide WhatsApp
        const rawNumber = whatsappInput.value.replace(/\D/g, '');

        if (!isValidWhatsApp(rawNumber)) {
            showToast('❌ WHATSAPP INVÁLIDO! Digite 10-11 dígitos (ex: 11999887766)', 'error');
            isSubmitting = false; // Reset flag on validation error
            return;
        }

        // Format as +55XXXXXXXXXXX
        whatsappNumber = '+55' + rawNumber;
    }

    if (selectedNumbers.length < 5 || selectedNumbers.length > 20) {
        showToast('❌ SELECIONE ENTRE 5 NÚMEROS!', 'error');
        isSubmitting = false; // Reset flag on validation error
        return;
    }

    const platform = getSelectedPlatform();
    if (!platform) {
        showToast('❌ Selecione uma plataforma antes de confirmar', 'error');
        isSubmitting = false; // Reset flag on validation error
        return;
    }

    // DEBUG: Show exactly what radio buttons exist and their states
    const allRadios = document.querySelectorAll('input[name="platformChoice"]');
    console.log('══════════════════════════════════════');
    console.log('🔍 DEBUG: All platform radio buttons:');
    allRadios.forEach((r, i) => {
        console.log(`   Radio ${i}: value="${r.value}", checked=${r.checked}`);
    });
    console.log('🎯 STARTING ENTRY VALIDATION');
    console.log('   Game ID:', gameId);
    console.log('   WhatsApp:', whatsappNumber);
    console.log('   Platform:', platform);
    console.log('   selectedPlatform (global):', selectedPlatform);
    console.log('   Numbers:', selectedNumbers);
    console.log('   Page URL:', window.location.href);
    console.log('══════════════════════════════════════');

    closeUserInfoPopup();
    showToast('💾 SALVANDO BILHETE...', 'checking');

    try {
        const drawDate = getDrawDate();
        const numerosFormatted = selectedNumbers.map(n => n.toString().padStart(2, '0')).join(', ');

        console.log('Draw date calculated:', drawDate);

        // ✅ SECURE: Submit via Worker API with RETRY
        const drawDateStr = getBrazilDateString(drawDate);
        const concurso = calculateConcurso(drawDate);

        // DEBUG: Log exact request body
        const requestBody = {
            platform: platform,
            gameId: gameId,
            whatsappNumber: whatsappNumber,
            numerosEscolhidos: numerosFormatted,
            drawDate: drawDateStr,
            concurso: concurso
        };
        console.log('📤 REQUEST BODY:', JSON.stringify(requestBody, null, 2));

        // ✅ USE RETRY WITH BACKOFF (3 attempts, 1s base delay)
        const saveResult = await retryWithBackoff(async () => {
            const response = await fetch(`${API_BASE_URL}/api/tickets/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Falha ao salvar bilhete');
            }

            return result;
        }, 3, 1000); // 3 retries, 1s base delay

        const bilheteNumber = saveResult.bilheteNumber || 'UNKNOWN';
        console.log(`✅ SAVED! Bilhete number: ${bilheteNumber}`);

        // Telegram notification sent automatically by Worker

        // Redirect to bilhete page
        const spTime = getBrazilTime();

        const generateTime = formatBrazilDateTime(spTime, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const ticketDateDisplay = formatBrazilDateTime(drawDate, {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });

        const formattedNumbers = selectedNumbers.map(n => n.toString().padStart(2, '0')).join(',');

        const params = new URLSearchParams({
            gameId: gameId,
            whatsapp: whatsappNumber,
            numbers: formattedNumbers,
            time: generateTime,
            date: ticketDateDisplay,
            bilhete: bilheteNumber,
            concurso: concurso,
            platform: platform
        });

        hideToast();
        window.location.href = `bilhete.html?${params.toString()}`;

    } catch (error) {
        console.error('Error:', error);
        hideToast();

        // Show actual error message from server or network error
        const errorMsg = error.message || 'Erro ao salvar! Tente novamente!';
        showToast('❌ ' + errorMsg, 'error');
    } finally {
        // Reset submission flag to allow retry
        isSubmitting = false;
    }
}

// Toast notification
function showToast(message, type = 'default') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show';

    if (type === 'error') {
        toast.classList.add('error');
        setTimeout(() => {
            toast.className = 'toast';
        }, 15000);
    } else if (type === 'checking') {
        toast.classList.add('checking');
    } else {
        setTimeout(() => {
            toast.className = 'toast';
        }, 3000);
    }
}

// Hide toast manually
function hideToast() {
    const toast = document.getElementById('toast');
    toast.className = 'toast';
}

// Countdown timer - BRAZIL TIMEZONE + SKIP SUNDAY
// ✅ CORRECT - Force Brazil timezone
function initCountdown() {
    function updateCountdown() {
        const spTime = getBrazilTime(); // Use corrected Brazil time function

        const schedule = getCurrentDrawSchedule();

        // Build target time with explicit Brazil timezone
        const drawDateStr = getBrazilDateString(schedule.drawDate);
        const targetTime = new Date(`${drawDateStr}T${schedule.drawHour.toString().padStart(2, '0')}:00:00-03:00`);

        const diff = targetTime - spTime;

        if (diff < 0) {
            console.warn('Countdown negative, recalculating...');
            // Force page reload to recalculate next draw
            setTimeout(() => {
                initCountdown(); // Restart countdown
            }, 1000);
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.textContent =
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            const minutesLeft = Math.floor(diff / (1000 * 60));
            if (minutesLeft <= 15) {
                countdownEl.classList.add('pulse');
            } else {
                countdownEl.classList.remove('pulse');
            }
        }
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
}

function bindUiEvents() {
    const howItWorksBtn = document.getElementById('ctaHowItWorksBtn');
    if (howItWorksBtn) {
        howItWorksBtn.addEventListener('click', scrollToVerticalVideo);
    }

    const clearBtn = document.getElementById('btnClearNumbers');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearNumbers);
    }

    const surpriseBtn = document.getElementById('btnSurpresinha');
    if (surpriseBtn) {
        surpriseBtn.addEventListener('click', surpresinha);
    }

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', showUserInfoPopup);
    }

    const closePopupBtn = document.getElementById('closePopupBtn');
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', closeUserInfoPopup);
    }

    const closeWinnerPopupBtn = document.getElementById('closeWinnerPopupBtn');
    if (closeWinnerPopupBtn) {
        closeWinnerPopupBtn.addEventListener('click', closeWinnerPopup);
    }

    const confirmBtn = document.getElementById('btnConfirmEntry');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmEntry);
    }
}

// Scroll to selection
function scrollToSelection() {
    document.getElementById('selection').scrollIntoView({ behavior: 'smooth' });
}

// Scroll to vertical video section
function scrollToVerticalVideo() {
    const target = document.getElementById('verticalVideoSection');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
    }
}

// Update draw date display with CONCURSO NUMBER
function updateDrawDateDisplay() {
    const drawDate = getDrawDate();
    const drawHour = getDrawHour();
    const concurso = calculateConcurso(drawDate);

    const day = drawDate.getDate().toString().padStart(2, '0');
    const month = (drawDate.getMonth() + 1).toString().padStart(2, '0');
    const year = drawDate.getFullYear();

    const formattedDate = `${day}/${month}/${year} ${drawHour.toString().padStart(2, '0')}h`;

    document.getElementById('drawDate').textContent = formattedDate;
    document.getElementById('contestNumber').textContent = concurso;
}

// ✅ DevTools protection (with Q+2 override)
(() => {
    const DETECT_INTERVAL_MS = 600;
    // DEV PROTECTION DISABLED
})();

// ✅ VLD Ticket Consultation Functionality (uses Google Sheets with blurred data)
(function() {
    // Determine which sheet to use and which platform to filter
    // Check for both /luz and /luz.html (server might remove .html extension)
    const pathname = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();
    
    // More robust detection - check pathname, href, and handle trailing slashes
    const isLuzPage = pathname.includes('luz') || href.includes('/luz');
    const isN1Page = !isLuzPage && (pathname.includes('n1') || href.includes('/n1'));
    
    console.log('📍 VLD Section - Page Detection:', { pathname, href, isLuzPage, isN1Page });
    // Debug alert (remove after testing)
    // alert(`Page: ${pathname}\nisLuzPage: ${isLuzPage}\nisN1Page: ${isN1Page}`);
    
    // Use gviz/tq format for sheet name selection (more reliable than &sheet=)
    const ENTRIES_URL = isLuzPage ? 'https://docs.google.com/spreadsheets/d/1b_VAYANY_XUsO0_kZzyb3PpJveO4KviwuF5mPxoHKLo/gviz/tq?tqx=out:csv&sheet=LUZ' :
                       isN1Page ? 'https://docs.google.com/spreadsheets/d/1b_VAYANY_XUsO0_kZzyb3PpJveO4KviwuF5mPxoHKLo/gviz/tq?tqx=out:csv&sheet=N1' :
                       'https://docs.google.com/spreadsheets/d/1OttNYHiecAuGG6IRX7lW6lkG5ciEcL8gp3g6lNrN9H8/export?format=csv&gid=0';
    
    // Platform filter: only show entries for this platform
    const PLATFORM_FILTER = isLuzPage ? 'POPLUZ' : isN1Page ? 'POPN1' : null;
    
    console.log('🎯 Platform Filter:', PLATFORM_FILTER, '| URL:', ENTRIES_URL);
    console.log('🔧 Filter will be applied:', PLATFORM_FILTER !== null);

    let allEntries = [], filteredEntries = [];
    let currentFilter = 'all', searchTerm = '';
    let currentPage = 1, perPage = 10;

    function detectDelimiter(headerLine) {
        const counts = {
            ',': (headerLine.match(/,/g) || []).length,
            ';': (headerLine.match(/;/g) || []).length,
            '\t': (headerLine.match(/\t/g) || []).length,
            '|': (headerLine.match(/\|/g) || []).length,
        };
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
    }

    function parseCSVLine(line, delimiter = ',') {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQ = !inQ;
            } else if (ch === delimiter && !inQ) {
                out.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        out.push(cur.trim());
        return out;
    }

    function parseBrDateTime(str) {
        if (!str) return null;
        try {
            const [datePart, timePart = '00:00:00'] = str.trim().split(' ');
            const [d, m, y] = datePart.split(/[\/\-]/).map(Number);
            const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
            if (!d || !m || !y) return null;
            return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, ss));
        } catch { return null; }
    }

    function formatBr(dt) {
        if (!dt || isNaN(dt.getTime())) return null;
        return dt.toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'America/Sao_Paulo'
        });
    }

    function getBallColorClass(num) { return 'ball-color-' + (num % 10); }
    function normalizeStatus(status) {
        const up = status.toUpperCase();
        if (up === 'VALID' || up === 'VALIDADO') return 'valid';
        if (up === 'INVALID' || up === 'INVÁLIDO') return 'invalid';
        return 'pending';
    }
    function maskWhatsApp(w) {
        if (!w) return '****';
        const digits = w.replace(/\D/g, '');
        if (digits.length < 4) return '****';
        return '***' + digits.slice(-4);
    }

    async function fetchEntries() {
        try {
            // Append cache-busting parameter with & since URL already has query params
            const url = `${ENTRIES_URL}&t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const csv = await res.text();

            // Check if we got HTML instead of CSV (Google Sheets might return login page)
            if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
                throw new Error('Received HTML instead of CSV. Sheet may not be publicly accessible.');
            }
            const lines = csv.split(/\r?\n/).filter(Boolean);
            if (lines.length <= 1) throw new Error('CSV vazio');

            const delimiter = detectDelimiter(lines[0]);
            allEntries = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i], delimiter);
                if (row.length < 9) continue;

                const timestampRaw = row[0] || '';
                const platform = (row[1] || 'POPN1').trim().toUpperCase();
                const gameId = row[2] || '';
                const whatsappRaw = row[3] || '';
                const numbers = (row[4] || '').split(/[,;|\t]/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                const drawDate = row[5] || '';
                const contest = row[6] || '';
                const ticketNumber = row[7] || '';
                const status = (row[8] || 'PENDING').trim().toUpperCase();

                const parsedDate = parseBrDateTime(timestampRaw);

                // Filter by platform if PLATFORM_FILTER is set
                // Only show entries that match the current page's platform
                if (PLATFORM_FILTER) {
                    if (platform !== PLATFORM_FILTER) {
                        console.log(`⛔ Skipping entry - Platform mismatch: "${platform}" !== "${PLATFORM_FILTER}"`);
                        continue; // Skip entries that don't match the platform
                    } else {
                        console.log(`✅ Including entry - Platform match: "${platform}"`);
                    }
                }

                allEntries.push({
                    timestamp: timestampRaw,
                    parsedDate,
                    platform,
                    gameId,
                    bilheteNumber: ticketNumber,
                    numbers,
                    drawDate,
                    contest,
                    whatsapp: whatsappRaw,
                    whatsappMasked: maskWhatsApp(whatsappRaw),
                    status
                });
            }

            allEntries.sort((a, b) => {
                const ta = a.parsedDate ? a.parsedDate.getTime() : 0;
                const tb = b.parsedDate ? b.parsedDate.getTime() : 0;
                return tb - ta;
            });

            updateStats(); applyFilters(); updateLastUpdate();
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('entriesGrid').style.display = 'grid';
            document.getElementById('paginationControls').style.display = 'flex';
        } catch (err) {
            console.error(err);
            document.getElementById('loadingState').innerHTML =
                `<div style="background:#fff1f2;color:#b91c1c;padding:23px;border-radius:12px;text-align:center;">
           ⚠️ Não foi possível carregar os dados agora.<br>
           <strong>Tente novamente em alguns minutos.</strong><br><br>
           Se o problema persistir, entre em contato conosco pelo WhatsApp:<br>
           <a href="https://wa.popsorte.vip" target="_blank" style="color:#dc2626;font-weight:bold;">💬 Falar com Suporte</a>
         </div>`;
        }
    }

    function updateStats() {
        const total = allEntries.length;
        const valid = allEntries.filter(e => e.status === 'VALID' || e.status === 'VALIDADO').length;
        const invalid = allEntries.filter(e => e.status === 'INVALID' || e.status === 'INVÁLIDO').length;
        const pending = allEntries.filter(e => !['VALID', 'VALIDADO', 'INVALID', 'INVÁLIDO'].includes(e.status)).length;
        document.getElementById('totalCount').textContent = total;
        document.getElementById('validCount').textContent = valid;
        document.getElementById('invalidCount').textContent = invalid;
        document.getElementById('pendingCount').textContent = pending;
    }
    function updateLastUpdate() {
        document.getElementById('lastUpdate').textContent = formatBrazilDateTime(getBrazilTime());
    }
    function applyFilters() {
        filteredEntries = allEntries;
        if (currentFilter !== 'all') {
            filteredEntries = filteredEntries.filter(e => normalizeStatus(e.status) === currentFilter);
        }
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredEntries = filteredEntries.filter(e =>
                e.gameId.toLowerCase().includes(term) ||
                (e.whatsapp || '').toLowerCase().includes(term)
            );
        }
        currentPage = 1;
        renderEntries();
    }
    function renderEntries() {
        const grid = document.getElementById('entriesGrid');
        grid.innerHTML = '';

        const start = (currentPage - 1) * perPage;
        const end = start + perPage;
        const pageEntries = filteredEntries.slice(start, end);

        if (pageEntries.length === 0) {
            grid.innerHTML = '<div class="empty-state">🔍 Nenhuma participação encontrada.<br>Tente ajustar filtros ou busca.</div>';
            updatePagination();
            return;
        }

        pageEntries.forEach(entry => {
            const statusClass = normalizeStatus(entry.status);
            const statusLabel = statusClass === 'valid' ? 'VÁLIDO' :
                statusClass === 'invalid' ? 'INVÁLIDO' :
                    'EM VERIFICAÇÃO';

            // Format numbers with ball styling
            const numsHTML = entry.numbers.map(num =>
                `<div class="number-badge ${getBallColorClass(num)}">
           <span class="number-text">${num.toString().padStart(2, '0')}</span>
         </div>`
            ).join('');

            // Format timestamp
            const formattedTime = formatBr(entry.parsedDate) || entry.timestamp || '—';

            // Create card element with neumorphism classes
            const card = document.createElement('div');
            card.className = `entry-card ${statusClass} neuro-card`;

            // Add data attributes for enhanced neumorphism effects
            card.setAttribute('data-status', statusClass);

            card.innerHTML = `
        <div class="entry-top">
          <div class="status-badge ${statusClass}">${statusLabel}</div>
          <div class="entry-id-block">
            <div class="entry-id-title">ID: ${entry.gameId}</div>
            <div class="entry-id-sub">${entry.bilheteNumber || '—'}</div>
          </div>
        </div>

        <div class="entry-meta neuro-meta">
          <div class="meta-left">
            <div class="detail-item">
              📱 <strong>${entry.whatsappMasked}</strong>
            </div>
            <div class="detail-item">
              🏢 <strong>${entry.platform || 'POPN1'}</strong>
            </div>
          </div>
          <div class="meta-right">
            <div class="detail-item">
              🎰 Concurso <strong>${entry.contest}</strong>
            </div>
            <div class="detail-item">
              📅 <strong>${entry.drawDate}</strong>
            </div>
          </div>
        </div>

        <div class="numbers-display neuro-numbers">
          ${numsHTML}
        </div>

        <div class="entry-timestamp neuro-timestamp">
          🕒 ${formattedTime}
        </div>
      `;

            grid.appendChild(card);
        });

        updatePagination();
    }
    function updatePagination() {
        const totalPages = Math.ceil(filteredEntries.length / perPage);
        document.getElementById('pageInfo').textContent = `Página ${currentPage} de ${totalPages} (${filteredEntries.length} resultados)`;
        document.getElementById('prevBtn').disabled = currentPage === 1;
        document.getElementById('nextBtn').disabled = currentPage >= totalPages;
    }

    if (document.querySelector('.vld-section')) {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                applyFilters();
            });
        });
        document.getElementById('searchBox').addEventListener('input', e => {
            searchTerm = e.target.value;
            applyFilters();
        });
        document.getElementById('prevBtn').addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderEntries(); }
        });
        document.getElementById('nextBtn').addEventListener('click', () => {
            const totalPages = Math.ceil(filteredEntries.length / perPage);
            if (currentPage < totalPages) { currentPage++; renderEntries(); }
        });
        document.getElementById('perPageSelect').addEventListener('change', e => {
            perPage = parseInt(e.target.value); currentPage = 1; renderEntries();
        });

        fetchEntries();
        setInterval(fetchEntries, 30000);
    }
})();

// Mobile Bottom Navigation
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        const navItems = document.querySelectorAll('.mobile-nav .nav-item');
        const sections = {
            'home': null, // home is default, hide others
            'rules': document.querySelector('.rules-section'),
            'search': document.querySelector('.vld-section'),
            'help': document.getElementById('verticalVideoSection'),
            'popluz': document.querySelector('.popluz-section')
        };

        // Function to show section
        function showSection(target) {
            // Hide all sections
            Object.values(sections).forEach(section => {
                if (section) section.style.display = 'none';
            });

            // Hide home-specific sections
            document.querySelector('.hero-section').style.display = 'none';
            document.querySelector('.selection-section').style.display = 'none';

            // Scroll to top for smooth transition
            window.scrollTo({ top: 0, behavior: 'smooth' });

            if (target === 'home') {
                // Show home sections
                document.querySelector('.hero-section').style.display = 'block';
                document.querySelector('.selection-section').style.display = 'block';
            } else {
                // Show target section
                if (sections[target]) {
                    sections[target].style.display = 'block';
                }
            }

            // Special handling for search
            if (target === 'search') {
                setTimeout(() => {
                    const searchBox = document.getElementById('searchBox');
                    if (searchBox) {
                        searchBox.focus();
                        searchBox.classList.add('highlighted');
                        setTimeout(() => {
                            searchBox.classList.remove('highlighted');
                        }, 2000);
                    }
                }, 100);
            }
        }

        navItems.forEach(item => {
            item.addEventListener('click', function (e) {
                e.preventDefault();
                const target = this.getAttribute('data-target');

                showSection(target);

                navItems.forEach(nav => nav.classList.remove('active'));
                this.classList.add('active');
            });
        });

        // Show home by default
        showSection('home');
    });
})();

// POPLUZ Slider and Countdown
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        const slider = document.getElementById('popluzSlider');
        const dotsContainer = document.getElementById('popluzDots');
        const countdownElement = document.querySelector('.popluz-coming-soon');

        if (!slider || !dotsContainer) return;

        const slides = slider.querySelectorAll('.popluz-slide');
        const totalSlides = slides.length;
        let currentSlide = 0;

        // Create dots
        slides.forEach((_, index) => {
            const dot = document.createElement('div');
            dot.className = 'dot';
            if (index === 0) dot.classList.add('active');
            dot.addEventListener('click', () => goToSlide(index));
            dotsContainer.appendChild(dot);
        });

        const dots = dotsContainer.querySelectorAll('.dot');

        function goToSlide(index) {
            currentSlide = index;
            slider.style.transform = `translateX(-${currentSlide * 100}%)`;
            updateDots();
        }

        function updateDots() {
            dots.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentSlide);
            });
        }

        function nextSlide() {
            currentSlide = (currentSlide + 1) % totalSlides;
            goToSlide(currentSlide);
        }

        // Auto slide every 4 seconds
        setInterval(nextSlide, 4000);

        // POPLUZ is now launched - no countdown needed
        // The countdown elements have been replaced with "JÁ DISPONÍVEL!" badge
    });
})();

// Anti-debugging protection
(function () {
    let devtoolsOpen = false;
    let secretKeyPressed = false;
    let secretKeyTimer;
    let qPressed = false;
    let twoPressed = false;

    // Function to show toast
    function showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      padding: 30px 60px;
      border-radius: 16px;
      font-weight: 900;
      font-size: 24px;
      z-index: 10001;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5), 0 0 20px rgba(16, 185, 129, 0.4);
      border: 3px solid rgba(255,255,255,0.3);
      animation: zoomInOut 2.5s ease-in-out;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 2px;
    `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 2500);
    }

    // Add toast animations to CSS if not present
    if (!document.querySelector('#toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
      @keyframes zoomInOut {
        0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
        15% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
        85% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
      }
    `;
        document.head.appendChild(style);
    }

    // Block right-click
    document.addEventListener('contextmenu', function (e) {
        if (!devtoolsOpen) {
            e.preventDefault();
        }
    });

    // Block keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        // Secret key: hold q + 2 for 2 seconds
        if (e.key === 'q' || e.key === 'Q') {
            qPressed = true;
        }
        if (e.key === '2') {
            twoPressed = true;
        }

        if (qPressed && twoPressed && !secretKeyPressed) {
            secretKeyPressed = true;
            secretKeyTimer = setTimeout(() => {
                devtoolsOpen = true;
                showToast('OK BOSKU GAS');
                qPressed = false;
                twoPressed = false;
                secretKeyPressed = false;
            }, 2000);
        }

        // Block dev tool shortcuts if not unlocked
        if (!devtoolsOpen) {
            if (
                e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
                (e.ctrlKey && e.key === 'U') ||
                (e.ctrlKey && e.key === 'S')
            ) {
                e.preventDefault();
                return false;
            }
        }
    });

    document.addEventListener('keyup', function (e) {
        if (e.key === 'q' || e.key === 'Q') {
            qPressed = false;
        }
        if (e.key === '2') {
            twoPressed = false;
        }

        if (secretKeyPressed && (!qPressed || !twoPressed)) {
            clearTimeout(secretKeyTimer);
            secretKeyPressed = false;
        }
    });

    // Detect dev tools open (basic detection)
    let threshold = 160;
    setInterval(() => {
        if (!devtoolsOpen && window.outerHeight - window.innerHeight > threshold || window.outerWidth - window.innerWidth > threshold) {
            // Dev tools might be open, but don't block unless shortcuts are used
        }
    }, 500);
})();