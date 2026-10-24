import { db } from './firebase-config.js?v=37';
import { ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Standard European Roulette Sequence (37 Pockets)
export const ROULETTE_NUMBERS = [
    { num: 0, color: 'green' },
    { num: 32, color: 'red' },
    { num: 15, color: 'black' },
    { num: 19, color: 'red' },
    { num: 4, color: 'black' },
    { num: 21, color: 'red' },
    { num: 2, color: 'black' },
    { num: 25, color: 'red' },
    { num: 17, color: 'black' },
    { num: 34, color: 'red' },
    { num: 6, color: 'black' },
    { num: 27, color: 'red' },
    { num: 13, color: 'black' },
    { num: 36, color: 'red' },
    { num: 11, color: 'black' },
    { num: 30, color: 'red' },
    { num: 8, color: 'black' },
    { num: 23, color: 'red' },
    { num: 10, color: 'black' },
    { num: 5, color: 'red' },
    { num: 24, color: 'black' },
    { num: 16, color: 'red' },
    { num: 33, color: 'black' },
    { num: 1, color: 'red' },
    { num: 20, color: 'black' },
    { num: 14, color: 'red' },
    { num: 31, color: 'black' },
    { num: 9, color: 'red' },
    { num: 22, color: 'black' },
    { num: 18, color: 'red' },
    { num: 29, color: 'black' },
    { num: 7, color: 'red' },
    { num: 28, color: 'black' },
    { num: 12, color: 'red' },
    { num: 35, color: 'black' },
    { num: 3, color: 'red' },
    { num: 26, color: 'black' }
];

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

let currentRoom = null;
let myId = null;
let isHost = false;
let wheelStateListener = null;
let playersListener = null;

let selectedChipAmount = 50;
let myBankroll = 1000;
let myBets = []; // Array of { type, value, amount }
let currentBaseAngle = 0;
let isSpinningLocal = false;
let spinTimeoutId = null;

// Trigger Telegram Haptic feedback if available
function haptic(type = 'light') {
    if (window.Telegram?.WebApp?.HapticFeedback) {
        if (type === 'selection') window.Telegram.WebApp.HapticFeedback.selectionChanged();
        else if (type === 'impact') window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        else if (type === 'success') window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        else if (type === 'warning') window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
    }
}

// Show in-app toast
function showToast(text) {
    const toast = document.getElementById('toastNotice');
    if (toast) {
        toast.textContent = text;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2400);
    }
}

// ---- Initialization by Host when starting room ----
export async function initWheelGame(roomCode) {
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = playersSnap.val() || {};

    const initialBankrolls = {};
    Object.keys(players).forEach(pid => {
        initialBankrolls[pid] = 1000;
    });

    await set(ref(db, `rooms/${roomCode}/rouletteState`), {
        phase: 'betting', // 'betting' | 'spinning' | 'result'
        round: 1,
        winningNumber: null,
        winningColor: null,
        targetAngle: 0,
        spinStartTime: null,
        bets: {},
        bankrolls: initialBankrolls,
        history: [],
        payouts: {}
    });
}

// ---- Drawing the Golden European Roulette Wheel ----
export function drawRouletteWheel(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = cx - 6;

    ctx.clearRect(0, 0, width, height);

    // 1. Outer Brass / Gold Ring
    const outerRimGrad = ctx.createRadialGradient(cx, cy, radius - 20, cx, cy, radius);
    outerRimGrad.addColorStop(0, '#9a7b2c');
    outerRimGrad.addColorStop(0.3, '#f3db83');
    outerRimGrad.addColorStop(0.7, '#d4af37');
    outerRimGrad.addColorStop(1, '#5e4812');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.fillStyle = outerRimGrad;
    ctx.fill();

    // Metallic Rim Inner Shadow
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#281d05';
    ctx.stroke();

    // 2. Wheel Pockets Track
    const pocketOuterR = radius - 10;
    const pocketInnerR = radius - 62;
    const sliceAngle = (2 * Math.PI) / ROULETTE_NUMBERS.length;

    // We start pocket 0 at top (-PI/2)
    const baseAngle = -Math.PI / 2;

    ROULETTE_NUMBERS.forEach((pocket, idx) => {
        const startA = baseAngle + idx * sliceAngle;
        const endA = startA + sliceAngle;

        // Pocket Background
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, pocketOuterR, startA, endA);
        ctx.closePath();

        if (pocket.color === 'green') {
            ctx.fillStyle = '#059669';
        } else if (pocket.color === 'red') {
            ctx.fillStyle = '#b91c1c';
        } else {
            ctx.fillStyle = '#11141c';
        }
        ctx.fill();

        // Gold Pocket Dividers
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Pocket Number Text
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startA + sliceAngle / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Outfit, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.fillText(pocket.num.toString(), pocketOuterR - 18, 0);
        ctx.restore();
    });

    // 3. Inner Wood / Metallic Ring
    ctx.beginPath();
    ctx.arc(cx, cy, pocketInnerR, 0, 2 * Math.PI);
    const innerRimGrad = ctx.createRadialGradient(cx, cy, pocketInnerR - 25, cx, cy, pocketInnerR);
    innerRimGrad.addColorStop(0, '#1c150c');
    innerRimGrad.addColorStop(0.6, '#382613');
    innerRimGrad.addColorStop(1, '#9a7b2c');
    ctx.fillStyle = innerRimGrad;
    ctx.fill();
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4. Center Gold Hub & 8 Radial Spokes
    const hubR = pocketInnerR - 28;
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, 2 * Math.PI);
    const hubGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, hubR);
    hubGrad.addColorStop(0, '#fef08a');
    hubGrad.addColorStop(0.5, '#d4af37');
    hubGrad.addColorStop(1, '#785311');
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#422c06';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 8 Spokes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
        const spokeA = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(spokeA) * (hubR - 2), cy + Math.sin(spokeA) * (hubR - 2));
        ctx.stroke();
    }

    // 5. Center Gold Cap
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, 2 * Math.PI);
    const capGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    capGrad.addColorStop(0, '#ffffff');
    capGrad.addColorStop(0.4, '#fde047');
    capGrad.addColorStop(1, '#a16207');
    ctx.fillStyle = capGrad;
    ctx.fill();
}

// Build 1-36 Numbers inside the accordion
function renderNumberGrid() {
    const grid = document.getElementById('numberBetsGrid');
    if (!grid || grid.children.length > 0) return;

    grid.innerHTML = '';
    // Number 0 Button
    const zeroBtn = document.createElement('button');
    zeroBtn.type = 'button';
    zeroBtn.className = 'num-bet-btn green-zero-btn';
    zeroBtn.setAttribute('data-type', 'number');
    zeroBtn.setAttribute('data-value', '0');
    zeroBtn.innerHTML = `<span>0</span><span class="num-chip-badge" id="betAmount-number-0">0</span>`;
    grid.appendChild(zeroBtn);

    for (let i = 1; i <= 36; i++) {
        const isRed = RED_NUMBERS.includes(i);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `num-bet-btn ${isRed ? 'red-num' : 'black-num'}`;
        btn.setAttribute('data-type', 'number');
        btn.setAttribute('data-value', i.toString());
        btn.innerHTML = `<span>${i}</span><span class="num-chip-badge" id="betAmount-number-${i}">0</span>`;
        grid.appendChild(btn);
    }
}

// ---- Main Game Listener ----
export function joinWheelListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;

    // Reset local state
    myBets = [];
    selectedChipAmount = 50;
    isSpinningLocal = false;

    // Draw Wheel
    const canvas = document.getElementById('rouletteCanvas');
    if (canvas) {
        drawRouletteWheel(canvas);
        canvas.style.transition = 'none';
        canvas.style.transform = `rotate(${currentBaseAngle}deg)`;
    }

    // Inject Numbers Grid
    renderNumberGrid();

    // Setup chip selectors
    const chipTokens = document.querySelectorAll('.chip-token');
    chipTokens.forEach(token => {
        token.addEventListener('click', () => {
            chipTokens.forEach(t => t.classList.remove('active'));
            token.classList.add('active');
            selectedChipAmount = parseInt(token.getAttribute('data-amount'), 10) || 50;
            haptic('selection');
        });
    });

    // Accordion Toggle for Numbers Grid
    const toggleGridBtn = document.getElementById('toggleNumberGridBtn');
    const numberGrid = document.getElementById('numberBetsGrid');
    const accordionArrow = document.getElementById('accordionArrow');
    if (toggleGridBtn && numberGrid) {
        toggleGridBtn.onclick = () => {
            const isHidden = numberGrid.classList.contains('hidden');
            if (isHidden) {
                numberGrid.classList.remove('hidden');
                accordionArrow.textContent = '▲';
            } else {
                numberGrid.classList.add('hidden');
                accordionArrow.textContent = '▼';
            }
            haptic('selection');
        };
    }

    // Setup Bet Buttons (Outside & Inside)
    setupBetListeners();

    // Clear Bets Button
    const clearBetsBtn = document.getElementById('clearBetsBtn');
    if (clearBetsBtn) {
        clearBetsBtn.onclick = async () => {
            if (isSpinningLocal) return;
            myBets = [];
            updateMyBetsUI();
            haptic('impact');
            await set(ref(db, `rooms/${currentRoom}/rouletteState/bets/${myId}`), null);
            showToast('Bets cleared!');
        };
    }

    // Re-buy Chips Button
    const rebuyBtn = document.getElementById('rebuyChipsBtn');
    if (rebuyBtn) {
        rebuyBtn.onclick = async () => {
            haptic('success');
            await update(ref(db, `rooms/${currentRoom}/rouletteState/bankrolls`), {
                [myId]: 500
            });
            showToast('💎 +500 VIP Re-buy Chips added!');
            rebuyBtn.classList.add('hidden');
        };
    }

    // Host Spin Button
    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) {
        spinBtn.onclick = () => triggerRouletteSpin();
    }

    // Host Next Round Button
    const nextRoundBtn = document.getElementById('nextRoundBtn');
    if (nextRoundBtn) {
        nextRoundBtn.onclick = () => startNextRouletteRound();
    }

    // Listen to Room Players (for table display & chips)
    if (playersListener) playersListener();
    playersListener = onValue(ref(db, `rooms/${currentRoom}/players`), (snap) => {
        const players = snap.val() || {};
        updateTablePlayersList(players);
    });

    // Listen to Roulette Game State
    if (wheelStateListener) wheelStateListener();
    wheelStateListener = onValue(ref(db, `rooms/${currentRoom}/rouletteState`), (snapshot) => {
        const state = snapshot.val();
        if (!state) return;
        renderRouletteState(state);
    });
}

// Setup click handlers for all betting buttons
function setupBetListeners() {
    const betButtons = document.querySelectorAll('.bet-btn, .num-bet-btn');
    betButtons.forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            if (isSpinningLocal) {
                showToast('Wheel is currently spinning!');
                return;
            }

            const betType = btn.getAttribute('data-type');
            const betVal = btn.getAttribute('data-value');

            // Calculate current total bet
            const currentTotal = myBets.reduce((acc, b) => acc + b.amount, 0);
            if (currentTotal + selectedChipAmount > myBankroll) {
                haptic('warning');
                showToast('Insufficient chips! Lower your bet or re-buy.');
                return;
            }

            // Find existing bet or push new
            const existing = myBets.find(b => b.type === betType && b.value === betVal);
            if (existing) {
                existing.amount += selectedChipAmount;
            } else {
                myBets.push({ type: betType, value: betVal, amount: selectedChipAmount });
            }

            haptic('selection');
            updateMyBetsUI();

            // Sync bets to Firebase
            await set(ref(db, `rooms/${currentRoom}/rouletteState/bets/${myId}`), myBets);
        };
    });
}

// Update local UI badges for bets placed by current player
function updateMyBetsUI() {
    // Reset all badges
    document.querySelectorAll('[id^="betAmount-"]').forEach(el => {
        el.textContent = '0';
        el.parentElement?.classList.remove('has-bet');
    });

    let total = 0;
    myBets.forEach(b => {
        total += b.amount;
        const badgeId = `betAmount-${b.type}-${b.value}`;
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = b.amount.toString();
            badge.parentElement?.classList.add('has-bet');
        }
    });

    const totalText = document.getElementById('myTotalBetText');
    if (totalText) totalText.textContent = `${total.toLocaleString()} CHIPS`;
}

// Render Firebase State
let lastRenderedPhase = null;
function renderRouletteState(state) {
    const hostControls = document.getElementById('rouletteHostControls');
    const spinBtn = document.getElementById('spinBtn');
    const nextRoundBtn = document.getElementById('nextRoundBtn');
    const phasePill = document.getElementById('roulettePhasePill');
    const phaseText = document.getElementById('roulettePhaseText');
    const resultBanner = document.getElementById('rouletteResultBanner');
    const rebuyBtn = document.getElementById('rebuyChipsBtn');
    const bankrollText = document.getElementById('playerBankrollText');

    // Host Controls Visibility
    if (isHost && hostControls) {
        hostControls.classList.remove('hidden');
    } else if (hostControls) {
        hostControls.classList.add('hidden');
    }

    // Update Player Bankroll from Firebase
    if (state.bankrolls && state.bankrolls[myId] !== undefined) {
        myBankroll = state.bankrolls[myId];
        if (bankrollText) bankrollText.textContent = myBankroll.toLocaleString();

        // Show rebuy if bankrupt
        if (myBankroll <= 25 && state.phase === 'betting') {
            rebuyBtn?.classList.remove('hidden');
        } else {
            rebuyBtn?.classList.add('hidden');
        }
    }

    // Update History Badges
    renderHistoryBadges(state.history || []);

    // Sync other players' bets to the player list
    renderLivePlayerBets(state.bets || {}, state.bankrolls || {});

    // Phase Handling
    if (state.phase === 'betting') {
        isSpinningLocal = false;
        phasePill?.classList.remove('spinning', 'result');
        if (phaseText) phaseText.textContent = 'Place Your Bets';
        resultBanner?.classList.add('hidden');

        if (spinBtn) {
            spinBtn.disabled = false;
            spinBtn.classList.remove('hidden');
        }
        if (nextRoundBtn) nextRoundBtn.classList.add('hidden');

        // Restore player bets if returning to betting
        if (state.bets && state.bets[myId]) {
            myBets = state.bets[myId];
        } else {
            myBets = [];
        }
        updateMyBetsUI();

    } else if (state.phase === 'spinning') {
        isSpinningLocal = true;
        phasePill?.classList.remove('result');
        phasePill?.classList.add('spinning');
        if (phaseText) phaseText.textContent = 'Spinning... No More Bets!';
        resultBanner?.classList.add('hidden');

        if (spinBtn) spinBtn.disabled = true;

        // Perform animation if not already spinning to this target
        if (lastRenderedPhase !== 'spinning' && state.targetAngle) {
            animateWheelSpin(state.targetAngle, state.winningNumber, state.winningColor);
        }

    } else if (state.phase === 'result') {
        isSpinningLocal = false;
        phasePill?.classList.remove('spinning');
        phasePill?.classList.add('result');
        if (phaseText) phaseText.textContent = 'Round Complete';

        if (spinBtn) spinBtn.classList.add('hidden');
        if (nextRoundBtn && isHost) nextRoundBtn.classList.remove('hidden');

        // Reveal Result Card
        displayResultCard(state.winningNumber, state.winningColor, state.payouts?.[myId]);
    }

    lastRenderedPhase = state.phase;
}

// Animate wheel spinning smoothly with realistic deceleration
function animateWheelSpin(targetAngle, winningNum, winningColor) {
    const canvas = document.getElementById('rouletteCanvas');
    if (!canvas) return;

    haptic('impact');
    canvas.style.transition = 'transform 5s cubic-bezier(0.12, 0.8, 0.15, 1)';
    canvas.style.transform = `rotate(${targetAngle}deg)`;
    currentBaseAngle = targetAngle;

    if (spinTimeoutId) clearTimeout(spinTimeoutId);

    // After 5.1s, finalize and if host, compute payouts
    spinTimeoutId = setTimeout(async () => {
        haptic('success');
        if (isHost && currentRoom) {
            await computeAndPublishPayouts(winningNum, winningColor);
        }
    }, 5100);
}

// Display winning number and payout celebration card
function displayResultCard(num, color, myPayout) {
    const banner = document.getElementById('rouletteResultBanner');
    const badge = document.getElementById('resultNumberBadge');
    const numText = document.getElementById('resultNumberText');
    const mainTitle = document.getElementById('resultMainTitle');
    const subTitle = document.getElementById('resultSubTitle');
    const payoutTag = document.getElementById('resultPlayerPayout');

    if (!banner || num === null || num === undefined) return;

    banner.classList.remove('hidden');
    if (numText) numText.textContent = num.toString();

    // Style badge color
    badge.className = `result-number-badge ${color}`;

    const colorName = color.toUpperCase();
    if (mainTitle) mainTitle.textContent = `${num} ${colorName}`;

    // Parity and Range description
    let details = '';
    if (num === 0) {
        details = 'HOUSE ZERO • GREEN';
    } else {
        const parity = num % 2 === 0 ? 'EVEN' : 'ODD';
        const range = num <= 18 ? 'LOW (1-18)' : 'HIGH (19-36)';
        details = `${parity} • ${range}`;
    }
    if (subTitle) subTitle.textContent = details;

    // Player personal payout
    if (payoutTag) {
        if (!myPayout || myPayout.totalBet === 0) {
            payoutTag.textContent = 'NO BETS PLACED';
            payoutTag.className = 'player-payout-tag neutral';
        } else if (myPayout.netProfit > 0) {
            payoutTag.textContent = `🎉 +${myPayout.totalWon.toLocaleString()} CHIPS WON! (+${myPayout.netProfit.toLocaleString()} Profit)`;
            payoutTag.className = 'player-payout-tag win';
            haptic('success');
        } else {
            payoutTag.textContent = `💸 -${myPayout.totalBet.toLocaleString()} Chips. Better luck next spin!`;
            payoutTag.className = 'player-payout-tag loss';
        }
    }
}

// Render History Badges Row
function renderHistoryBadges(history) {
    const container = document.getElementById('rouletteHistoryBadges');
    if (!container) return;

    if (!history || history.length === 0) {
        container.innerHTML = `<span class="history-empty">No spins yet</span>`;
        return;
    }

    container.innerHTML = '';
    history.forEach(item => {
        const badge = document.createElement('span');
        badge.className = `history-badge ${item.color}`;
        badge.textContent = item.num.toString();
        container.appendChild(badge);
    });
}

// Render Players and their active bets
function renderLivePlayerBets(allBets, bankrolls) {
    const container = document.getElementById('roulettePlayersList');
    if (!container) return;

    // Get existing cards and update their bets
    Object.keys(bankrolls).forEach(pid => {
        const pCard = document.getElementById(`roulette-player-${pid}`);
        if (!pCard) return;

        const chipsEl = pCard.querySelector('.p-chips-val');
        if (chipsEl) chipsEl.textContent = `${(bankrolls[pid] || 0).toLocaleString()} 💎`;

        const betsEl = pCard.querySelector('.p-bets-summary');
        if (betsEl) {
            const bets = allBets[pid] || [];
            if (bets.length === 0) {
                betsEl.innerHTML = `<span class="text-muted" style="font-size: 11px;">No bets</span>`;
            } else {
                const total = bets.reduce((a, b) => a + b.amount, 0);
                const pills = bets.map(b => {
                    const label = b.type === 'color' ? (b.value === 'red' ? '🔴 Red' : '⚫ Black') :
                                  b.type === 'parity' ? b.value.toUpperCase() :
                                  b.type === 'range' ? (b.value === 'low' ? '1-18' : '19-36') :
                                  `#${b.value}`;
                    return `<span class="player-bet-chip">${label}: ${b.amount}</span>`;
                }).join(' ');
                betsEl.innerHTML = `<div style="font-weight: 700; font-size: 12px; color: var(--gold-primary);">Total: ${total}</div><div class="bet-chips-wrap">${pills}</div>`;
            }
        }
    });
}

// Update table player cards from room players
function updateTablePlayersList(players) {
    const container = document.getElementById('roulettePlayersList');
    const counter = document.getElementById('tablePlayersCount');
    if (!container) return;

    const playerIds = Object.keys(players);
    if (counter) counter.textContent = `${playerIds.length} PLAYERS`;

    container.innerHTML = '';
    playerIds.forEach(pid => {
        const p = players[pid];
        const isMe = pid === myId;
        const div = document.createElement('div');
        div.className = `roulette-player-card glass ${isMe ? 'is-me' : ''}`;
        div.id = `roulette-player-${pid}`;
        div.innerHTML = `
            <div class="roulette-player-header">
                <div class="player-avatar-circle" style="width: 32px; height: 32px; font-size: 13px;">
                    ${p.name.charAt(0).toUpperCase()}
                </div>
                <div class="roulette-player-meta">
                    <strong>${p.name} ${isMe ? '(You)' : ''}</strong>
                    <span class="p-chips-val">1,000 💎</span>
                </div>
            </div>
            <div class="p-bets-summary mt-5">
                <span class="text-muted" style="font-size: 11px;">Waiting for bets...</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// Host triggers spin
async function triggerRouletteSpin() {
    if (!isHost || !currentRoom || isSpinningLocal) return;

    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) spinBtn.disabled = true;

    // Pick random winning pocket from European sequence
    const pocketIndex = Math.floor(Math.random() * ROULETTE_NUMBERS.length);
    const winningPocket = ROULETTE_NUMBERS[pocketIndex];

    // Pocket angle math to land precisely at 12 o'clock pointer
    const sliceAngle = 360 / ROULETTE_NUMBERS.length;
    // Pocket center relative to start
    const pocketCenterDeg = (pocketIndex + 0.5) * sliceAngle;
    // Offset needed so pocket center lands at 12 o'clock (-90° / 0° from top)
    const offset = (360 - (pocketCenterDeg % 360)) % 360;

    // Add 5 full rotations (1800 deg)
    const extraRotations = 5 * 360;
    const targetAngle = currentBaseAngle + extraRotations + ((offset - (currentBaseAngle % 360) + 360) % 360);

    await update(ref(db, `rooms/${currentRoom}/rouletteState`), {
        phase: 'spinning',
        winningNumber: winningPocket.num,
        winningColor: winningPocket.color,
        targetAngle: targetAngle,
        spinStartTime: Date.now()
    });
}

// Host computes payouts after wheel stops
async function computeAndPublishPayouts(winningNum, winningColor) {
    if (!isHost || !currentRoom) return;

    const snap = await get(ref(db, `rooms/${currentRoom}/rouletteState`));
    const state = snap.val();
    if (!state) return;

    const allBets = state.bets || {};
    const bankrolls = { ...(state.bankrolls || {}) };
    const payouts = {};

    Object.keys(bankrolls).forEach(pid => {
        const bets = allBets[pid] || [];
        let totalBet = 0;
        let totalWon = 0;

        bets.forEach(b => {
            totalBet += b.amount;

            // Colors: 2x (0 loses)
            if (b.type === 'color' && winningNum !== 0 && b.value === winningColor) {
                totalWon += b.amount * 2;
            }
            // Parity: 2x (0 loses)
            else if (b.type === 'parity' && winningNum !== 0) {
                if (b.value === 'even' && winningNum % 2 === 0) totalWon += b.amount * 2;
                if (b.value === 'odd' && winningNum % 2 !== 0) totalWon += b.amount * 2;
            }
            // Range: 2x (0 loses)
            else if (b.type === 'range' && winningNum !== 0) {
                if (b.value === 'low' && winningNum >= 1 && winningNum <= 18) totalWon += b.amount * 2;
                if (b.value === 'high' && winningNum >= 19 && winningNum <= 36) totalWon += b.amount * 2;
            }
            // Straight-up Number (0-36): 36x payout!
            else if (b.type === 'number' && parseInt(b.value, 10) === winningNum) {
                totalWon += b.amount * 36;
            }
        });

        const currentBal = bankrolls[pid] || 1000;
        const newBal = Math.max(0, currentBal - totalBet + totalWon);
        bankrolls[pid] = newBal;
        payouts[pid] = {
            totalBet,
            totalWon,
            netProfit: totalWon - totalBet
        };
    });

    const newHistory = [
        { num: winningNum, color: winningColor },
        ...(state.history || []).slice(0, 6)
    ];

    await update(ref(db, `rooms/${currentRoom}/rouletteState`), {
        phase: 'result',
        bankrolls: bankrolls,
        payouts: payouts,
        history: newHistory
    });
}

// Host starts next round
async function startNextRouletteRound() {
    if (!isHost || !currentRoom) return;

    const snap = await get(ref(db, `rooms/${currentRoom}/rouletteState`));
    const state = snap.val() || {};

    await update(ref(db, `rooms/${currentRoom}/rouletteState`), {
        phase: 'betting',
        bets: {},
        payouts: {},
        round: (state.round || 1) + 1
    });
}

// Leave Game
export function leaveWheelGame() {
    if (wheelStateListener) {
        wheelStateListener();
        wheelStateListener = null;
    }
    if (playersListener) {
        playersListener();
        playersListener = null;
    }
    if (spinTimeoutId) {
        clearTimeout(spinTimeoutId);
        spinTimeoutId = null;
    }
    currentRoom = null;
    myId = null;
    isHost = false;
    myBets = [];
}
