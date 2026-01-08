/**
 * POP-SORTE Admin Dashboard - Recharge Validator Module
 * 
 * This module handles ticket validation against recharge data.
 * 
 * Validation Rules:
 * 1. Ticket must be created AFTER recharge timestamp
 * 2. Ticket must be created BY 20:00 BRT on eligible2 (window expiry)
 * 3. Ticket's CSV drawDate must match eligible1 or eligible2
 * 4. Each recharge can only be used once (first ticket after recharge)
 * 5. Cutoff time 20:00 BRT (16:00 on Dec 24/31) determines draw day shift
 * 6. No draws on Sundays and holidays (Dec 25, Jan 1)
 * 
 * Dependencies: admin-core.js (AdminCore), data-fetcher.js (DataFetcher)
 */

// ============================================
// Recharge Validator Module
// ============================================
window.RechargeValidator = (function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    
    /**
     * Default cutoff hour for same-day draws (20:00 BRT)
     */
    const DEFAULT_CUTOFF_HOUR = 20;
    
    /**
     * Early cutoff hour for special days (Dec 24, Dec 31)
     */
    const EARLY_CUTOFF_HOUR = 16;
    
    /**
     * Validation result statuses
     */
    const ValidationStatus = {
        VALID: 'VALID',
        INVALID: 'INVALID',
        UNKNOWN: 'UNKNOWN',
        CUTOFF: 'CUTOFF'
    };

    // ============================================
    // Draw Calendar Helpers
    // ============================================
    
    /**
     * Check if a date is a no-draw day (Sunday, Dec 25, Jan 1)
     * @param {Date} date - Date to check
     * @returns {boolean} True if no draw on this day
     */
    function isNoDrawDay(date) {
        const month = date.getMonth(); // 0-indexed
        const day = date.getDate();
        const dayOfWeek = date.getDay();
        
        // Sunday
        if (dayOfWeek === 0) return true;
        
        // Christmas (Dec 25)
        if (month === 11 && day === 25) return true;
        
        // New Year (Jan 1)
        if (month === 0 && day === 1) return true;
        
        return false;
    }

    /**
     * Check if a date has early cutoff (Dec 24, Dec 31)
     * @param {Date} date - Date to check
     * @returns {boolean} True if early cutoff applies
     */
    function isEarlyCutoffDay(date) {
        const month = date.getMonth();
        const day = date.getDate();
        
        // Dec 24 or Dec 31
        return month === 11 && (day === 24 || day === 31);
    }

    /**
     * Get cutoff hour for a specific date
     * @param {Date} date - Date to check
     * @returns {number} Cutoff hour (16 or 20)
     */
    function getCutoffHour(date) {
        return isEarlyCutoffDay(date) ? EARLY_CUTOFF_HOUR : DEFAULT_CUTOFF_HOUR;
    }

    /**
     * Get next valid draw date from a given date
     * @param {Date} fromDate - Starting date
     * @returns {Date} Next valid draw date
     */
    function getNextValidDrawDate(fromDate) {
        const probe = new Date(fromDate);
        probe.setHours(0, 0, 0, 0);
        
        // Check up to 14 days ahead
        for (let i = 0; i < 14; i++) {
            if (i > 0) {
                probe.setDate(probe.getDate() + 1);
            }
            
            if (!isNoDrawDay(probe)) {
                return new Date(probe);
            }
        }
        
        throw new Error('No valid draw date found in range');
    }

    /**
     * Calculate eligibility window for a recharge with proper cutoff logic
     * @param {Date} rechargeTime - When the recharge occurred
     * @returns {Object|null} {eligible1: Date, eligible2: Date, expiresAt: Date, isCutoff: boolean}
     */
    function calculateEligibilityWindow(rechargeTime) {
        if (!rechargeTime || !(rechargeTime instanceof Date) || isNaN(rechargeTime.getTime())) {
            return null;
        }
        
        // Determine if recharge was after 8 PM cutoff
        const rechargeHour = rechargeTime.getHours();
        const isCutoff = rechargeHour >= 20; // After 8 PM (20:00)
        
        // Get recharge calendar date
        const rechargeDateStr = AdminCore.getBrazilDateString(rechargeTime);
        if (!rechargeDateStr) return null;
        
        const rechargeDate = new Date(`${rechargeDateStr}T00:00:00-03:00`);
        
        // Calculate Day 1 and Day 2 based on cutoff
        let day1, day2;
        
        if (isCutoff) {
            // After 8 PM: Day 1 = NEXT DAY, Day 2 = DAY AFTER NEXT
            day1 = new Date(rechargeDate);
            day1.setDate(day1.getDate() + 1);
            
            day2 = new Date(day1);
            day2.setDate(day2.getDate() + 1);
        } else {
            // Before 8 PM: Day 1 = SAME DAY, Day 2 = NEXT DAY
            day1 = new Date(rechargeDate);
            
            day2 = new Date(day1);
            day2.setDate(day2.getDate() + 1);
        }
        
        // Skip holidays/Sundays for Day 1
        const finalDay1 = isNoDrawDay(day1) ? getNextValidDrawDate(day1) : day1;
        
        // Skip holidays/Sundays for Day 2
        const tempDay2 = new Date(finalDay1);
        tempDay2.setDate(tempDay2.getDate() + 1);
        const finalDay2 = isNoDrawDay(tempDay2) ? getNextValidDrawDate(tempDay2) : tempDay2;
        
        // Window expires at 8 PM on Day 2
        const expiresAt = new Date(finalDay2);
        expiresAt.setHours(20, 0, 0, 0);
        
        return {
            eligible1: finalDay1,
            eligible2: finalDay2,
            expiresAt: expiresAt,
            isCutoff: isCutoff,
            rechargeTime: rechargeTime
        };
    }

    /**
     * Check if ticket was created within the eligibility window
     * @param {Date} ticketTime - When ticket was created
     * @param {Date} expiresAt - Window expiration time
     * @returns {boolean} True if ticket is within window
     */
    function isTicketInWindow(ticketTime, expiresAt) {
        if (!ticketTime || !expiresAt) return false;
        return ticketTime.getTime() < expiresAt.getTime();
    }

    /**
     * Normalize draw date string to YYYY-MM-DD format
     * @param {string} drawDate - Draw date in various formats
     * @returns {string} Normalized date string or empty string
     */
    function normalizeDrawDate(drawDate) {
        if (!drawDate) return '';
        
        const parts = drawDate.split(/[\/\-]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                // Already YYYY-MM-DD
                return drawDate;
            } else {
                // DD/MM/YYYY -> YYYY-MM-DD
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        return '';
    }

    // ============================================
    // Recharge Matching
    // ============================================
    
    /**
     * Find matching recharge for a ticket with strict one-recharge-one-ticket binding
     * @param {Object} ticket - Ticket entry object
     * @param {Object[]} recharges - All recharges for this game ID (sorted chronologically)
     * @param {Object[]} allTickets - All tickets for this game ID (sorted chronologically)
     * @returns {Object|null} Matched recharge with eligibility info, or null
     */
    function findMatchingRecharge(ticket, recharges, allTickets) {
        // Validate inputs
        if (!ticket.parsedDate || !(ticket.parsedDate instanceof Date) || isNaN(ticket.parsedDate.getTime())) {
            return null;
        }
        if (!recharges || recharges.length === 0) {
            return null;
        }
        
        const ticketTime = ticket.parsedDate;
        const ticketDrawDateStr = normalizeDrawDate(ticket.drawDate);
        
        // Filter recharges created BEFORE ticket
        const eligibleRecharges = recharges.filter(r => {
            if (!r.rechargeTime || !(r.rechargeTime instanceof Date) || isNaN(r.rechargeTime.getTime())) {
                return false;
            }
            return r.rechargeTime.getTime() < ticketTime.getTime();
        });
        
        if (eligibleRecharges.length === 0) {
            return null;
        }
        
        // Sort chronologically (oldest first - FIFO consumption)
        eligibleRecharges.sort((a, b) => a.rechargeTime.getTime() - b.rechargeTime.getTime());
        
        // Try each recharge in order
        for (const recharge of eligibleRecharges) {
            // Calculate eligibility window
            const window = calculateEligibilityWindow(recharge.rechargeTime);
            if (!window) continue;
            
            // Check 1: Is ticket within the eligibility window?
            if (ticketTime.getTime() >= window.expiresAt.getTime()) {
                continue; // Ticket created after window expired
            }
            
            // Check 2: Does ticket's drawDate match Day 1 or Day 2?
            const day1Str = AdminCore.getBrazilDateString(window.eligible1);
            const day2Str = AdminCore.getBrazilDateString(window.eligible2);
            
            const matchesDay1 = ticketDrawDateStr === day1Str;
            const matchesDay2 = ticketDrawDateStr === day2Str;
            
            if (!matchesDay1 && !matchesDay2) {
                continue; // Draw date doesn't match eligibility
            }
            
            // Check 3: Is this recharge already consumed by a prior ticket?
            const rechargeConsumed = allTickets.some(priorTicket => {
                // Skip self
                if (priorTicket.ticketNumber === ticket.ticketNumber) return false;
                
                // Skip tickets without valid date
                if (!priorTicket.parsedDate || !(priorTicket.parsedDate instanceof Date)) return false;
                
                const priorTime = priorTicket.parsedDate.getTime();
                
                // Only check tickets created BETWEEN recharge and current ticket
                if (priorTime <= recharge.rechargeTime.getTime()) return false;
                if (priorTime >= ticketTime.getTime()) return false;
                
                // Check if prior ticket's drawDate matches this recharge's eligibility
                const priorDrawDateStr = normalizeDrawDate(priorTicket.drawDate);
                return (priorDrawDateStr === day1Str || priorDrawDateStr === day2Str);
            });
            
            if (rechargeConsumed) {
                continue; // This recharge was already bound to an earlier ticket
            }
            
            // ✅ MATCH FOUND! Bind this recharge to this ticket
            return {
                ...recharge,
                eligible1: window.eligible1,
                eligible2: window.eligible2,
                expiresAt: window.expiresAt,
                isDay2: matchesDay2,
                isCutoff: window.isCutoff
            };
        }
        
        // No valid match found
        return null;
    }

    // ============================================
    // Ticket Validation
    // ============================================
    
    /**
     * Validate a single ticket against recharge data
     * @param {Object} ticket - Ticket entry object
     * @param {Object[]} rechargesByGameId - Map of game ID to recharges
     * @param {Object[]} ticketsByGameId - Map of game ID to tickets
     * @returns {Object} Validation result
     */
    function validateTicket(ticket, rechargesByGameId, ticketsByGameId) {
        const result = {
            ticket: ticket,
            status: ValidationStatus.UNKNOWN,
            reason: '',
            matchedRecharge: null,
            isDay2: false,
            isCutoff: false  // DEPRECATED - kept for backwards compatibility
        };
        
        // Check if ticket already has a valid status
        const existingStatus = (ticket.status || '').toUpperCase();
        if (['VALID', 'VALIDADO', 'VALIDATED'].includes(existingStatus)) {
            result.status = ValidationStatus.VALID;
            result.reason = 'Pre-validated in source data';
            return result;
        }
        
        if (['INVALID', 'INVÁLIDO'].includes(existingStatus)) {
            result.status = ValidationStatus.INVALID;
            result.reason = 'Marked invalid in source data';
            return result;
        }
        
        // Get recharges for this game ID
        const gameId = ticket.gameId;
        if (!gameId) {
            result.status = ValidationStatus.INVALID;
            result.reason = 'Missing Game ID';
            return result;
        }
        
        const recharges = rechargesByGameId[gameId] || [];
        const tickets = ticketsByGameId[gameId] || [];
        
        if (recharges.length === 0) {
            result.status = ValidationStatus.INVALID;
            result.reason = 'No recharge found for Game ID';
            return result;
        }
        
        // Check if ticket was created before any recharge
        if (ticket.parsedDate && ticket.parsedDate instanceof Date && !isNaN(ticket.parsedDate.getTime())) {
            const hasRechargeBeforeTicket = recharges.some(r => 
                r.rechargeTime && 
                r.rechargeTime instanceof Date && 
                !isNaN(r.rechargeTime.getTime()) &&
                r.rechargeTime.getTime() < ticket.parsedDate.getTime()
            );
            
            if (!hasRechargeBeforeTicket) {
                result.status = ValidationStatus.INVALID;
                result.reason = 'Ticket created before any recharge';
                return result;
            }
        }
        
        // Try to find matching recharge
        const matchedRecharge = findMatchingRecharge(ticket, recharges, tickets);
        
        if (matchedRecharge) {
            result.status = ValidationStatus.VALID;
            result.isDay2 = matchedRecharge.isDay2 || false;
            result.reason = matchedRecharge.isDay2 
                ? `Matched recharge R$${matchedRecharge.amount || '?'} (Day 2)`
                : `Matched recharge R$${matchedRecharge.amount || '?'}`;
            result.matchedRecharge = {
                gameId: matchedRecharge.gameId,
                amount: matchedRecharge.amount,
                rechargeTime: matchedRecharge.rechargeTime,
                rechargeId: matchedRecharge.rechargeId,
                eligible1: matchedRecharge.eligible1,
                eligible2: matchedRecharge.eligible2
            };
        } else {
            result.status = ValidationStatus.INVALID;
            
            // Provide more specific reason
            if (ticket.parsedDate && ticket.parsedDate instanceof Date) {
                // Check if window expired
                const anyWindow = recharges
                    .filter(r => r.rechargeTime && r.rechargeTime.getTime() < ticket.parsedDate.getTime())
                    .map(r => calculateEligibilityWindow(r.rechargeTime))
                    .filter(w => w !== null);
                
                if (anyWindow.length > 0) {
                    const ticketIsAfterAllWindows = anyWindow.every(w => 
                        ticket.parsedDate.getTime() >= w.expiresAt.getTime()
                    );
                    
                    if (ticketIsAfterAllWindows) {
                        result.reason = 'Recharge window expired after 20:00 on eligible2';
                    } else {
                        result.reason = 'Recharge already consumed by previous ticket';
                    }
                } else {
                    result.reason = 'No valid recharge window available';
                }
            } else {
                result.reason = 'Invalid ticket timestamp';
            }
        }
        
        return result;
    }

    /**
     * Validate all tickets with caching
     * @param {Object[]} entries - All entry objects
     * @param {Object[]} recharges - All recharge objects
     * @param {boolean} skipCache - Skip cache check (for platform-filtered data)
     * @returns {Object} Validation results with statistics
     */
    async function validateAllTickets(entries, recharges, skipCache = false) {
        // Check cache first (only for ALL platform data, not filtered)
        if (!skipCache) {
            const cached = DataFetcher.getCachedValidation();
            if (cached && cached.stats.total === entries.length && cached.entriesCount === entries.length) {
                console.log('Using cached validation results');
                return cached;
            }
        }
        
        console.log('Computing validation results for', entries.length, 'entries with', recharges.length, 'recharges...');
        
        // Debug: Sample some recharge data
        if (recharges.length > 0) {
            const sample = recharges[0];
            console.log('Sample recharge:', {
                gameId: sample.gameId,
                rechargeId: sample.rechargeId?.substring(0, 20) + '...',
                hasTime: !!sample.rechargeTime,
                isDate: sample.rechargeTime instanceof Date,
                amount: sample.amount
            });
        }
        
        // Group recharges by game ID
        const rechargesByGameId = {};
        recharges.forEach(r => {
            if (!r.gameId) return;
            if (!rechargesByGameId[r.gameId]) {
                rechargesByGameId[r.gameId] = [];
            }
            rechargesByGameId[r.gameId].push(r);
        });
        
        console.log('Recharges grouped for', Object.keys(rechargesByGameId).length, 'unique game IDs');
        
        // Group tickets by game ID
        const ticketsByGameId = {};
        entries.forEach(e => {
            if (!e.gameId) return;
            if (!ticketsByGameId[e.gameId]) {
                ticketsByGameId[e.gameId] = [];
            }
            ticketsByGameId[e.gameId].push(e);
        });
        
        // Validate each ticket
        const results = [];
        const stats = {
            total: entries.length,
            valid: 0,
            invalid: 0,
            unknown: 0,
            day2Valid: 0,
            cutoff: 0  // DEPRECATED - kept for backwards compatibility
        };
        
        // Process in smaller batches to keep UI responsive
        const batchSize = 50;
        const totalBatches = Math.ceil(entries.length / batchSize);
        
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            
            for (const entry of batch) {
                const validation = validateTicket(entry, rechargesByGameId, ticketsByGameId);
                results.push(validation);
                
                switch (validation.status) {
                    case ValidationStatus.VALID:
                        stats.valid++;
                        if (validation.isDay2) {
                            stats.day2Valid++;
                        }
                        break;
                    case ValidationStatus.INVALID:
                        stats.invalid++;
                        break;
                    default:
                        stats.unknown++;
                }
                
                // DEPRECATED - kept for backwards compatibility
                if (validation.isCutoff) {
                    stats.cutoff++;
                }
            }
            
            // Yield to main thread after each batch - use longer delay for UI responsiveness
            if (i + batchSize < entries.length) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        const result = {
            results,
            stats,
            rechargeCount: recharges.length
        };
        
        console.log('Validation complete:', stats);
        console.log('Sample validated tickets (first 3 VALID):', 
            results.filter(v => v.status === 'VALID').slice(0, 3).map(v => ({
                ticket: v.ticket?.ticketNumber,
                gameId: v.ticket?.gameId,
                hasRecharge: !!v.matchedRecharge,
                amount: v.matchedRecharge?.amount
            }))
        );
        
        // Cache the results
        DataFetcher.setCachedValidation(result);
        
        return result;
    }

    // ============================================
    // Engagement Analysis
    // ============================================
    
    /**
     * Analyze engagement between rechargers and ticket creators
     * @param {Object[]} entries - All entries
     * @param {Object[]} recharges - All recharges
     * @returns {Object} Engagement statistics
     */
    function analyzeEngagement(entries, recharges) {
        // Get unique game IDs
        const rechargerIds = new Set(recharges.map(r => r.gameId).filter(Boolean));
        const ticketCreatorIds = new Set(entries.map(e => e.gameId).filter(Boolean));
        
        // Calculate overlaps
        const participantIds = new Set(
            [...ticketCreatorIds].filter(id => rechargerIds.has(id))
        );
        
        const rechargedNoTicket = new Set(
            [...rechargerIds].filter(id => !ticketCreatorIds.has(id))
        );
        
        // Multi-recharge analysis
        const rechargeCounts = {};
        recharges.forEach(r => {
            if (!r.gameId) return;
            rechargeCounts[r.gameId] = (rechargeCounts[r.gameId] || 0) + 1;
        });
        
        const multiRechargers = Object.entries(rechargeCounts)
            .filter(([_, count]) => count > 1)
            .map(([id, _]) => id);
        
        const multiRechargeNoTicket = multiRechargers.filter(id => !ticketCreatorIds.has(id));
        
        return {
            totalRechargers: rechargerIds.size,
            totalParticipants: participantIds.size,
            rechargedNoTicket: rechargedNoTicket.size,
            participationRate: rechargerIds.size > 0 
                ? ((participantIds.size / rechargerIds.size) * 100).toFixed(1)
                : 0,
            multiRechargeNoTicket: multiRechargeNoTicket.length,
            rechargerIds: [...rechargerIds],
            participantIds: [...participantIds],
            rechargedNoTicketIds: [...rechargedNoTicket]
        };
    }

    /**
     * Analyze engagement by date
     * @param {Object[]} entries - All entries
     * @param {Object[]} recharges - All recharges
     * @param {number} days - Number of days to analyze
     * @returns {Object[]} Daily engagement data
     */
    function analyzeEngagementByDate(entries, recharges, days = 7) {
        const dailyData = [];
        const now = AdminCore.getBrazilTime();
        
        // Pre-compute date strings for all entries (optimization)
        const entriesByDate = new Map();
        entries.forEach(e => {
            if (e.parsedDate && e.parsedDate instanceof Date && !isNaN(e.parsedDate.getTime())) {
                const dateStr = AdminCore.getBrazilDateString(e.parsedDate);
                if (dateStr) {
                    if (!entriesByDate.has(dateStr)) {
                        entriesByDate.set(dateStr, []);
                    }
                    entriesByDate.get(dateStr).push(e);
                }
            }
        });
        
        // Pre-compute date strings for all recharges (optimization)
        const rechargesByDate = new Map();
        recharges.forEach(r => {
            if (r.rechargeTime && r.rechargeTime instanceof Date && !isNaN(r.rechargeTime.getTime())) {
                const dateStr = AdminCore.getBrazilDateString(r.rechargeTime);
                if (dateStr) {
                    if (!rechargesByDate.has(dateStr)) {
                        rechargesByDate.set(dateStr, []);
                    }
                    rechargesByDate.get(dateStr).push(r);
                }
            }
        });
        
        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = AdminCore.getBrazilDateString(date);
            
            // Use pre-computed maps instead of filtering entire arrays each time
            const dayEntries = entriesByDate.get(dateStr) || [];
            const dayRecharges = rechargesByDate.get(dateStr) || [];
            
            const engagement = analyzeEngagement(dayEntries, dayRecharges);
            
            dailyData.push({
                date: dateStr,
                displayDate: AdminCore.formatBrazilDateTime(date, {
                    day: '2-digit',
                    month: '2-digit'
                }),
                totalEntries: dayEntries.length,
                ...engagement
            });
        }
        
        return dailyData;
    }

    // ============================================
    // Public API
    // ============================================
    return {
        // Validation
        validateTicket,
        validateAllTickets,
        
        // Engagement
        analyzeEngagement,
        analyzeEngagementByDate,
        
        // Draw calendar helpers
        isNoDrawDay,
        isEarlyCutoffDay,
        getCutoffHour,
        getNextValidDrawDate,
        calculateEligibilityWindow,
        
        // Constants
        ValidationStatus,
        DEFAULT_CUTOFF_HOUR,
        EARLY_CUTOFF_HOUR
    };
})();

