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
const myCardsDiv = document.getElementById('myCards');
const myTotalSpan = document.getElementById('myTotal');
const safeIndicator = document.getElementById('safeIndicator');
const myRoleText = document.getElementById('myRoleText');

// Deathmatch Elements
const deathmatchControls = document.getElementById('deathmatchControls');
const dmBtns = document.querySelectorAll('.dm-btn');
const revealDeathmatchBtn = document.getElementById('revealDeathmatchBtn');
const massiveAlert = document.getElementById('massiveAlert');
const massiveAlertText = document.getElementById('massiveAlertText');
const massiveAlertSub = document.getElementById('massiveAlertSub');
const closeMassiveAlertBtn = document.getElementById('closeMassiveAlertBtn');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function getCardNumericValue(valueStr) {
    if (['J', 'Q', 'K'].includes(valueStr)) return 10;
    if (valueStr === 'A') return 11; // Handled specially in calculateTotal
    return parseInt(valueStr);
}

function generateDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ suit, value, numericValue: getCardNumericValue(value) });
        }
    }
    // Shuffle
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
        turn: Object.keys(players)[0], // Host starts or arbitrary
        status: 'active'
    };

    // Deal 2 cards to host
    const hostId = Object.keys(players).find(id => players[id].isHost);
    if (hostId) {
        gameState.hands[hostId] = [deck.pop(), deck.pop()];
    }

    // Init empty hands for others
    Object.keys(players).forEach(id => {
        if (id !== hostId) {
            gameState.hands[id] = [];
        }
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
    }

    const stateRef = ref(db, `rooms/${roomCode}/gameState`);
    const listener = onValue(stateRef, (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        renderMyCards(state.hands[myId] || []);
        
        if (isHost) {
            updateHostControls(state);
            checkGameEndCondition(state);
        }

        // Handle deathmatch reveal
        if (state.status === 'deathmatch_reveal') {
            handleDeathmatchReveal(state);
        }
        
        // Handle Game Over
        if (state.status === 'game_over') {
            showLoser(state.loserName, state.reason);
        }
    });
    
    gameListeners.push({ ref: stateRef, listener });
}

export function leaveGame() {
    // Unsubscribe from Firebase listeners
    gameListeners.forEach(l => {
        // Just empty for now, ideally `off(l.ref, l.listener)` but we need to import `off` or use returned unsubscribe from modular SDK
    });
    gameListeners = [];
    currentRoom = null;
    isHost = false;
    hostControls.classList.add('hidden');
    deathmatchControls.classList.add('hidden');
    massiveAlert.classList.add('hidden');
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

    // Specific Rule: Ace = 11 only if exactly 2 cards. Otherwise 1.
    if (hand.length > 2 && aces > 0) {
        // Subtract 10 for every Ace to make it worth 1
        total -= (10 * aces);
    }
    
    return total;
}

function isSafe(hand, total) {
    // Safe zone: 16 to 21
    if (total >= 16 && total <= 21) return true;
    // 5-Card Trick: 5 cards and under 16 is Safe
    if (hand.length >= 5 && total < 16) return true;
    return false;
}

export function renderMyCards(hand) {
    myCardsDiv.innerHTML = '';
    const total = calculateTotal(hand);
    myTotalSpan.textContent = total;

    if (isSafe(hand, total)) {
        safeIndicator.classList.remove('hidden');
    } else {
        safeIndicator.classList.add('hidden');
    }

    hand.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `playing-card ${['hearts', 'diamonds'].includes(card.suit) ? 'red' : ''}`;
        cardDiv.dataset.value = card.value;
        
        let suitSymbol = '';
        switch(card.suit) {
            case 'hearts': suitSymbol = '♥'; break;
            case 'diamonds': suitSymbol = '♦'; break;
            case 'clubs': suitSymbol = '♣'; break;
            case 'spades': suitSymbol = '♠'; break;
        }
        cardDiv.innerHTML = `${card.value}<br/>${suitSymbol}`;
        myCardsDiv.appendChild(cardDiv);
    });
}

// --- Host Functions ---

async function updateHostControls(state) {
    // Populate select with players
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val() || {};
    
    // Save current selection
    const currentVal = playerSelect.value;
    
    playerSelect.innerHTML = '<option value="">Select a player...</option>';
    Object.keys(players).forEach(id => {
        const total = calculateTotal(state.hands[id]);
        const handLen = state.hands[id] ? state.hands[id].length : 0;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${players[id].name} (Cards: ${handLen})`;
        playerSelect.appendChild(option);
    });

    if (currentVal) playerSelect.value = currentVal;
}

giveCardBtn.addEventListener('click', async () => {
    if (!isHost || !currentRoom) return;
    const targetId = playerSelect.value;
    if (!targetId) {
        showAlert('Error', 'Select a player first.');
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

passBtn.addEventListener('click', async () => {
    // Just to signal end of turn or pass action.
    showAlert('Pass', 'You passed. Select another player or wait.');
});

// --- End Game & Deathmatch Logic ---

async function checkGameEndCondition(state) {
    // In a real game, Host decides when round is over.
    // We add a "End Round" button for host to trigger calculation.
    // For simplicity, let's assume Host clicks a hidden 'End Round' button or we evaluate automatically.
    // Actually, prompt says: "The player with the HIGHEST total value at the end of the round loses".
    // Let's add an End Round button dynamically for Host.
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

    let highestTotal = -1;
    let tiedPlayers = [];

    Object.keys(state.hands).forEach(id => {
        const total = calculateTotal(state.hands[id]);
        if (total > highestTotal) {
            highestTotal = total;
            tiedPlayers = [id];
        } else if (total === highestTotal) {
            tiedPlayers.push(id);
        }
    });

    if (tiedPlayers.length === 1) {
        // One loser
        const loserName = players[tiedPlayers[0]].name;
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'game_over',
            loserName: loserName,
            reason: `Highest total: ${highestTotal}`
        });
    } else if (tiedPlayers.length > 1) {
        // Deathmatch Tie-Breaker
        initDeathmatch(state, tiedPlayers);
    }
}

async function initDeathmatch(state, tiedPlayers) {
    showAlert('TIE BREAKER', 'Multiple players tied for highest score. Entering Deathmatch.');
    
    // Deal 1 random hidden card to tied players
    let dmHands = {};
    tiedPlayers.forEach(id => {
        const card = state.deck.pop();
        // keep it hidden by not showing in normal hands
        dmHands[id] = card; 
    });

    await update(ref(db, `rooms/${currentRoom}/gameState`), {
        status: 'deathmatch_pending',
        dmHands: dmHands,
        deck: state.deck,
        dmCondition: null
    });

    // Show Deathmatch controls for Host
    deathmatchControls.classList.remove('hidden');
    
    // Setup condition buttons
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
        
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'deathmatch_reveal',
            dmCondition: selectedCondition
        });
    };
}

async function handleDeathmatchReveal(state) {
    // Everyone sees the cards revealed
    if (!state.dmHands) return;
    
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val();

    let dmPlayers = Object.keys(state.dmHands).map(id => ({
        id,
        name: players[id].name,
        card: state.dmHands[id]
    }));

    // For UI, we could inject these into the DOM, but for now we calculate loser immediately and show Massive Alert
    
    let loser = dmPlayers[0];
    
    if (state.dmCondition === 'highest') {
        dmPlayers.forEach(p => { if(p.card.numericValue > loser.card.numericValue) loser = p; });
    } else if (state.dmCondition === 'lower') {
        dmPlayers.forEach(p => { if(p.card.numericValue < loser.card.numericValue) loser = p; });
    } else if (state.dmCondition === 'middle') {
        // Middle logic requires sorting
        if (dmPlayers.length >= 3) {
            dmPlayers.sort((a,b) => a.card.numericValue - b.card.numericValue);
            loser = dmPlayers[Math.floor(dmPlayers.length / 2)];
        } else {
            // fallback if only 2 players for middle, just pick highest
            dmPlayers.forEach(p => { if(p.card.numericValue > loser.card.numericValue) loser = p; });
        }
    }

    setTimeout(() => {
        if (isHost) {
            update(ref(db, `rooms/${currentRoom}/gameState`), {
                status: 'game_over',
                loserName: loser.name,
                reason: `Lost Deathmatch (${state.dmCondition}) with card: ${loser.card.value}`
            });
        }
    }, 2000); // 2 second suspense delay before showing massive alert
}

function showLoser(name, reason) {
    massiveAlertText.textContent = `${name.toUpperCase()} LOST`;
    massiveAlertSub.textContent = reason;
    massiveAlert.classList.remove('hidden');
}

closeMassiveAlertBtn.onclick = () => {
    massiveAlert.classList.add('hidden');
    // If host, maybe reset game state or go back to lobby
};
