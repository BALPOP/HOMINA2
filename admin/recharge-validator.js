const RECHARGE_SHEET_CSV_URLS = {
    POPLUZ: 'https://docs.google.com/spreadsheets/d/1H68xaO7xjR-o7ECklQT1oZkT7lkMj5FNydq3nVPimgM/export?format=csv&gid=0',
    POPN1: 'https://docs.google.com/spreadsheets/d/1KcIhrL3EvgdkgHAD-5E2jSK2W1mEZlJ9-D5DBGdxXRU/export?format=csv&gid=0'
};

const BRT_OFFSET_HOURS = 0; // No conversion, treat as wall time
const BRT_OFFSET_MS = BRT_OFFSET_HOURS * 60 * 60 * 1000;

function brtFields(date) {
    return {
        year: date.getFullYear(),
        month: date.getMonth(), // 0-based
        day: date.getDate(),
        weekday: date.getDay(), // 0=Sunday
    };
}

function makeDateFromBrt(year, month, day, hour = 0, minute = 0, second = 0) {
    return new Date(year, month, day, hour, minute, second);
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

        // No-draw holidays (extend as needed)
        this.noDrawHolidays = [
            '12-25', // Dec 25
            '01-01'  // Jan 1
        ];
    }

    async fetchRechargeData() {
        this.recharges = [];
        for (const [platform, url] of Object.entries(RECHARGE_SHEET_CSV_URLS)) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch recharge data for ${platform}`);
            }
            const csvText = await response.text();
            this.parseRechargeCSV(csvText, platform);
        }
        this.lastFetchTime = new Date();
        return this.recharges;
    }

    // ---------- Draw / cutoff helpers (BRT, merged windows) ----------

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
            return { hour: 16, minute: 0, second: 0 };
        }
        return { hour: 20, minute: 0, second: 0 };
    }

    buildCutoffDateTime(dateObj) {
        const f = brtFields(dateObj);
        const { hour, minute, second } = this.getCutoffTime(dateObj);
        return makeDateFromBrt(f.year, f.month, f.day, hour, minute, second);
    }

    // Find the first draw day whose cutoff is > given time
    firstDrawDayAfter(timeObj) {
        let probe = startOfDayBrt(timeObj);
        for (let i = 0; i < 60; i++) {
            if (!this.isNoDrawDay(probe)) {
                const cutoff = this.buildCutoffDateTime(probe);
                if (cutoff > timeObj) {
                    return startOfDayBrt(probe);
                }
            }
            probe = addDaysBrt(probe, 1);
        }
        return null;
    }

    // Find the draw day for a ticket time T: first draw day with cutoff >= ticket timestamp (Rule B)
    ticketDrawDay(ticketTime) {
        let probe = startOfDayBrt(ticketTime);
        for (let i = 0; i < 60; i++) { // safety horizon
            if (!this.isNoDrawDay(probe)) {
                const cutoff = this.buildCutoffDateTime(probe);
                if (cutoff >= ticketTime) {
                    return {
                        day: startOfDayBrt(probe),
                        cutoff
                    };
                }
            }
            probe = addDaysBrt(probe, 1);
        }
        return null;
    }

    // Given a recharge time R, find EligibleDraw1 (hari recharge) dan EligibleDraw2 (hari draw berikutnya)
    computeEligibleDraws(rechargeTimeObj) {
        if (!rechargeTimeObj) return null;

        // Eligible 1: hari recharge (jika no-draw, maju ke hari draw berikutnya)
        let eligible1Day = startOfDayBrt(rechargeTimeObj);
        for (let i = 0; i < 60 && this.isNoDrawDay(eligible1Day); i++) {
            eligible1Day = addDaysBrt(eligible1Day, 1);
        }
        const eligible1Cutoff = this.buildCutoffDateTime(eligible1Day);

        // Eligible 2: hari draw setelah eligible1 (skip no-draw)
        let eligible2Day = addDaysBrt(eligible1Day, 1);
        for (let i = 0; i < 60 && this.isNoDrawDay(eligible2Day); i++) {
            eligible2Day = addDaysBrt(eligible2Day, 1);
        }
        const eligible2Cutoff = this.buildCutoffDateTime(eligible2Day);

        return {
            eligible1: { day: eligible1Day, cutoff: eligible1Cutoff },
            eligible2: { day: eligible2Day, cutoff: eligible2Cutoff }
        };
    }

    // ---------- CSV parsing ----------
    parseRechargeCSV(csvText, platform) {
        const lines = csvText.split('\n');
        const recharges = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const values = this.parseCSVLine(line);
            if (values.length < 6) continue;

            const dateStr = values[0].trim();
            const timeStr = values[1].trim();
            const memberId = values[2].trim();
            const orderNumber = values[3].trim();
            const changeAmount = parseFloat(values[4]);
            const balanceAfter = parseFloat(values[5]);

            if (!dateStr || !timeStr || isNaN(changeAmount)) continue;

            const rechargeTimeStr = `${dateStr} ${timeStr}`;
            const rechargeTimeObj = DateUtils.parseWeekdayDate(rechargeTimeStr);
            if (!rechargeTimeObj) continue; // Reject invalid

            const recharge = {
                platform: platform,
                memberId: memberId,
                gameId: memberId,  // Store memberId as gameId for validation matching
                orderNumber: orderNumber,
                rechargeId: orderNumber,  // Use orderNumber as unique ID
                rechargeTime: DateUtils.normalizeToYYYYMMDDHHMMSS(rechargeTimeObj),
                rechargeAmount: changeAmount,
                balanceAfter: balanceAfter,
                rechargeTimeObj: rechargeTimeObj,
                rechargeStatus: 'VALID'
            };
            recharges.push(recharge);
        }
        this.recharges.push(...recharges);
        return recharges;
    }

    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    }

    // --------- build Date in BRT wall time, avoid double offsets ---------
    parseBrazilTime(timeString) {
        try {
            if (!timeString || typeof timeString !== 'string') return null;
            const m = timeString.trim().match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{4})\s+([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/);
            if (!m) return null;
            const d = parseInt(m[1], 10);
            const mon = parseInt(m[2], 10) - 1;
            const y = parseInt(m[3], 10);
            const hh = parseInt(m[4], 10);
            const mm = parseInt(m[5], 10);
            const ss = parseInt(m[6] || '0', 10);
            if ([d, mon, y, hh, mm, ss].some(v => Number.isNaN(v))) return null;
            return makeDateFromBrt(y, mon, d, hh, mm, ss);
        } catch {
            return null;
        }
    }

    // Parse normalized YYYY-MM-DD HH:MM:SS
    parseTicketTime(timeString) {
        return DateUtils.parseISO(timeString);
    }

    // ---------- Core validation (Rule B, merged windows) ----------
    validateEntries(entries) {
        if (this.recharges.length === 0) {
            console.warn('No recharge data loaded. Upload recharge CSV first.');
            return entries.map(entry => ({
                ...entry,
                validity: 'UNKNOWN',
                invalidReasonCode: 'NO_RECHARGE_DATA',
                boundRechargeId: null
            }));
        }

        console.log('🔍 VALIDATION START');
        console.log('📊 Total entries:', entries.length);
        console.log('💳 Total recharges:', this.recharges.length);

        // ⚠️ CRITICAL: Group recharges by PLATFORM + GAMEID (composite key)
        // Prevents POPLUZ entries from matching POPN1 recharges!
        const rechargesByKey = {};
        this.recharges.forEach(r => {
            const key = `${r.platform}_${r.gameId}`;
            if (!rechargesByKey[key]) rechargesByKey[key] = [];
            rechargesByKey[key].push(r);
        });
        console.log('👥 Unique platform_gameId keys in recharges:', Object.keys(rechargesByKey).length);
        console.log('📋 Platform breakdown:', {
            POPLUZ: this.recharges.filter(r => r.platform === 'POPLUZ').length,
            POPN1: this.recharges.filter(r => r.platform === 'POPN1').length
        });
        
        Object.values(rechargesByKey).forEach(list =>
            list.sort((a, b) => (a.rechargeTimeObj?.getTime() || 0) - (b.rechargeTimeObj?.getTime() || 0))
        );

        // ⚠️ CRITICAL: Group entries by PLATFORM + GAMEID (composite key)
        const entriesByKey = {};
        entries.forEach(e => {
            const key = `${e.platform}_${e.gameId}`;
            if (!entriesByKey[key]) entriesByKey[key] = [];
            e.ticketTimeObj = this.parseTicketTime(e.registrationDateTime);
            entriesByKey[key].push(e);
        });
        console.log('👥 Unique platform_gameId keys in entries:', Object.keys(entriesByKey).length);
        console.log('📋 Platform breakdown:', {
            POPLUZ: entries.filter(e => e.platform === 'POPLUZ').length,
            POPN1: entries.filter(e => e.platform === 'POPN1').length
        });
        console.log('🔗 Matched keys (both entries AND recharges):', Object.keys(entriesByKey).filter(key => rechargesByKey[key]).length);
        
        Object.values(entriesByKey).forEach(list =>
            list.sort((a, b) => (a.ticketTimeObj?.getTime() || 0) - (b.ticketTimeObj?.getTime() || 0))
        );

        const validated = [];

        Object.keys(entriesByKey).forEach(key => {
            const tickets = entriesByKey[key];
            const userRecharges = rechargesByKey[key] || [];
            const consumed = new Set();

            // Precompute windows per recharge
            const rechargeWindows = userRecharges.map(r => ({
                recharge: r,
                windows: this.computeEligibleDraws(r.rechargeTimeObj)
            }));

            tickets.forEach(ticket => {
                let validity = 'INVALID';
                let reason = 'NO_ELIGIBLE_RECHARGE';
                let bound = null;
                let cutoffFlag = false;

                if (!ticket.ticketTimeObj) {
                    validity = 'INVALID';
                    reason = 'INVALID_TICKET_TIME';
                    validated.push(this._result(ticket, validity, reason, bound, cutoffFlag));
                    return;
                }

                const t = ticket.ticketTimeObj;
                const drawInfo = this.ticketDrawDay(t);
                if (!drawInfo) {
                    validity = 'INVALID';
                    reason = 'NO_ELIGIBLE_RECHARGE';
                    validated.push(this._result(ticket, validity, reason, bound, cutoffFlag));
                    return;
                }
                const ticketDrawDay = drawInfo.day;

                // Determine if there exists ANY recharge before this ticket
                const hasRechargeBefore = userRecharges.some(r => r.rechargeTimeObj && t > r.rechargeTimeObj);

                let foundMatch = false;
                let expiredCandidate = false;
                let consumedCandidate = false;

                for (const { recharge, windows } of rechargeWindows) {
                    if (!windows) continue;
                    const rt = recharge.rechargeTimeObj;
                    if (!rt) continue;

                    const sameDayBrt = (a, b) => {
                        const fa = brtFields(a);
                        const fb = brtFields(b);
                        return fa.year === fb.year && fa.month === fb.month && fa.day === fb.day;
                    };

                    const isEligible1 = sameDayBrt(ticketDrawDay, windows.eligible1.day);
                    const isEligible2 = sameDayBrt(ticketDrawDay, windows.eligible2.day);

                    // Ticket must be after recharge time
                    if (t <= rt) {
                        continue; // do not mark before-recharge here; handled after loop
                    }

                    if (!(isEligible1 || isEligible2)) {
                        if (ticketDrawDay > windows.eligible2.day) expiredCandidate = true;
                        continue;
                    }

                    if (consumed.has(recharge.rechargeId)) {
                        consumedCandidate = true;
                        continue;
                    }

                    // Passed all checks
                    foundMatch = true;
                    bound = recharge;
                    validity = recharge.rechargeStatus === 'VALID' ? 'VALID' : 'INVALID';
                    reason = recharge.rechargeStatus === 'VALID' ? null : 'RECHARGE_INVALIDATED';
                    consumed.add(recharge.rechargeId);
                    if (isEligible2) cutoffFlag = true; // using second eligible day
                    break;
                }

                if (!foundMatch) {
                    if (!hasRechargeBefore) {
                        reason = 'INVALID_TICKET_BEFORE_RECHARGE';
                    } else if (expiredCandidate) {
                        reason = 'INVALID_RECHARGE_WINDOW_EXPIRED';
                    } else if (consumedCandidate) {
                        reason = 'INVALID_NOT_FIRST_TICKET_AFTER_RECHARGE';
                    } else {
                        reason = 'NO_ELIGIBLE_RECHARGE';
                    }
                }

                validated.push(this._result(ticket, validity, reason, bound, cutoffFlag));
            });
        });

        this.validatedEntries = validated;
        return validated;
    }

    _result(ticket, validity, reason, bound, cutoffFlag) {
        return {
            ...ticket,
            validity,
            invalidReasonCode: reason,
            boundRechargeId: bound?.rechargeId || null,
            boundRechargeTime: bound?.rechargeTime || null,
            boundRechargeAmount: bound?.rechargeAmount || null,
            cutoffFlag
        };
    }

    getReasonCodeText(code) {
        const reasons = {
            'NO_RECHARGE_DATA': 'No recharge data uploaded',
            'NO_ELIGIBLE_RECHARGE': 'No recharge window covers this ticket',
            'INVALID_TICKET_BEFORE_RECHARGE': 'Ticket time is before or equal to recharge time',
            'INVALID_NOT_FIRST_TICKET_AFTER_RECHARGE': 'Recharge already consumed by a previous ticket',
            'INVALID_RECHARGE_WINDOW_EXPIRED': 'Recharge expired after its second eligible draw day',
            'RECHARGE_INVALIDATED': 'Bound recharge was invalidated',
            'INVALID_TICKET_TIME': 'Ticket registration time could not be parsed'
        };
        return reasons[code] || 'Unknown reason';
    }

    getStatistics() {
        const validCount = this.validatedEntries.filter(e => e.validity === 'VALID').length;
        const invalidCount = this.validatedEntries.filter(e => e.validity === 'INVALID').length;
        const unknownCount = this.validatedEntries.filter(e => e.validity === 'UNKNOWN').length;
        const cutoffFlagCount = this.validatedEntries.filter(e => e.cutoffFlag).length;

        const reasonCounts = {};
        this.validatedEntries.forEach(e => {
            if (e.invalidReasonCode) {
                reasonCounts[e.invalidReasonCode] = (reasonCounts[e.invalidReasonCode] || 0) + 1;
            }
        });

        return {
            totalRecharges: this.recharges.length,
            validTickets: validCount,
            invalidTickets: invalidCount,
            unknownTickets: unknownCount,
            cutoffShiftCases: cutoffFlagCount,
            invalidReasons: reasonCounts
        };
    }

    getValidatedEntries() {
        return this.validatedEntries;
    }

    getRecharges() {
        return this.recharges;
    }
}

// Global instance
const rechargeValidator = new RechargeValidator();
