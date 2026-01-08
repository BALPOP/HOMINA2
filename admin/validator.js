class LotteryValidator {
    constructor() {
        this.contestResults = {};
        this.allowedValidStatuses = ['VALID', 'VALIDATED', 'VALIDADO']; // accepted "valid" states
        this.blockedPendingStatuses = ['GENERATED', 'PENDING', 'ALL PENDING']; // pending-like states
    }

    setResults(results) {
        this.contestResults = {};
        results.forEach(r => {
            const key = `${r.contest}_${r.drawDate}`;
            this.contestResults[key] = {
                contest: r.contest,
                drawDate: r.drawDate,
                winningNumbers: r.winningNumbers,
                savedAt: new Date().toISOString()
            };
        });
    }

    getContestResult(contest, drawDate) {
        const key = `${contest}_${drawDate}`;
        return this.contestResults[key];
    }

    getAllResults() {
        return Object.values(this.contestResults);
    }

    matchNumbers(chosenNumbers, winningNumbers) {
        let matches = 0;
        const matchedNumbers = [];
        chosenNumbers.forEach(num => {
            if (winningNumbers.includes(num)) {
                matches++;
                matchedNumbers.push(num);
            }
        });
        return { count: matches, matchedNumbers };
    }

    getPrizeTier(matchCount) {
        switch(matchCount) {
            case 5: return { tier: 'GRAND PRIZE', color: 'gold', priority: 1, badge: 'badge-gold' };
            case 4: return { tier: '2nd PRIZE', color: 'silver', priority: 2, badge: 'badge-silver' };
            case 3: return { tier: '3rd PRIZE', color: '#CD7F32', priority: 3, badge: 'badge-bronze' };
            case 2: return { tier: 'CONSOLATION', color: 'green', priority: 4, badge: 'badge-green' };
            default: return { tier: 'NO PRIZE', color: 'gray', priority: 5, badge: '' };
        }
    }

    validateEntry(entry) {
        // PRIORITY 1: Check validity from recharge validation
        // This is set by rechargeValidator.validateEntries()
        if (entry.validity) {
            const validity = entry.validity.toString().trim().toUpperCase();
            
            if (validity === 'INVALID') {
                return {
                    validated: false,
                    message: entry.invalidReasonCode
                        ? `Recharge validation failed: ${entry.invalidReasonCode}`
                        : 'Ticket failed recharge validation. Winner check not allowed.',
                    gate: 'RECHARGE_INVALID',
                    validity
                };
            }
            
            if (validity !== 'VALID') {
                return {
                    validated: false,
                    message: 'Ticket validity unknown. Winner check not allowed.',
                    gate: 'VALIDITY_UNKNOWN',
                    validity
                };
            }
            
            // validity === 'VALID' → proceed to winner check
        }
        
        // PRIORITY 2: Fallback to manual status check (if validity not set)
        // This is for backwards compatibility or manual overrides
        const statusRaw = entry.status || entry.csvStatus || '';
        const status = statusRaw.toString().trim().toUpperCase();

        // If status is INVALID, stop and return rejection info (no winner check).
        if (status === 'INVALID' || status === 'INVÁLIDO') {
            return {
                validated: false,
                message: entry.invalidReasonCode
                    ? `Ticket rejected: ${entry.invalidReasonCode}`
                    : 'Ticket status is INVALID. Winner check is not allowed.',
                gate: 'STATUS_INVALID',
                status
            };
        }

        // If not in allowed valid statuses, block winner checking.
        if (
            this.blockedPendingStatuses.includes(status) ||
            (status && !this.allowedValidStatuses.includes(status))
        ) {
            return {
                validated: false,
                message: 'Ticket is not validated. Winner check is not allowed.',
                gate: 'STATUS_NOT_VALIDATED',
                status
            };
        }

        // Status is valid → proceed.
        const result = this.getContestResult(entry.contest, entry.drawDate);
        if (!result) {
            return {
                validated: false,
                message: 'No winning numbers set for this contest'
            };
        }

        const matchResult = this.matchNumbers(entry.chosenNumbers, result.winningNumbers);
        const prizeTier = this.getPrizeTier(matchResult.count);

        return {
            validated: true,
            matches: matchResult.count,
            matchedNumbers: matchResult.matchedNumbers,
            prizeTier,
            winningNumbers: result.winningNumbers
        };
    }

    getWinningLevel(entries) {
        let highest = 0;
        entries.forEach(e => {
            if (e.validation && e.validation.validated) {
                highest = Math.max(highest, e.validation.matches);
            }
        });
        return highest;
    }

    getWinners(entries) {
        // Filter by status (manual approval in csvStatus field)
        const eligible = entries.filter(e => {
            const status = (e.status || '').toString().trim().toUpperCase();
            return this.allowedValidStatuses.includes(status);
        });

        // ⚠️ CRITICAL: Group by PLATFORM + CONTEST + DRAWDATE
        // Each platform has separate R$1000 prize pool!
        const grouped = {};
        eligible.forEach(entry => {
            const key = `${entry.platform}_${entry.contest}_${entry.drawDate}`;
            if (!grouped[key]) grouped[key] = [];
            const validation = this.validateEntry(entry);
            grouped[key].push({ ...entry, validation });
        });

        const winners = [];
        Object.values(grouped).forEach(group => {
            // Get HIGHEST match level in this platform_contest group
            const winningLevel = this.getWinningLevel(group);
            if (winningLevel === 0) return;
            
            // All entries with the highest match level share R$1000
            const levelWinners = group.filter(e => e.validation.validated && e.validation.matches === winningLevel);
            levelWinners.forEach(w => {
                winners.push({ ...w, winningLevel });
            });
        });

        return winners.sort((a, b) => {
            if (a.contest === b.contest) return b.validation.matches - a.validation.matches;
            return a.contest > b.contest ? 1 : -1;
        });
    }

    getWinnersByContest(entries, contest) {
        const contestEntries = entries.filter(e => e.contest === contest);
        return this.getWinners(contestEntries);
    }

    getWinnersReport(entries) {
        const winners = this.getWinners(entries);
        return {
            grandPrize: winners.filter(w => w.validation.matches === 5),
            secondPrize: winners.filter(w => w.validation.matches === 4),
            thirdPrize: winners.filter(w => w.validation.matches === 3),
            consolation: winners.filter(w => w.validation.matches === 2),
            totalWinners: winners.length
        };
    }
}

// Global instance
const validator = new LotteryValidator();
