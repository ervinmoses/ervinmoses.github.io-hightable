import { db } from './firebase-config.js?v=32';
import { ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { showAlert } from './app.js?v=32';

let currentRoom = null;
let myId = null;
let isHost = false;
let gameListeners = [];

// DOM Elements
const playerListRow = document.getElementById('playerListRow');
const adjustPositionRow = document.getElementById('adjustPositionRow');
const adjustPositionBtn = document.getElementById('adjustPositionBtn');
const myCardsArea = document.getElementById('myCardsArea');
const actionButtonsRow = document.getElementById('actionButtonsRow');
const giveCardBtn = document.getElementById('giveCardBtn');
const passBtn = document.getElementById('passBtn');
const restartGameBtn = document.getElementById('restartGameBtn');

const turnProfilePic = document.getElementById('turnProfilePic');
const turnPlayerName = document.getElementById('turnPlayerName');
const turnPlayerCards = document.getElementById('turnPlayerCards');

const adjustPositionModal = document.getElementById('adjustPositionModal');
const draggablePlayerList = document.getElementById('draggablePlayerList');
const saveTurnOrderBtn = document.getElementById('saveTurnOrderBtn');
const cancelTurnOrderBtn = document.getElementById('cancelTurnOrderBtn');
const statusRow = document.getElementById('statusRow');

// Deathmatch UI
const deathmatchTitle = document.getElementById('deathmatchTitle');
const dmHostControlsRow = document.getElementById('dmHostControlsRow');
const dealDmCardsBtn = document.getElementById('dealDmCardsBtn');
const dmBtns = document.querySelectorAll('.dm-btn');

// Loser Animation
const loserAnimationOverlay = document.getElementById('loserAnimationOverlay');
const loserAnimProfilePic = document.getElementById('loserAnimProfilePic');
const loserAnimNameText = document.getElementById('loserAnimNameText');
const loserAnimReasonSub = document.getElementById('loserAnimReasonSub');
const closeLoserAnimBtn = document.getElementById('closeLoserAnimBtn');

let lastKnownState = null;
let lastKnownPlayers = null;
let localTurnOrder = [];

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
    
    const playerIds = Object.keys(players);
    
    let gameState = {
        deck: deck,
        hands: {},
        revealed: {}, 
        passed: {},   
        turnOrder: playerIds,
        currentTurnIndex: 0,
        status: 'playing'
    };

    playerIds.forEach(id => {
        gameState.hands[id] = [deck.pop(), deck.pop()];
        gameState.revealed[id] = [false, false];
    });

    await set(ref(db, `rooms/${roomCode}/gameState`), gameState);
}

export function joinGameListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;

    if (isHost) {
        if(adjustPositionRow) adjustPositionRow.classList.remove('hidden');
        if(restartGameBtn) restartGameBtn.classList.remove('hidden');
    } else {
        if(adjustPositionRow) adjustPositionRow.classList.add('hidden');
        if(restartGameBtn) restartGameBtn.classList.add('hidden');
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

export function leaveGame() {
    gameListeners.forEach(l => {
        if (typeof l.listener === 'function') l.listener();
    });
    gameListeners = [];
    currentRoom = null;
    isHost = false;
    
    if(actionButtonsRow) actionButtonsRow.classList.add('hidden');
    if(adjustPositionRow) adjustPositionRow.classList.add('hidden');
    if(restartGameBtn) restartGameBtn.classList.add('hidden');
    if(dmHostControlsRow) dmHostControlsRow.classList.add('hidden');
    if(deathmatchTitle) deathmatchTitle.classList.add('hidden');
    if(loserAnimationOverlay) loserAnimationOverlay.classList.add('hidden');
}

function renderUI(state, players) {
    if(!playerListRow) return;

    playerListRow.innerHTML = '';
    const me = players[myId];
    
    if (state.status === 'deathmatch_setup' || state.status === 'deathmatch_playing') {
        const tiedIds = state.tiedPlayers || [];
        if (tiedIds.includes(myId) && me) {
            playerListRow.innerHTML += createPlayerBox('You', me.photoUrl, false);
        }
        tiedIds.forEach(id => {
            if (id !== myId && players[id]) {
                playerListRow.innerHTML += createPlayerBox(players[id].name, players[id].photoUrl, false);
            }
        });
        if(statusRow) statusRow.classList.add('hidden');
    } else {
        if(statusRow) statusRow.classList.remove('hidden');
        if (me) {
            playerListRow.innerHTML += createPlayerBox('You', me.photoUrl, state.passed && state.passed[myId]);
        }
        
        if (state.turnOrder) {
            state.turnOrder.forEach(id => {
                if (id !== myId && players[id]) {
                    playerListRow.innerHTML += createPlayerBox(players[id].name, players[id].photoUrl, state.passed && state.passed[id]);
                }
            });
        }
    }

    const myHand = state.hands[myId] || [];
    const myRevealed = state.revealed[myId] || [];
    if(myCardsArea) {
        myCardsArea.innerHTML = '';

        if (state.status === 'deathmatch_setup' || state.status === 'deathmatch_playing') {
            if(deathmatchTitle) deathmatchTitle.classList.remove('hidden');
            
            if (state.dmHands && state.status === 'deathmatch_playing') {
                const tiedIds = state.tiedPlayers || [];
                tiedIds.forEach(id => {
                    const card = state.dmHands[id];
                    const isRevealed = state.dmRevealed && state.dmRevealed[id];
                    
                    const wrapper = document.createElement('div');
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.alignItems = 'center';
                    wrapper.style.gap = '5px';
                    
                    const nameLabel = document.createElement('span');
                    nameLabel.textContent = players[id] ? players[id].name : 'Unknown';
                    nameLabel.style.fontSize = '0.8rem';
                    
                    const cardEl = document.createElement('div');
                    if (isRevealed) {
                        const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
                        let suitSymbol = card.suit === 'hearts' ? '♥' : (card.suit === 'diamonds' ? '♦' : (card.suit === 'clubs' ? '♣' : '♠'));
                        cardEl.className = `playing-card ${redClass}`;
                        cardEl.setAttribute('data-value', card.value);
                        cardEl.setAttribute('data-suit', suitSymbol);
                    } else {
                        cardEl.className = `playing-card back`;
                        if (id === myId) {
                            cardEl.style.cursor = 'pointer';
                            cardEl.onclick = async () => {
                                if (!state.dmRevealed) state.dmRevealed = {};
                                state.dmRevealed[myId] = true;
                                await update(ref(db, `rooms/${currentRoom}/gameState/dmRevealed`), state.dmRevealed);
                            };
                        }
                    }
                    wrapper.appendChild(nameLabel);
                    wrapper.appendChild(cardEl);
                    myCardsArea.appendChild(wrapper);
                });
            }

            if (isHost && state.status === 'deathmatch_setup') {
                if(dmHostControlsRow) dmHostControlsRow.classList.remove('hidden');
            } else {
                if(dmHostControlsRow) dmHostControlsRow.classList.add('hidden');
            }
            if(actionButtonsRow) actionButtonsRow.classList.add('hidden');

            // Auto finalize deathmatch when all revealed
            if (isHost && state.status === 'deathmatch_playing' && state.dmHands && state.dmRevealed) {
                const allRevealed = Object.keys(state.dmHands).every(id => state.dmRevealed[id]);
                if (allRevealed) finalizeDeathmatch(state, state.dmCondition);
            }
            
        } else {
            if(deathmatchTitle) deathmatchTitle.classList.add('hidden');
            if(dmHostControlsRow) dmHostControlsRow.classList.add('hidden');
            
            myHand.forEach((card, index) => {
                const isRevealed = myRevealed[index];
                const cardEl = document.createElement('div');
                if (isRevealed) {
                    const redClass = ['hearts', 'diamonds'].includes(card.suit) ? 'red' : '';
                    let suitSymbol = card.suit === 'hearts' ? '♥' : (card.suit === 'diamonds' ? '♦' : (card.suit === 'clubs' ? '♣' : '♠'));
                    cardEl.className = `playing-card ${redClass}`;
                    cardEl.setAttribute('data-value', card.value);
                    cardEl.setAttribute('data-suit', suitSymbol);
                } else {
                    cardEl.className = `playing-card back`;
                    cardEl.style.cursor = 'pointer';
                }
                
                cardEl.onclick = async () => {
                    if (!isRevealed) {
                        const newRevealed = [...myRevealed];
                        newRevealed[index] = true;
                        await set(ref(db, `rooms/${currentRoom}/gameState/revealed/${myId}`), newRevealed);
                    }
                };
                myCardsArea.appendChild(cardEl);
            });
        }
    }

    if (state.turnOrder && state.turnOrder.length > 0 && state.status === 'playing') {
        const currentTurnId = state.turnOrder[state.currentTurnIndex];
        const turnPlayer = players[currentTurnId];
        
        if (turnPlayer) {
            if(turnPlayerName) turnPlayerName.textContent = currentTurnId === myId ? 'Your Turn' : `${turnPlayer.name}'s Turn`;
            const handLen = state.hands[currentTurnId] ? state.hands[currentTurnId].length : 0;
            if(turnPlayerCards) turnPlayerCards.textContent = `Cards: ${handLen}`;
            
            if(turnProfilePic) {
                if (turnPlayer.photoUrl) {
                    turnProfilePic.style.backgroundImage = `url('${turnPlayer.photoUrl}')`;
                    turnProfilePic.textContent = '';
                    turnProfilePic.style.backgroundColor = 'transparent';
                    turnProfilePic.style.backgroundSize = 'cover';
                    turnProfilePic.style.backgroundPosition = 'center';
                } else {
                    turnProfilePic.style.backgroundImage = 'none';
                    turnProfilePic.textContent = turnPlayer.name.charAt(0);
                    turnProfilePic.style.backgroundColor = '#444';
                }
            }

            // Action buttons (ONLY HOST CAN SEE)
            if (isHost && (!state.passed || !state.passed[currentTurnId])) {
                if(actionButtonsRow) actionButtonsRow.classList.remove('hidden');
                if(giveCardBtn) giveCardBtn.disabled = handLen >= 5;
            } else {
                if(actionButtonsRow) actionButtonsRow.classList.add('hidden');
            }
        }
    } else {
        if(actionButtonsRow) actionButtonsRow.classList.add('hidden');
        if(turnPlayerName) turnPlayerName.textContent = 'Round Over';
        if(turnPlayerCards) turnPlayerCards.textContent = '';
    }

    if (state.status === 'game_over' && state.loserName) {
        showLoser(state.loserName, state.loserPhoto, state.reason);
    }
}

function createPlayerBox(name, photoUrl, isPassed) {
    const opacity = isPassed ? '0.5' : '1';
    const bgStyle = photoUrl ? `background-image: url('${photoUrl}'); background-size: cover; background-position: center;` : '';
    const initial = !photoUrl ? name.charAt(0) : '';
    return `
        <div class="player-box" style="opacity: ${opacity}">
            <div class="profile-pic" style="${bgStyle}">${initial}</div>
            <div class="player-name">${name}</div>
        </div>
    `;
}

function renderAdjustPositionModal() {
    if(!draggablePlayerList) return;
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
                renderAdjustPositionModal();
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
                renderAdjustPositionModal();
            }
        };
    });
}

if (adjustPositionBtn) {
    adjustPositionBtn.onclick = () => {
        if (!isHost || !lastKnownState || !lastKnownPlayers) return;
        localTurnOrder = [...lastKnownState.turnOrder];
        renderAdjustPositionModal();
        if(adjustPositionModal) adjustPositionModal.classList.remove('hidden');
    };
}

if (cancelTurnOrderBtn) {
    cancelTurnOrderBtn.onclick = () => {
        if(adjustPositionModal) adjustPositionModal.classList.add('hidden');
    };
}

if (saveTurnOrderBtn) {
    saveTurnOrderBtn.onclick = async () => {
        if (!isHost || !currentRoom) return;
        
        let currentIdx = lastKnownState.currentTurnIndex;
        if (currentIdx >= localTurnOrder.length) currentIdx = 0;
        
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            turnOrder: localTurnOrder,
            currentTurnIndex: currentIdx
        });
        
        if(adjustPositionModal) adjustPositionModal.classList.add('hidden');
    };
}

async function advanceTurn(state) {
    let nextIdx = state.currentTurnIndex;
    let found = false;
    
    for (let i = 0; i < state.turnOrder.length; i++) {
        nextIdx = (nextIdx + 1) % state.turnOrder.length;
        const pId = state.turnOrder[nextIdx];
        if (!state.passed || !state.passed[pId]) {
            found = true;
            break;
        }
    }
    
    if (found) {
        await set(ref(db, `rooms/${currentRoom}/gameState/currentTurnIndex`), nextIdx);
    } else {
        // Round is over. Calculate who lost.
        calculateLoser(state);
    }
}

async function calculateLoser(state) {
    if (!isHost) return;
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val() || {};

    let maxDistance = -1;
    let tiedPlayers = [];

    const activePlayers = state.turnOrder || [];
    activePlayers.forEach(id => {
        const hand = state.hands[id] || [];
        const total = calculateTotal(hand);
        
        let distance = 0;
        if (total > 21) {
            distance = total - 21; // Busted
        } else if (total < 16) {
            distance = 16 - total; // Penalty for being too low
        }
        
        if (distance > maxDistance) {
            maxDistance = distance;
            tiedPlayers = [id];
        } else if (distance === maxDistance) {
            tiedPlayers.push(id);
        }
    });

    if (maxDistance === 0) {
        // Everyone was safe (16-21). Penalize the lowest score.
        let lowestTotal = 999;
        activePlayers.forEach(id => {
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
        const loser = players[tiedPlayers[0]];
        const reason = maxDistance > 0 ? "Busted or missed safe zone." : "Lowest safe score.";
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'game_over',
            loserName: loser.name,
            loserPhoto: loser.photoUrl || '',
            reason: reason
        });
        showLoser(loser.name, loser.photoUrl, reason);
    } else if (tiedPlayers.length > 1) {
        initDeathmatch(state, tiedPlayers);
    }
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

async function initDeathmatch(state, tiedPlayers) {
    if (!isHost) return;
    await update(ref(db, `rooms/${currentRoom}/gameState`), {
        status: 'deathmatch_setup',
        tiedPlayers: tiedPlayers
    });
}

// Host Deathmatch Controls
let selectedDmCondition = null;
if (dmBtns) {
    dmBtns.forEach(btn => {
        btn.onclick = () => {
            dmBtns.forEach(b => {
                b.classList.remove('primary');
                b.classList.add('secondary');
            });
            btn.classList.remove('secondary');
            btn.classList.add('primary');
            selectedDmCondition = btn.dataset.cond;
            if(dealDmCardsBtn) dealDmCardsBtn.classList.remove('hidden');
        };
    });
}

if (dealDmCardsBtn) {
    dealDmCardsBtn.onclick = async () => {
        if (!selectedDmCondition || !isHost || !currentRoom) return;
        
        const s = (await get(ref(db, `rooms/${currentRoom}/gameState`))).val();
        let dmHands = {};
        s.tiedPlayers.forEach(id => {
            dmHands[id] = s.deck.pop(); 
        });

        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'deathmatch_playing',
            dmHands: dmHands,
            dmRevealed: {},
            deck: s.deck,
            dmCondition: selectedDmCondition
        });
    };
}

async function finalizeDeathmatch(state, condition) {
    if (!isHost) return;
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val();

    let dmPlayers = Object.keys(state.dmHands).map(id => ({
        id,
        name: players[id].name,
        photoUrl: players[id].photoUrl,
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
        // Still tied! Re-run deathmatch setup
        showAlert('TIE AGAIN!', 'Players drew the same value. Dealing again!');
        initDeathmatch(state, tiedLosers.map(p => p.id));
    } else {
        const loser = tiedLosers[0];
        const reason = `Lost Deathmatch (${condition}) with: ${loser.card.value}`;
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            status: 'game_over',
            loserName: loser.name,
            loserPhoto: loser.photoUrl || '',
            reason: reason
        });
    }
}

function showLoser(name, photoUrl, reason) {
    if (!loserAnimationOverlay) return;
    loserAnimNameText.textContent = name;
    loserAnimReasonSub.textContent = reason;
    
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

if (closeLoserAnimBtn) {
    closeLoserAnimBtn.onclick = async () => {
        loserAnimationOverlay.classList.add('hidden');
        if (isHost && currentRoom) {
            await update(ref(db, `rooms/${currentRoom}`), {
                status: 'waiting',
                gameState: null
            });
        }
    };
}

if (passBtn) {
    passBtn.onclick = async () => {
        if (!isHost || !lastKnownState) return;
        const currentTurnId = lastKnownState.turnOrder[lastKnownState.currentTurnIndex];
        
        const passed = lastKnownState.passed || {};
        passed[currentTurnId] = true;
        
        await update(ref(db, `rooms/${currentRoom}/gameState/passed`), passed);
        await advanceTurn({ ...lastKnownState, passed });
    };
}

if (giveCardBtn) {
    giveCardBtn.onclick = async () => {
        if (!isHost || !lastKnownState) return;
        const currentTurnId = lastKnownState.turnOrder[lastKnownState.currentTurnIndex];
        
        let hand = lastKnownState.hands[currentTurnId] || [];
        if (hand.length >= 5) {
            showAlert('Limit Reached', 'Player cannot draw more than 5 cards.');
            return;
        }
        
        let deck = lastKnownState.deck || [];
        if (deck.length === 0) return;
        
        const newCard = deck.pop();
        hand.push(newCard);
        
        const revealed = lastKnownState.revealed[currentTurnId] || [];
        revealed.push(false);
        
        await update(ref(db, `rooms/${currentRoom}/gameState`), {
            deck: deck,
            [`hands/${currentTurnId}`]: hand,
            [`revealed/${currentTurnId}`]: revealed
        });
        
        // Always advance turn (Round Robin)
        // If they just hit the 5 card limit, auto-pass them for future rounds
        if (hand.length >= 5) {
            const passed = lastKnownState.passed || {};
            passed[currentTurnId] = true;
            await update(ref(db, `rooms/${currentRoom}/gameState/passed`), passed);
            await advanceTurn({ ...lastKnownState, passed });
        } else {
            await advanceTurn(lastKnownState);
        }
    };
}

if (restartGameBtn) {
    restartGameBtn.onclick = async () => {
        if (!isHost || !currentRoom) return;
        await update(ref(db, `rooms/${currentRoom}`), {
            status: 'waiting',
            gameState: null
        });
    };
}
