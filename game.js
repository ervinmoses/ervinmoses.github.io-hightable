import { db } from './firebase-config.js';
import { ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { showAlert } from './app.js';

let currentRoom = null;
let myId = null;
let isHost = false;
let gameListeners = [];

// DOM Elements
const hostControls = document.getElementById('hostControls');
const playerSelect = document.getElementById('playerSelect');
const giveCardBtn = document.getElementById('giveCardBtn');
const passBtn = document.getElementById('passBtn');

// New Table Elements
const myRoleText = document.getElementById('myRoleText');
const myPlayerName = document.getElementById('myPlayerName');
const myTotalSpan = document.getElementById('myTotal');
const safeIndicator = document.getElementById('safeIndicator');
const lockSafeBtn = document.getElementById('lockSafeBtn');
const tablePlayers = document.getElementById('tablePlayers');

// Deathmatch Elements
const deathmatchControls = document.getElementById('deathmatchControls');
const dmBtns = document.querySelectorAll('.dm-btn');
const revealDeathmatchBtn = document.getElementById('revealDeathmatchBtn');
const deathmatchRevealArea = document.getElementById('deathmatchRevealArea');
const myRevealBtn = document.getElementById('myRevealBtn');
const dmOpponentsText = document.getElementById('dmOpponentsText');

const massiveAlert = document.getElementById('massiveAlert');
const massiveAlertText = document.getElementById('massiveAlertText');
const massiveAlertSub = document.getElementById('massiveAlertSub');
const closeMassiveAlertBtn = document.getElementById('closeMassiveAlertBtn');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function getCardNumericValue(valueStr) {
    if (['J', 'Q', 'K'].includes(valueStr)) return 10;
    if (valueStr === 'A') return 11; 
    return parseInt(valueStr);
}

function generateDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ suit, value, numericValue: getCardNumericValue(value) });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export async function initGame(roomCode) {
    const deck = generateDeck();
    const playersSnapshot = await get(ref(db, `rooms/${roomCode}/players`));
    const players = playersSnapshot.val() || {};
    
    let gameState = {
        deck: deck,
        hands: {},
        safePlayers: {}, // { playerId: penaltyDistance }
        dmRevealed: {},
        status: 'active'
    };

    // Deal 2 cards to ALL players
    Object.keys(players).forEach(id => {
        gameState.hands[id] = [deck.pop(), deck.pop()];
    });

    await set(ref(db, `rooms/${roomCode}/gameState`), gameState);
}

export function joinGameListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;

    if (isHost) {
        hostControls.classList.remove('hidden');
        myRoleText.innerHTML = `Player: <span id="myPlayerName">Dealer (Host)</span>`;
    } else {
        hostControls.classList.add('hidden');
    }

    const stateRef = ref(db, `rooms/${roomCode}/gameState`);
    const listener = onValue(stateRef, async (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
        const players = playersSnapshot.val() || {};

        renderTablePlayers(state, players);
        
        if (isHost) {
            updateHostControls(state, players);
            checkGameEndCondition(state);
        }

        // Handle deathmatch
        if (state.status === 'deathmatch_setup' || state.status === 'deathmatch_reveal') {
            handleDeathmatch(state, players);
            
            // Auto-finalize if everyone has revealed
            if (isHost && state.status === 'deathmatch_reveal' && state.dmHands && state.dmRevealed) {
                const allRevealed = Object.keys(state.dmHands).every(id => state.dmRevealed[id]);
                if (allRevealed) {
                    finalizeDeathmatch(state, state.dmCondition);
                }
            }
        } else {
            deathmatchRevealArea.classList.add('hidden');
        }
        
        // Handle Game Over
        if (state.status === 'game_over') {
            showLoser(state.loserName, state.reason);
        }
    });
    
    gameListeners.push({ ref: stateRef, listener });
}

export function leaveGame() {
    gameListeners.forEach(l => {
        if (typeof l.listener === 'function') l.listener();
    });
    gameListeners = [];
    currentRoom = null;
    isHost = false;
    hostControls.classList.add('hidden');
    deathmatchControls.classList.add('hidden');
    massiveAlert.classList.add('hidden');
    if(deathmatchRevealArea) deathmatchRevealArea.classList.add('hidden');
    
    const endBtn = document.getElementById('endRoundBtn');
    if (endBtn) endBtn.remove();
}

function calculateTotal(hand) {
    if (!hand || hand.length === 0) return 0;
    let total = 0;
    let aces = 0;
    hand.forEach(card => {
        if (card.value === 'A') {
            aces++;
            total += 11;
        } else {
            total += card.numericValue;
        }
    });
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function renderTablePlayers(state, players) {
    if(!tablePlayers) return;
    tablePlayers.innerHTML = '';
    
    // Setup My Status
    const myHand = state.hands[myId] || [];
    const myTotal = calculateTotal(myHand);
    if(myTotalSpan) myTotalSpan.textContent = myTotal;
    
    if (state.safePlayers && state.safePlayers[myId] !== undefined) {
        if(safeIndicator) safeIndicator.classList.remove('hidden');
        if(lockSafeBtn) {
            lockSafeBtn.disabled = true;
            lockSafeBtn.textContent = "Locked (SAFE)";
        }
    } else {
        if(safeIndicator) safeIndicator.classList.add('hidden');
        if(lockSafeBtn) {
            lockSafeBtn.disabled = false;
            lockSafeBtn.textContent = "Lock In (SAFE)";
        }
    }

    // Render everyone's cards
    Object.keys(players).forEach(id => {
        const hand = state.hands[id] || [];
        const isPlayerSafe = state.safePlayers && state.safePlayers[id] !== undefined;
        
        const cardContainer = document.createElement('div');
        cardContainer.className = 'table-player-card';
        
        let header = `
            <div class="table-player-header">
                <strong>${players[id].name} ${id === myId ? '(You)' : ''}</strong>
                <span>${isPlayerSafe ? '<strong class="text-danger">SAFE</strong>' : `Cards: ${hand.length}/5`}</span>
            </div>
        `;
        
        let cardsHtml = '<div class="cards-container">';
        hand.forEach(card => {
            let suitSymbol = '';
            switch(card.suit) {
                case 'hearts': suitSymbol = '♥'; break;
                case 'diamonds': suitSymbol = '♦'; break;
                case 'clubs': suitSymbol = '♣'; break;
                case 'spades': suitSymbol = '♠'; break;
            }
            const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
            cardsHtml += `<div class="playing-card sm-card ${redClass}">${card.value}<br/>${suitSymbol}</div>`;
        });
        
        // If Deathmatch, show dmCard if it exists
        if (state.dmHands && state.dmHands[id]) {
            if (state.dmRevealed && state.dmRevealed[id]) {
                const c = state.dmHands[id];
                const redClass = ['hearts', 'diamonds'].includes(c.suit) ? 'red' : '';
                let sym = c.suit === 'hearts' ? '♥' : (c.suit === 'diamonds' ? '♦' : (c.suit === 'clubs' ? '♣' : '♠'));
                cardsHtml += `<div class="playing-card sm-card dm-card ${redClass}">${c.value}<br/>${sym}</div>`;
            } else {
                cardsHtml += `<div class="playing-card sm-card dm-card back">?</div>`;
            }
        }
        
        cardsHtml += '</div>';
        cardContainer.innerHTML = header + cardsHtml;
        tablePlayers.appendChild(cardContainer);
    });
}

// SAFE Button Click
if (lockSafeBtn) {
    lockSafeBtn.addEventListener('click', async () => {
        if (!currentRoom) return;
        const stateRef = ref(db, `rooms/${currentRoom}/gameState`);
        const snapshot = await get(stateRef);
        let state = snapshot.val();
        
        if (state.safePlayers && state.safePlayers[myId] !== undefined) return;
        
        const myHand = state.hands[myId] || [];
        const total = calculateTotal(myHand);
        
        // If under 16, they take a massive penalty
        const isIllegal = total < 16;
        const distancePenalty = isIllegal ? (100 + (16 - total)) : 0;
        
        if (!state.safePlayers) state.safePlayers = {};
        state.safePlayers[myId] = distancePenalty;
        
        await update(stateRef, { safePlayers: state.safePlayers });
    });
}

// --- Host Functions ---

function updateHostControls(state, players) {
    const currentVal = playerSelect.value;
    playerSelect.innerHTML = '<option value="">Select a player...</option>';
    
    // Round robin logic: find minimum card count among non-safe active players
    let activeCardCounts = [];
    Object.keys(players).forEach(id => {
        if (!state.safePlayers || state.safePlayers[id] === undefined) {
            activeCardCounts.push((state.hands[id] || []).length);
        }
    });
    const minActiveCards = activeCardCounts.length > 0 ? Math.min(...activeCardCounts) : 5;

    Object.keys(players).forEach(id => {
        const handLen = state.hands[id] ? state.hands[id].length : 0;
        const isSafePlayer = state.safePlayers && state.safePlayers[id] !== undefined;
        
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${players[id].name}`;
        
        // Disable if safe, max cards (5), or ahead of round robin
        if (isSafePlayer) {
            option.disabled = true;
            option.textContent += ' [SAFE]';
        } else if (handLen >= 5) {
            option.disabled = true;
            option.textContent += ' [MAX CARDS]';
        } else if (handLen > minActiveCards) {
            option.disabled = true;
            option.textContent += ' [WAITING ON OTHERS]';
        }
        
        playerSelect.appendChild(option);
    });

    if (currentVal) playerSelect.value = currentVal;
}

if (giveCardBtn) {
    giveCardBtn.addEventListener('click', async () => {
        if (!isHost || !currentRoom) return;
        const targetId = playerSelect.value;
        if (!targetId) {
            showAlert('Error', 'Select a valid player first.');
            return;
        }

        const stateRef = ref(db, `rooms/${currentRoom}/gameState`);
        const snapshot = await get(stateRef);
        let state = snapshot.val();
        
        if (state.deck.length === 0) {
            showAlert('Error', 'Deck is empty!');
            return;
        }

        const card = state.deck.pop();
        if (!state.hands[targetId]) state.hands[targetId] = [];
        state.hands[targetId].push(card);

        await update(stateRef, {
            deck: state.deck,
            [`hands/${targetId}`]: state.hands[targetId]
        });
    });
}

function checkGameEndCondition(state) {
    if (!document.getElementById('endRoundBtn')) {
        const btn = document.createElement('button');
        btn.id = 'endRoundBtn';
        btn.className = 'btn danger mt-10 full-width';
        btn.textContent = 'End Round & Find Loser';
        btn.onclick = () => calculateLoser();
        hostControls.querySelector('.host-panel').appendChild(btn);
    }
}

async function calculateLoser() {
    if (!isHost) return;
    const snapshot = await get(ref(db, `rooms/${currentRoom}/gameState`));
    const state = snapshot.val();
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val();

    let maxDistance = -1;
    let tiedPlayers = [];

    Object.keys(players).forEach(id => {
        const hand = state.hands[id] || [];
        const total = calculateTotal(hand);
        
        let distance = 0;
        
        // Check illegal safe penalty first
        if (state.safePlayers && state.safePlayers[id] > 0) {
            distance = state.safePlayers[id];
        } else if (total > 21) {
            distance = total - 21;
        } else if (total < 16) {
            distance = 16 - total;
        }
        
        if (distance > maxDistance) {
            maxDistance = distance;
            tiedPlayers = [id];
        } else if (distance === maxDistance) {
            tiedPlayers.push(id);
        }
    });

    if (maxDistance === 0) {
        // Everyone perfectly safe (16-21). Penalize the absolute lowest total.
        let lowestTotal = 999;
        Object.keys(players).forEach(id => {
            const total = calculateTotal(state.hands[id] || []);
            if (total < lowestTotal) {
                lowestTotal = total;
                tiedPlayers = [id];
            } else if (total === lowestTotal) {
                tiedPlayers.push(id);
            }
        });
    }

    if (tiedPlayers.length === 1) {
        const loserName = players[tiedPlayers[0]].name;
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'game_over',
            loserName: loserName,
            reason: maxDistance > 0 ? `Farthest from safe zone` : `Lowest safe score`
        });
    } else if (tiedPlayers.length > 1) {
        initDeathmatch(state, tiedPlayers);
    }
}

async function initDeathmatch(state, tiedPlayers) {
    showAlert('TIE BREAKER', 'Multiple players tied. Host is selecting condition.');

    await update(ref(db, `rooms/${currentRoom}/gameState`), {
        status: 'deathmatch_setup',
        tiedPlayers: tiedPlayers
    });

    deathmatchControls.classList.remove('hidden');
    
    let selectedCondition = null;
    dmBtns.forEach(btn => {
        btn.onclick = () => {
            dmBtns.forEach(b => b.style.opacity = '0.5');
            btn.style.opacity = '1';
            selectedCondition = btn.dataset.cond;
            revealDeathmatchBtn.classList.remove('hidden');
        };
    });

    revealDeathmatchBtn.onclick = async () => {
        if (!selectedCondition) return;
        
        const s = (await get(ref(db, `rooms/${currentRoom}/gameState`))).val();
        let dmHands = {};
        s.tiedPlayers.forEach(id => {
            dmHands[id] = s.deck.pop(); 
        });

        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'deathmatch_reveal',
            dmHands: dmHands,
            dmRevealed: {},
            deck: s.deck,
            dmCondition: selectedCondition
        });
        
        deathmatchControls.classList.add('hidden');
    };
}

function handleDeathmatch(state, players) {
    if (state.dmHands && state.dmHands[myId] && (!state.dmRevealed || !state.dmRevealed[myId])) {
        deathmatchRevealArea.classList.remove('hidden');
        const opponents = Object.keys(state.dmHands).map(id => players[id].name).join(' vs ');
        dmOpponentsText.textContent = `Tie-Breaker: ${opponents}`;
        
        myRevealBtn.onclick = async () => {
            deathmatchRevealArea.classList.add('hidden');
            if (!state.dmRevealed) state.dmRevealed = {};
            state.dmRevealed[myId] = true;
            await update(ref(db, `rooms/${currentRoom}/gameState/dmRevealed`), state.dmRevealed);
        };
    } else {
        deathmatchRevealArea.classList.add('hidden');
    }
}

async function finalizeDeathmatch(state, condition) {
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val();

    let dmPlayers = Object.keys(state.dmHands).map(id => ({
        id,
        name: players[id].name,
        card: state.dmHands[id]
    }));

    let tiedLosers = [];
    
    if (condition === 'highest') {
        let maxVal = -1;
        dmPlayers.forEach(p => { if (p.card.numericValue > maxVal) maxVal = p.card.numericValue; });
        tiedLosers = dmPlayers.filter(p => p.card.numericValue === maxVal);
    } else if (condition === 'lower') {
        let minVal = 999;
        dmPlayers.forEach(p => { if (p.card.numericValue < minVal) minVal = p.card.numericValue; });
        tiedLosers = dmPlayers.filter(p => p.card.numericValue === minVal);
    } else if (condition === 'middle') {
        if (dmPlayers.length >= 3) {
            dmPlayers.sort((a,b) => a.card.numericValue - b.card.numericValue);
            const medianVal = dmPlayers[Math.floor(dmPlayers.length / 2)].card.numericValue;
            tiedLosers = dmPlayers.filter(p => p.card.numericValue === medianVal);
        } else {
            let maxVal = -1;
            dmPlayers.forEach(p => { if (p.card.numericValue > maxVal) maxVal = p.card.numericValue; });
            tiedLosers = dmPlayers.filter(p => p.card.numericValue === maxVal);
        }
    }

    if (tiedLosers.length > 1) {
        // Tie in deathmatch! Restart deathmatch for tied losers
        showAlert('DEATHMATCH TIE!', 'Players drew the same card value. Entering Round 2!');
        initDeathmatch(state, tiedLosers.map(p => p.id));
    } else {
        const loser = tiedLosers[0];
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'game_over',
            loserName: loser.name,
            reason: `Lost Deathmatch (${condition}) with card: ${loser.card.value}`
        });
    }
}

function showLoser(name, reason) {
    massiveAlertText.textContent = `${name.toUpperCase()} LOST`;
    massiveAlertSub.textContent = reason;
    massiveAlert.classList.remove('hidden');
}

if (closeMassiveAlertBtn) {
    closeMassiveAlertBtn.onclick = async () => {
        massiveAlert.classList.add('hidden');
        if (isHost && currentRoom) {
            await update(ref(db, `rooms/${currentRoom}`), {
                status: 'waiting',
                gameState: null 
            });
        }
    };
}
