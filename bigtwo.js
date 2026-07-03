import { db } from './firebase-config.js?v=32';
import { ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { showAlert } from './app.js?v=33';

let currentRoom = null;
let myId = null;
let isHost = false;
let gameListeners = [];

// DOM Elements
const bigTwoTablePlayers = document.getElementById('bigTwoTablePlayers');
const bigTwoCurrentTrick = document.getElementById('bigTwoCurrentTrick');
const bigTwoAdjustPositionRow = document.getElementById('bigTwoAdjustPositionRow');
const bigTwoAdjustPositionBtn = document.getElementById('bigTwoAdjustPositionBtn');
const bigTwoMyCardsArea = document.getElementById('bigTwoMyCardsArea');
const bigTwoRevealBtn = document.getElementById('bigTwoRevealBtn');
const bigTwoActionButtonsRow = document.getElementById('bigTwoActionButtonsRow');
const bigTwoHitBtn = document.getElementById('bigTwoHitBtn');
const bigTwoPassBtn = document.getElementById('bigTwoPassBtn');
const bigTwoOpenNewBtn = document.getElementById('bigTwoOpenNewBtn');
const bigTwoStatusRow = document.getElementById('bigTwoStatusRow');
const bigTwoTurnProfilePic = document.getElementById('bigTwoTurnProfilePic');
const bigTwoTurnPlayerName = document.getElementById('bigTwoTurnPlayerName');
const bigTwoTurnPlayerCards = document.getElementById('bigTwoTurnPlayerCards');
const restartBigTwoBtn = document.getElementById('restartBigTwoBtn');

// Modals (reusing the one from 21 card game)
const adjustPositionModal = document.getElementById('adjustPositionModal');
const draggablePlayerList = document.getElementById('draggablePlayerList');
const saveTurnOrderBtn = document.getElementById('saveTurnOrderBtn');
const cancelTurnOrderBtn = document.getElementById('cancelTurnOrderBtn');
const loserAnimationOverlay = document.getElementById('loserAnimationOverlay');
const loserAnimNameText = document.getElementById('loserAnimNameText');
const loserAnimReasonSub = document.getElementById('loserAnimReasonSub');
const loserAnimProfilePic = document.getElementById('loserAnimProfilePic');

let lastKnownState = null;
let lastKnownPlayers = null;
let localTurnOrder = [];
let selectedCards = []; // Indices of selected cards in my hand
let allRevealed = false;

// Card Definitions
const SUITS = ['diamonds', 'clubs', 'hearts', 'spades'];
const VALUES = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

function getRank(value) {
    return VALUES.indexOf(value) + 3; // 3 is 3, 2 is 15
}

function getSuitRank(suit) {
    return SUITS.indexOf(suit) + 1; // diamonds=1, clubs=2, hearts=3, spades=4
}

// Generate and shuffle deck
function generateDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({
                suit,
                value,
                rank: getRank(value),
                suitRank: getSuitRank(suit)
            });
        }
    }
    // Secure random shuffle
    const array = new Uint32Array(deck.length);
    window.crypto.getRandomValues(array);
    for (let i = deck.length - 1; i > 0; i--) {
        const j = array[i] % (i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Helper: Check if hand has 3 of diamonds
function has3OfDiamonds(hand) {
    return hand.some(c => c.value === '3' && c.suit === 'diamonds');
}

export async function initBigTwo(roomCode) {
    const deck = generateDeck();
    const playersSnapshot = await get(ref(db, `rooms/${roomCode}/players`));
    const players = playersSnapshot.val() || {};

    const playerIds = Object.keys(players);
    let hands = {};
    playerIds.forEach(id => {
        hands[id] = [];
    });

    // Deal cards evenly
    let curr = 0;
    while (deck.length > 0 && curr < 52) { // up to 13 each for 4 players
        const pId = playerIds[curr % playerIds.length];
        hands[pId].push(deck.pop());
        curr++;
    }

    // Sort hands by rank, then suit
    playerIds.forEach(id => {
        hands[id].sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.suitRank - b.suitRank;
        });
    });

    // Find who has 3 of diamonds
    let starterIndex = 0;
    for (let i = 0; i < playerIds.length; i++) {
        if (has3OfDiamonds(hands[playerIds[i]])) {
            starterIndex = i;
            break;
        }
    }

    let gameState = {
        hands: hands,
        turnOrder: playerIds,
        currentTurnIndex: starterIndex,
        currentTrick: null, // { cards: [], playedBy: 'playerId' }
        previousTrick: null,
        passedPlayers: {},
        status: 'playing',
        winner: null,
        firstPlay: true // 3 of diamonds must be played first
    };

    await set(ref(db, `rooms/${roomCode}/gameState`), gameState);
}

export function joinBigTwoListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;
    selectedCards = [];
    allRevealed = false;

    if (isHost) {
        if (bigTwoAdjustPositionRow) bigTwoAdjustPositionRow.classList.remove('hidden');
        if (restartBigTwoBtn) restartBigTwoBtn.classList.remove('hidden');
    } else {
        if (bigTwoAdjustPositionRow) bigTwoAdjustPositionRow.classList.add('hidden');
        if (restartBigTwoBtn) restartBigTwoBtn.classList.add('hidden');
    }

    const stateRef = ref(db, `rooms/${roomCode}/gameState`);
    const listener = onValue(stateRef, async (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
        const players = playersSnapshot.val() || {};

        lastKnownState = state;
        lastKnownPlayers = players;

        renderUI(state, players);
    });

    gameListeners.push({ ref: stateRef, listener });
}

export function leaveBigTwo() {
    gameListeners.forEach(l => {
        if (typeof l.listener === 'function') l.listener();
    });
    gameListeners = [];
    currentRoom = null;
    isHost = false;
    selectedCards = [];
    allRevealed = false;

    if (bigTwoActionButtonsRow) bigTwoActionButtonsRow.classList.add('hidden');
    if (bigTwoAdjustPositionRow) bigTwoAdjustPositionRow.classList.add('hidden');
    if (restartBigTwoBtn) restartBigTwoBtn.classList.add('hidden');
    if (loserAnimationOverlay) loserAnimationOverlay.classList.add('hidden');
}

function getSuitSymbol(suit) {
    if (suit === 'hearts') return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'clubs') return '♣';
    return '♠';
}

function renderUI(state, players) {
    // 1. Render Table Players
    if (bigTwoTablePlayers) {
        bigTwoTablePlayers.innerHTML = '';
        state.turnOrder.forEach(id => {
            const p = players[id];
            if (!p) return;
            const hand = state.hands && state.hands[id] ? state.hands[id] : [];
            const isPassed = state.passedPlayers && state.passedPlayers[id];
            const isMyTurn = state.status === 'playing' && state.turnOrder[state.currentTurnIndex] === id;

            let bgStyle = p.photoUrl ? `background-image: url('${p.photoUrl}'); background-size: cover; background-position: center;` : '';
            let initial = !p.photoUrl ? p.name.charAt(0) : '';
            let borderStyle = isMyTurn ? 'border: 2px solid var(--accent-color); box-shadow: 0 0 10px var(--accent-color);' : '';
            let opacity = isPassed ? '0.5' : '1';

            const box = document.createElement('div');
            box.className = 'big-two-player-box';
            box.style.opacity = opacity;
            box.innerHTML = `
                <div class="profile-pic" style="${bgStyle} ${borderStyle}">${initial}</div>
                <div class="player-name mt-10" style="font-size: 0.9em;">${p.name}</div>
                <div style="color: #aaa; font-size: 0.8em; margin-top: 5px;">${hand.length} cards</div>
            `;
            bigTwoTablePlayers.appendChild(box);
        });
    }

    const FAN_ANGLES = {
        1: [0],
        2: [-15, 15],
        3: [-15, 0, 15],
        4: [-20, -7, 7, 20],
        5: [-25, -12, 0, 12, 25]
    };

    function applyFanStyle(cardEl, index, totalCards) {
        const angles = FAN_ANGLES[totalCards] || FAN_ANGLES[5];
        const rot = angles[index] || 0;
        cardEl.style.transform = `rotate(${rot}deg)`;
        cardEl.style.transformOrigin = 'bottom center';
        if (index > 0) cardEl.style.marginLeft = '-35px';
    }

    // 2. Render Current Trick
    if (bigTwoCurrentTrick) {
        bigTwoCurrentTrick.innerHTML = '';
        bigTwoCurrentTrick.style.position = 'relative';
        if (state.currentTrick && state.currentTrick.cards) {
            const total = state.currentTrick.cards.length;
            state.currentTrick.cards.forEach((card, idx) => {
                const cardEl = document.createElement('div');
                const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
                cardEl.className = `playing-card big-two-card ${redClass}`;
                cardEl.setAttribute('data-value', card.value);
                cardEl.setAttribute('data-suit', getSuitSymbol(card.suit));
                applyFanStyle(cardEl, idx, total);
                bigTwoCurrentTrick.appendChild(cardEl);
            });
            const trickInfo = document.createElement('div');
            trickInfo.style.position = 'absolute';
            trickInfo.style.bottom = '-25px';
            trickInfo.style.width = '100%';
            trickInfo.style.textAlign = 'center';
            trickInfo.style.color = '#aaa';
            trickInfo.style.fontSize = '0.9em';
            trickInfo.textContent = `Played by ${players[state.currentTrick.playedBy]?.name || 'Unknown'}`;
            bigTwoCurrentTrick.appendChild(trickInfo);
        } else {
            bigTwoCurrentTrick.innerHTML = '<span style="color:#666;">No cards played yet.</span>';
        }
    }

    // 2.5 Render Previous Trick
    const bigTwoPreviousTrick = document.getElementById('bigTwoPreviousTrick');
    if (bigTwoPreviousTrick) {
        bigTwoPreviousTrick.innerHTML = '';
        if (state.previousTrick && state.previousTrick.cards) {
            const total = state.previousTrick.cards.length;
            state.previousTrick.cards.forEach((card, idx) => {
                const cardEl = document.createElement('div');
                const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
                cardEl.className = `playing-card big-two-card ${redClass}`;
                cardEl.setAttribute('data-value', card.value);
                cardEl.setAttribute('data-suit', getSuitSymbol(card.suit));
                applyFanStyle(cardEl, idx, total);
                bigTwoPreviousTrick.appendChild(cardEl);
            });
        }
    }

    // 3. Render My Hand
    if (bigTwoMyCardsArea) {
        bigTwoMyCardsArea.innerHTML = '';
        const myHand = state.hands && state.hands[myId] ? state.hands[myId] : [];

        myHand.forEach((card, index) => {
            const cardEl = document.createElement('div');
            if (allRevealed) {
                const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
                cardEl.className = `playing-card big-two-card ${redClass}`;
                cardEl.setAttribute('data-value', card.value);
                cardEl.setAttribute('data-suit', getSuitSymbol(card.suit));
            } else {
                cardEl.className = `playing-card big-two-card back`;
            }

            if (selectedCards.includes(index)) {
                cardEl.classList.add('selected');
            }

            cardEl.style.cursor = 'pointer';
            cardEl.onclick = () => {
                if (!allRevealed) return; // Must reveal to select
                const selIdx = selectedCards.indexOf(index);
                if (selIdx > -1) {
                    selectedCards.splice(selIdx, 1);
                } else {
                    selectedCards.push(index);
                }
                renderUI(lastKnownState, lastKnownPlayers);
            };

            bigTwoMyCardsArea.appendChild(cardEl);
        });
    }

    // 4. Status Row & Controls
    const currentTurnId = state.turnOrder ? state.turnOrder[state.currentTurnIndex] : null;
    const isMyTurn = state.status === 'playing' && currentTurnId === myId;

    if (bigTwoStatusRow) {
        if (state.status === 'game_over') {
            bigTwoTurnPlayerName.textContent = state.winnerName ? `${state.winnerName} WINS!` : 'Game Over';
            bigTwoTurnPlayerCards.textContent = '';
        } else if (currentTurnId && players[currentTurnId]) {
            bigTwoTurnPlayerName.textContent = isMyTurn ? 'Your Turn' : `${players[currentTurnId].name}'s Turn`;
            const count = state.hands && state.hands[currentTurnId] ? state.hands[currentTurnId].length : 0;
            bigTwoTurnPlayerCards.textContent = `Cards: ${count}`;

            if (bigTwoTurnProfilePic) {
                const p = players[currentTurnId];
                if (p.photoUrl) {
                    bigTwoTurnProfilePic.style.backgroundImage = `url('${p.photoUrl}')`;
                    bigTwoTurnProfilePic.textContent = '';
                    bigTwoTurnProfilePic.style.backgroundSize = 'cover';
                    bigTwoTurnProfilePic.style.backgroundPosition = 'center';
                } else {
                    bigTwoTurnProfilePic.style.backgroundImage = 'none';
                    bigTwoTurnProfilePic.textContent = p.name.charAt(0);
                    bigTwoTurnProfilePic.style.backgroundColor = '#444';
                }
            }
        }
    }

    if (bigTwoActionButtonsRow) {
        if (isMyTurn) {
            bigTwoActionButtonsRow.classList.remove('hidden');

            // Check trick ownership (if everyone else passed)
            let trickBelongsToMe = false;
            if (state.currentTrick && state.currentTrick.playedBy === myId) {
                trickBelongsToMe = true;
            } else if (!state.currentTrick) {
                trickBelongsToMe = true;
            }

            if (trickBelongsToMe && !state.firstPlay) {
                bigTwoOpenNewBtn.classList.remove('hidden');
                bigTwoPassBtn.classList.add('hidden'); // Cannot pass your own trick
            } else {
                bigTwoOpenNewBtn.classList.add('hidden');
                bigTwoPassBtn.classList.remove('hidden');
            }

            // You cannot pass if it's the very first play (must play 3 of diamonds)
            if (state.firstPlay) {
                bigTwoPassBtn.classList.add('hidden');
            }
        } else {
            bigTwoActionButtonsRow.classList.add('hidden');
        }
    }

    if (state.status === 'game_over' && state.winnerName) {
        showGameOver(state.winnerName, state.winnerPhoto);
    }
}

if (bigTwoRevealBtn) {
    bigTwoRevealBtn.onclick = () => {
        allRevealed = true;
        bigTwoRevealBtn.disabled = true;
        bigTwoRevealBtn.textContent = 'Revealed';
        if (lastKnownState && lastKnownPlayers) renderUI(lastKnownState, lastKnownPlayers);
    };
}

// Hand Validation Logic
function getCombination(cards) {
    const len = cards.length;
    if (len === 1) return { type: 'single', value: cards[0].rank, suit: cards[0].suitRank };
    if (len === 2) {
        if (cards[0].rank === cards[1].rank) {
            return { type: 'pair', value: cards[0].rank, suit: Math.max(cards[0].suitRank, cards[1].suitRank) };
        }
    }
    if (len === 3) {
        if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) {
            return { type: 'triple', value: cards[0].rank };
        }
    }
    if (len === 4) {
        if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank && cards[2].rank === cards[3].rank) {
            return { type: 'four_kind_4', value: cards[0].rank };
        }
    }
    if (len === 5) {
        // Sort for 5-card eval
        let sorted = [...cards].sort((a, b) => a.rank - b.rank);
        let isFlush = cards.every(c => c.suit === cards[0].suit);
        let isStraight = true;
        for (let i = 1; i < 5; i++) {
            if (sorted[i].rank !== sorted[i - 1].rank + 1) {
                isStraight = false;
                break;
            }
        }

        // Count frequencies
        let freqs = {};
        cards.forEach(c => freqs[c.rank] = (freqs[c.rank] || 0) + 1);
        let counts = Object.values(freqs).sort((a, b) => b - a);
        let mainRank = -1;

        if (isStraight && isFlush) return { type: 'straight_flush', value: sorted[4].rank, suit: sorted[4].suitRank };

        if (counts[0] === 4) {
            for (let r in freqs) if (freqs[r] === 4) mainRank = parseInt(r);
            return { type: 'four_kind', value: mainRank };
        }
        if (counts[0] === 3 && counts[1] === 2) {
            for (let r in freqs) if (freqs[r] === 3) mainRank = parseInt(r);
            return { type: 'full_house', value: mainRank };
        }
        if (isFlush) return { type: 'flush', value: sorted[4].rank, suit: sorted[4].suitRank };
        if (isStraight) return { type: 'straight', value: sorted[4].rank, suit: sorted[4].suitRank };
    }
    return null;
}

const FIVE_CARD_RANKS = {
    'straight': 1,
    'flush': 2,
    'full_house': 3,
    'four_kind': 4,
    'straight_flush': 5
};

function canBeat(playCombo, trickCombo) {
    if (playCombo.type !== trickCombo.type) {
        // Only 5-card hands can beat other 5-card hands of different types
        if (FIVE_CARD_RANKS[playCombo.type] && FIVE_CARD_RANKS[trickCombo.type]) {
            return FIVE_CARD_RANKS[playCombo.type] > FIVE_CARD_RANKS[trickCombo.type];
        }
        return false;
    }

    // Same type
    if (playCombo.value > trickCombo.value) return true;
    if (playCombo.value === trickCombo.value && playCombo.suit !== undefined && trickCombo.suit !== undefined) {
        return playCombo.suit > trickCombo.suit;
    }
    return false;
}

if (bigTwoHitBtn) {
    bigTwoHitBtn.onclick = async () => {
        if (!lastKnownState || selectedCards.length === 0) return;

        const myHand = lastKnownState.hands[myId];
        const selectedObj = selectedCards.map(i => myHand[i]);

        // Rule 1: Validate combination
        const combo = getCombination(selectedObj);
        if (!combo) {
            showAlert('Invalid Play', 'The selected cards do not form a valid Big Two combination.');
            return;
        }

        // Rule 2: If first play of the game, must include 3 of Diamonds
        if (lastKnownState.firstPlay) {
            if (!has3OfDiamonds(selectedObj)) {
                showAlert('Invalid Play', 'You must include the 3 of Diamonds in the first play.');
                return;
            }
        }

        // Rule 3: Must beat current trick (unless opening new)
        if (lastKnownState.currentTrick && lastKnownState.currentTrick.playedBy !== myId) {
            const currentCards = lastKnownState.currentTrick.cards;
            if (selectedObj.length !== currentCards.length) {
                showAlert('Invalid Play', `You must play ${currentCards.length} cards.`);
                return;
            }
            const currentCombo = getCombination(currentCards);
            if (!canBeat(combo, currentCombo)) {
                showAlert('Invalid Play', 'Your combination does not beat the current trick.');
                return;
            }
        }

        // Valid play! 
        // 1. Remove cards from hand
        let newHand = myHand.filter((_, i) => !selectedCards.includes(i));

        // 2. Set current trick
        let newTrick = {
            cards: selectedObj,
            playedBy: myId
        };

        let newPreviousTrick = lastKnownState.previousTrick;
        if (lastKnownState.currentTrick && lastKnownState.currentTrick.playedBy !== myId) {
            newPreviousTrick = lastKnownState.currentTrick;
        } else if (!lastKnownState.currentTrick) {
            newPreviousTrick = null;
        }

        // 3. Clear passes, everyone can play again
        let newPassed = {};

        // Check for win
        if (newHand.length === 0) {
            // I WIN
            await update(ref(db, `rooms/${currentRoom}/gameState`), {
                [`hands/${myId}`]: newHand,
                currentTrick: newTrick,
                previousTrick: newPreviousTrick,
                passedPlayers: newPassed,
                status: 'game_over',
                winnerName: lastKnownPlayers[myId].name,
                winnerPhoto: lastKnownPlayers[myId].photoUrl || ''
            });
            return;
        }

        selectedCards = [];
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            [`hands/${myId}`]: newHand,
            currentTrick: newTrick,
            previousTrick: newPreviousTrick,
            passedPlayers: newPassed,
            firstPlay: false
        });

        await advanceTurnBigTwo(lastKnownState, newPassed);
    };
}

if (bigTwoPassBtn) {
    bigTwoPassBtn.onclick = async () => {
        if (!lastKnownState) return;

        const passed = lastKnownState.passedPlayers || {};
        passed[myId] = true;

        await update(ref(db, `rooms/${currentRoom}/gameState/passedPlayers`), passed);
        await advanceTurnBigTwo(lastKnownState, passed);
    };
}

if (bigTwoOpenNewBtn) {
    bigTwoOpenNewBtn.onclick = async () => {
        if (!lastKnownState) return;

        // Clear trick and allow current player to play anything
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            previousTrick: lastKnownState.currentTrick,
            currentTrick: null,
            passedPlayers: {}
        });
        // Keeps it as my turn
    };
}

async function advanceTurnBigTwo(state, currentPassed) {
    let nextIdx = state.currentTurnIndex;
    let found = false;

    // Find next player who hasn't passed and hasn't won (0 cards)
    for (let i = 0; i < state.turnOrder.length; i++) {
        nextIdx = (nextIdx + 1) % state.turnOrder.length;
        const pId = state.turnOrder[nextIdx];
        const hand = state.hands[pId] || [];
        if ((!currentPassed || !currentPassed[pId]) && hand.length > 0) {
            found = true;
            break;
        }
    }

    if (found) {
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            currentTurnIndex: nextIdx
        });
    }
}

function showGameOver(name, photoUrl) {
    if (!loserAnimationOverlay) return;
    loserAnimNameText.textContent = `${name} WINS!`;
    loserAnimNameText.style.color = 'gold';
    loserAnimReasonSub.textContent = 'They cleared all their cards.';

    if (photoUrl) {
        loserAnimProfilePic.style.backgroundImage = `url('${photoUrl}')`;
        loserAnimProfilePic.textContent = '';
        loserAnimProfilePic.style.backgroundSize = 'cover';
        loserAnimProfilePic.style.backgroundPosition = 'center';
    } else {
        loserAnimProfilePic.style.backgroundImage = 'none';
        loserAnimProfilePic.textContent = name.charAt(0);
    }

    loserAnimationOverlay.classList.remove('hidden');
}

if (document.getElementById('closeLoserAnimBtn')) {
    // This is shared, only close it
    document.getElementById('closeLoserAnimBtn').addEventListener('click', async () => {
        if (loserAnimationOverlay) loserAnimationOverlay.classList.add('hidden');
        if (isHost && currentRoom && lastKnownState && lastKnownState.status === 'game_over' && document.getElementById('bigTwoGame').classList.contains('active')) {
            await update(ref(db, `rooms/${currentRoom}`), {
                status: 'waiting',
                gameState: null
            });
        }
    });
}

// Adjust turn order logic for Big Two
if (bigTwoAdjustPositionBtn) {
    bigTwoAdjustPositionBtn.onclick = () => {
        if (!isHost || !lastKnownState || !lastKnownPlayers) return;
        localTurnOrder = [...lastKnownState.turnOrder];
        renderAdjustPositionModalBigTwo();
        if (adjustPositionModal) adjustPositionModal.classList.remove('hidden');
    };
}

function renderAdjustPositionModalBigTwo() {
    if (!draggablePlayerList) return;
    draggablePlayerList.innerHTML = '';
    localTurnOrder.forEach((id, index) => {
        if (!lastKnownPlayers[id]) return;
        const li = document.createElement('li');
        li.className = 'draggable-item';
        li.dataset.id = id;
        li.innerHTML = `
            <span>${lastKnownPlayers[id].name}</span>
            <div>
                <button class="btn sm secondary move-up" data-idx="${index}">↑</button>
                <button class="btn sm secondary move-down" data-idx="${index}">↓</button>
            </div>
        `;
        draggablePlayerList.appendChild(li);
    });

    draggablePlayerList.querySelectorAll('.move-up').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if (idx > 0) {
                const temp = localTurnOrder[idx];
                localTurnOrder[idx] = localTurnOrder[idx - 1];
                localTurnOrder[idx - 1] = temp;
                renderAdjustPositionModalBigTwo();
            }
        };
    });

    draggablePlayerList.querySelectorAll('.move-down').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if (idx < localTurnOrder.length - 1) {
                const temp = localTurnOrder[idx];
                localTurnOrder[idx] = localTurnOrder[idx + 1];
                localTurnOrder[idx + 1] = temp;
                renderAdjustPositionModalBigTwo();
            }
        };
    });
}

// Ensure host can save turn order
if (saveTurnOrderBtn) {
    saveTurnOrderBtn.addEventListener('click', async () => {
        if (!isHost || !currentRoom) return;

        // This button is shared with 21 card game, we need to check if we are in Big Two
        if (document.getElementById('bigTwoGame').classList.contains('active') && lastKnownState) {
            let currentIdx = lastKnownState.currentTurnIndex;
            if (currentIdx >= localTurnOrder.length) currentIdx = 0;

            await update(ref(db, `rooms/${currentRoom}/gameState`), {
                turnOrder: localTurnOrder,
                currentTurnIndex: currentIdx
            });

            if (adjustPositionModal) adjustPositionModal.classList.add('hidden');
        }
    });
}
