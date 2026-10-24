import { db } from './firebase-config.js?v=40';
import { ref, set, onValue, update, remove, get, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { initGame, joinGameListener, leaveGame } from './21card.js?v=40';
import { initWheelGame, joinWheelListener, leaveWheelGame } from './wheel.js?v=40';
import { initAvalon, joinAvalonListener, leaveAvalon } from './avalon.js?v=40';
import { playYourTurnAlert } from './sound.js?v=40';

// ---- DOM Elements ----
const views = document.querySelectorAll('.view');
const customModal = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

// Registration Fallback
const playerNameInput = document.getElementById('playerNameInput');
const registerBtn = document.getElementById('registerBtn');

// Home / Lobby
const cardGamesBtn = document.getElementById('cardGamesBtn');
const avalonBtn = document.getElementById('avalonBtn');
const spinWheelBtn = document.getElementById('spinWheelBtn');
const createGameBtn = document.getElementById('createGameBtn');
const publicRoomsList = document.getElementById('publicRoomsList');
const backToHomeBtn = document.getElementById('backToHomeBtn');
const quickRoomCodeInput = document.getElementById('quickRoomCodeInput');
const quickJoinBtn = document.getElementById('quickJoinBtn');

// Active Lobby
const activeLobby = document.getElementById('activeLobby');
const displayRoomCode = document.getElementById('displayRoomCode');
const connectedPlayersList = document.getElementById('connectedPlayers');
const playerCount = document.getElementById('playerCount');
const startGameBtn = document.getElementById('startGameBtn');
const lobbyActions = document.querySelector('.lobby-actions');
const roomCodeBadge = document.getElementById('roomCodeBadge');

// Profile Edit Modal
const topbarPlayerChip = document.getElementById('topbarPlayerChip');
const editProfileModal = document.getElementById('editProfileModal');
const editPlayerNameInput = document.getElementById('editPlayerNameInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelProfileBtn = document.getElementById('cancelProfileBtn');

// Game Room
const gameRoomCode = document.getElementById('gameRoomCode');
const leaveGameBtn = document.getElementById('leaveGameBtn');
const myRoleText = document.getElementById('myRoleText');
const myPlayerName = document.getElementById('myPlayerName');

// ---- State ----
export let currentPlayer = {
    name: '',
    id: '',
    isHost: false,
    roomCode: null,
    photoUrl: ''
};

export let currentGameType = '21';
export let activeLobbyRef = null;
export let activeStatusRef = null;
let startGameLock = false;

// ---- Telegram Haptics Helper ----
export function triggerHaptic(type = 'light') {
    try {
        if (window.Telegram?.WebApp?.HapticFeedback) {
            if (type === 'success' || type === 'error' || type === 'warning') {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
            } else {
                window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
            }
        }
    } catch (e) {}
}

// ---- Toast Notification ----
export function showToast(message) {
    const toast = document.getElementById('toastNotice');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2200);
}

// ---- View Routing ----
export function switchView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

// ---- Modals ----
export function showAlert(title, message) {
    modalTitle.textContent = title;
    modalBody.innerHTML = message;
    customModal.classList.remove('hidden');
    triggerHaptic('warning');
}

modalClose.addEventListener('click', () => {
    customModal.classList.add('hidden');
    triggerHaptic('light');
});

// ---- Topbar Profile UI ----
function updatePlayerProfileUI() {
    const topbarPlayerName = document.getElementById('topbarPlayerName');
    const topbarAvatar = document.getElementById('topbarAvatar');
    if (topbarPlayerName) topbarPlayerName.textContent = currentPlayer.name;
    if (topbarAvatar) {
        if (currentPlayer.photoUrl) {
            topbarAvatar.style.backgroundImage = `url('${currentPlayer.photoUrl}')`;
            topbarAvatar.textContent = '';
        } else {
            topbarAvatar.style.backgroundImage = 'none';
            topbarAvatar.textContent = (currentPlayer.name || 'VIP').substring(0, 2).toUpperCase();
        }
    }
}

// ---- Direct Instant Startup (No 7-Second Wait) ----
function initAppFlow() {
    const tg = window.Telegram?.WebApp;
    if (tg) {
        tg.expand();
        tg.ready();
    }

    const tgUser = tg?.initDataUnsafe?.user;

    if (tgUser && tgUser.first_name) {
        currentPlayer.name = tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '');
        currentPlayer.id = tgUser.id.toString();
        currentPlayer.photoUrl = tgUser.photo_url || '';
    } else {
        const savedName = localStorage.getItem('playerName');
        const savedId = localStorage.getItem('playerId');
        const savedPhoto = localStorage.getItem('playerPhoto') || '';
        
        if (savedName && savedId) {
            currentPlayer.name = savedName;
            currentPlayer.id = savedId;
            currentPlayer.photoUrl = savedPhoto;
        } else {
            const guestNum = Math.floor(1000 + Math.random() * 9000);
            currentPlayer.name = `Player_${guestNum}`;
            currentPlayer.id = 'user_' + Math.random().toString(36).substr(2, 9);
            currentPlayer.photoUrl = '';
        }
    }

    localStorage.setItem('playerName', currentPlayer.name);
    localStorage.setItem('playerId', currentPlayer.id);
    localStorage.setItem('playerPhoto', currentPlayer.photoUrl);

    updatePlayerProfileUI();
    // Directly go to main page instantly!
    switchView('home');
}

// Run immediately
initAppFlow();

// ---- Profile Customization Modal Handlers ----
if (topbarPlayerChip && editProfileModal) {
    topbarPlayerChip.addEventListener('click', () => {
        triggerHaptic('light');
        editPlayerNameInput.value = currentPlayer.name;
        editProfileModal.classList.remove('hidden');
        editPlayerNameInput.focus();
    });

    cancelProfileBtn.addEventListener('click', () => {
        triggerHaptic('light');
        editProfileModal.classList.add('hidden');
    });

    saveProfileBtn.addEventListener('click', async () => {
        const newName = editPlayerNameInput.value.trim();
        if (newName.length < 2) {
            showAlert('Name too short', 'Player name must be at least 2 characters.');
            return;
        }
        currentPlayer.name = newName;
        localStorage.setItem('playerName', newName);
        updatePlayerProfileUI();
        editProfileModal.classList.add('hidden');
        showToast(`Profile name updated: ${newName}`);
        triggerHaptic('success');

        if (currentPlayer.roomCode) {
            try {
                await update(ref(db, `rooms/${currentPlayer.roomCode}/players/${currentPlayer.id}`), {
                    name: newName
                });
            } catch (e) {}
        }
    });
}

// ---- Copy Room Code on Tap ----
if (roomCodeBadge) {
    roomCodeBadge.addEventListener('click', () => {
        const code = displayRoomCode.textContent;
        if (code && code !== '----') {
            navigator.clipboard.writeText(code).then(() => {
                showToast(`Table code #${code} copied!`);
                triggerHaptic('success');
            }).catch(() => {
                showToast(`Table code: ${code}`);
            });
        }
    });
}

// ---- Direct Quick Code Join ----
if (quickJoinBtn && quickRoomCodeInput) {
    const handleQuickJoin = () => {
        const code = quickRoomCodeInput.value.trim().toUpperCase();
        if (code.length < 3) {
            showAlert('Invalid Code', 'Please enter a valid table code (e.g. 8492).');
            return;
        }
        if (currentPlayer.roomCode) {
            showAlert('Already in a room', 'Leave your current table before joining another.');
            return;
        }
        triggerHaptic('medium');
        currentPlayer.isHost = false;
        currentPlayer.roomCode = code;
        joinRoom(code);
    };

    quickJoinBtn.addEventListener('click', handleQuickJoin);
    quickRoomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleQuickJoin();
    });
}

// ---- Registration Fallback Handler ----
if (registerBtn && playerNameInput) {
    registerBtn.addEventListener('click', () => {
        const name = playerNameInput.value.trim();
        if (name.length < 2) {
            showAlert('Error', 'Name must be at least 2 characters.');
            return;
        }
        const id = 'user_' + Math.random().toString(36).substr(2, 9);
        currentPlayer.name = name;
        currentPlayer.id = id;
        currentPlayer.photoUrl = '';
        localStorage.setItem('playerName', name);
        localStorage.setItem('playerId', id);
        localStorage.setItem('playerPhoto', '');
        updatePlayerProfileUI();
        switchView('home');
        triggerHaptic('success');
    });
}

// ---- Navigation ----
backToHomeBtn.addEventListener('click', () => {
    triggerHaptic('light');
    if (currentPlayer.roomCode) {
        leaveRoom();
    }
    switchView('home');
});

// Game selection cards
avalonBtn.addEventListener('click', () => {
    triggerHaptic('light');
    currentGameType = 'avalon';
    document.getElementById('lobbyTitle').textContent = 'Avalon Table';
    switchView('lobby');
});

cardGamesBtn.addEventListener('click', () => {
    triggerHaptic('light');
    currentGameType = '21';
    document.getElementById('lobbyTitle').textContent = '21 Card Table';
    switchView('lobby');
});

spinWheelBtn.addEventListener('click', () => {
    triggerHaptic('light');
    currentGameType = 'wheel';
    document.getElementById('lobbyTitle').textContent = 'VIP Roulette Royale';
    switchView('lobby');
});

// Game Rules Content - Rich Visual Instructions
const gameRules = {
    '21': `
<div class="rules-guide">
    <div class="rules-hero-card">
        <div class="rules-hero-icon">🃏</div>
        <div class="rules-hero-text">
            <h4>OBJECTIVE</h4>
            <p>Score between <strong>16 and 21</strong> without busting over. Last player standing wins!</p>
        </div>
    </div>

    <div class="rules-chips-row">
        <div class="rule-chip safe">
            <span class="chip-badge">SAFE ZONE</span>
            <strong>16 – 21 Points</strong>
            <small>Survive to next round</small>
        </div>
        <div class="rule-chip danger">
            <span class="chip-badge">BUST</span>
            <strong>22+ Points</strong>
            <small>Deathmatch playoff</small>
        </div>
    </div>

    <div class="rules-section-title">HOW IT WORKS</div>
    <div class="rules-steps-list">
        <div class="rule-step-item">
            <div class="step-num">01</div>
            <div class="step-desc">
                <strong>Your Turn:</strong> Hit to draw another card, or Stand to lock your points.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">02</div>
            <div class="step-desc">
                <strong>Reach Safe Zone:</strong> Aim for 16–21. Once you hit 16+, you can safely pass.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">03</div>
            <div class="step-desc">
                <strong>Avoid Busting:</strong> Exceeding 21 eliminates you or sends you to Deathmatch!
            </div>
        </div>
    </div>

    <div class="rules-section-title">CARD VALUES</div>
    <div class="card-values-grid">
        <div class="val-card"><span>2 – 10</span><small>Face Value</small></div>
        <div class="val-card"><span>J, Q, K</span><small>10 Points</small></div>
        <div class="val-card gold-border"><span>ACE</span><small>11 Pts (2 cards)<br>1 Pt (3+ cards)</small></div>
    </div>

    <div class="rules-tip-box">
        <span class="tip-icon">💡</span>
        <div class="tip-content">
            <strong>Pro Strategy:</strong> If you reach 16 or 17, pass immediately! Drawing another card has high bust risk.
        </div>
    </div>
</div>`,

    'avalon': `
<div class="rules-guide">
    <div class="rules-hero-card purple">
        <div class="rules-hero-icon">👑</div>
        <div class="rules-hero-text">
            <h4>OBJECTIVE</h4>
            <p><strong>Good</strong> must pass 3 Quests. <strong>Evil</strong> sabotages 3 Quests or kills Merlin!</p>
        </div>
    </div>

    <div class="rules-chips-row">
        <div class="rule-chip good">
            <span class="chip-badge">GOOD FORCES</span>
            <strong>Loyal to Arthur</strong>
            <small>Pass 3 Quests</small>
        </div>
        <div class="rule-chip evil">
            <span class="chip-badge">EVIL MINIONS</span>
            <strong>Mordred's Court</strong>
            <small>Fail 3 Quests or Kill Merlin</small>
        </div>
    </div>

    <div class="rules-section-title">ROUND PHASES</div>
    <div class="rules-steps-list">
        <div class="rule-step-item">
            <div class="step-num">01</div>
            <div class="step-desc">
                <strong>Propose Team:</strong> The current Quest Leader selects knights for the mission.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">02</div>
            <div class="step-desc">
                <strong>Public Vote:</strong> All players vote Approve or Reject. Majority wins.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">03</div>
            <div class="step-desc">
                <strong>Secret Quest:</strong> Team members secretly submit Success or Fail. Even one Fail sabotages the quest!
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">04</div>
            <div class="step-desc">
                <strong>Assassination:</strong> If Good passes 3 Quests, Evil Assassin gets one shot to identify and execute Merlin.
            </div>
        </div>
    </div>

    <div class="rules-section-title">KEY CHARACTERS</div>
    <div class="roles-guide-grid">
        <div class="role-guide-card good">
            <span class="role-badge">GOOD</span>
            <strong>🧙 Merlin</strong>
            Knows who all Evil agents are, but must guide without getting assassinated.
        </div>
        <div class="role-guide-card good">
            <span class="role-badge">GOOD</span>
            <strong>🛡️ Percival</strong>
            Knows who Merlin is. Must act as decoy to protect Merlin from death.
        </div>
        <div class="role-guide-card evil">
            <span class="role-badge">EVIL</span>
            <strong>🗡️ Assassin</strong>
            Executes Merlin at the climax if Good achieves 3 Quest wins.
        </div>
        <div class="role-guide-card evil">
            <span class="role-badge">EVIL</span>
            <strong>🎭 Morgana</strong>
            Disguises as Merlin to confuse Percival into voting with Evil.
        </div>
    </div>

    <div class="rules-tip-box">
        <span class="tip-icon">💡</span>
        <div class="tip-content">
            <strong>Pro Strategy:</strong> If you are Merlin, act like a regular loyal knight. If Evil notices you know too much, they will assassinate you!
        </div>
    </div>
</div>`,

    'wheel': `
<div class="rules-guide">
    <div class="rules-hero-card gold">
        <div class="rules-hero-icon">🎰</div>
        <div class="rules-hero-text">
            <h4>OBJECTIVE</h4>
            <p>Predict where the golden ball will land! Bet your VIP chips on Colors (Red/Black), Even/Odd, Number ranges, or pick a direct lucky number for up to 36x payouts.</p>
        </div>
    </div>

    <div class="rules-section-title">BET TYPES & PAYOUT ODDS</div>
    <div class="card-values-grid">
        <div class="val-card red">
            <span class="val-title">🔴 RED / ⚫ BLACK</span>
            <span class="val-points">2x Payout</span>
            <span class="val-note">18 Red pockets, 18 Black pockets. 1:1 return on your chips.</span>
        </div>
        <div class="val-card blue">
            <span class="val-title">EVEN / ODD</span>
            <span class="val-points">2x Payout</span>
            <span class="val-note">Even (2,4...36) or Odd (1,3...35). Zero loses.</span>
        </div>
        <div class="val-card gold">
            <span class="val-title">1-18 (LOW) / 19-36 (HIGH)</span>
            <span class="val-points">2x Payout</span>
            <span class="val-note">Bet on the lower half or upper half of the table.</span>
        </div>
        <div class="val-card green">
            <span class="val-title">🎯 LUCKY NUMBER (0-36)</span>
            <span class="val-points">36x Payout!</span>
            <span class="val-note">Massive straight-up win! Bet 100 chips to win 3,600 chips! Includes Green 0.</span>
        </div>
    </div>

    <div class="rules-section-title">GAME PHASES</div>
    <div class="rules-steps-list">
        <div class="rule-step-item">
            <div class="step-num">01</div>
            <div class="step-desc">
                <strong>Place Bets:</strong> Select your chip denomination (25, 50, 100, 250, 500) and tap the table to place multiple bets.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">02</div>
            <div class="step-desc">
                <strong>The Wheel Spins:</strong> The Host spins the golden European roulette wheel, synchronizing on all players' screens.
            </div>
        </div>
        <div class="rule-step-item">
            <div class="step-num">03</div>
            <div class="step-desc">
                <strong>Instant Payouts:</strong> The winning number, color, and parity are revealed. Winners take the pot and climb the live high-roller leaderboard!
            </div>
        </div>
    </div>

    <div class="rules-tip-box">
        <span class="tip-icon">💡</span>
        <div class="tip-content">
            <strong>VIP Re-buy:</strong> If your bankroll drops to 0, use the instant +500 Re-buy VIP Credit so you never run out of action!
        </div>
    </div>
</div>`
};

document.querySelectorAll('.details-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerHaptic('light');
        const game = btn.getAttribute('data-game');
        showAlert('How to Play', gameRules[game]);
    });
});

// ---- Lobby Logic ----
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

async function cleanupOldHostRooms() {
    try {
        const snap = await get(ref(db, 'rooms'));
        const allRooms = snap.val();
        if (!allRooms) return;
        for (const rCode of Object.keys(allRooms)) {
            if (allRooms[rCode].host === currentPlayer.id) {
                await remove(ref(db, `rooms/${rCode}`));
            }
        }
    } catch (e) {}
}

createGameBtn.addEventListener('click', async () => {
    if (createGameBtn.disabled) return;
    createGameBtn.disabled = true;
    triggerHaptic('medium');

    try {
        if (currentPlayer.roomCode) {
            await leaveRoom();
        }

        await cleanupOldHostRooms();

        const roomCode = generateRoomCode();
        currentPlayer.isHost = true;
        currentPlayer.roomCode = roomCode;

        const playerInfo = {
            name: currentPlayer.name || 'Unknown',
            isHost: true,
            photoUrl: currentPlayer.photoUrl || ''
        };

        await set(ref(db, `rooms/${roomCode}`), {
            host: currentPlayer.id,
            status: 'waiting',
            gameType: currentGameType,
            createdAt: Date.now(),
            players: {
                [currentPlayer.id]: playerInfo
            }
        });

        await joinRoom(roomCode, true);
    } catch (e) {
        console.error("Create room error:", e);
        showAlert('Error', 'Failed to create room: ' + (e.message || e));
        currentPlayer.isHost = false;
        currentPlayer.roomCode = null;
    } finally {
        createGameBtn.disabled = false;
    }
});

// Listen for active rooms globally
onValue(ref(db, 'rooms'), (snapshot) => {
    if (!publicRoomsList) return;

    publicRoomsList.innerHTML = '';
    const rooms = snapshot.val();
    let hasActiveRooms = false;

    if (rooms) {
        Object.keys(rooms).forEach(roomCode => {
            const room = rooms[roomCode];
            const pCount = room.players ? Object.keys(room.players).length : 0;

            if (pCount === 0) {
                remove(ref(db, `rooms/${roomCode}`));
                return;
            }

            let isJoinable = false;
            const rGameType = room.gameType || '21';

            if (room.status === 'waiting') {
                isJoinable = true;
            } else if (room.status === 'playing' && rGameType === 'avalon') {
                if (room.avalonState && room.avalonState.phase === 'setup') {
                    isJoinable = true;
                }
            }

            if (isJoinable && rGameType === currentGameType) {
                hasActiveRooms = true;

                const roomItem = document.createElement('div');
                roomItem.className = 'table-row-item';
                roomItem.innerHTML = `
                    <div class="table-row-left">
                        <div class="table-icon-chip">🎲</div>
                        <div class="table-info-meta">
                            <h4>Table #${roomCode}</h4>
                            <span>${rGameType === 'avalon' ? 'Avalon Camelot' : (rGameType === 'wheel' ? 'VIP Roulette Royale' : '21 Card Survival')}</span>
                        </div>
                    </div>
                    <div class="table-row-right">
                        <span class="player-count-chip">👥 ${pCount}</span>
                        <button class="btn primary sm">Join →</button>
                    </div>
                `;

                roomItem.addEventListener('click', async () => {
                    if (currentPlayer.roomCode) {
                        showAlert('Already in a room', 'Leave your current table before joining another.');
                        return;
                    }
                    triggerHaptic('medium');
                    currentPlayer.isHost = false;
                    currentPlayer.roomCode = roomCode;
                    joinRoom(roomCode);
                });

                publicRoomsList.appendChild(roomItem);
            }
        });
    }

    if (!hasActiveRooms) {
        publicRoomsList.innerHTML = '<p class="text-center mt-10 text-muted">No active tables found. Host one above!</p>';
    }
});

async function joinRoom(roomCode, skipCheck = false) {
    if (!skipCheck) {
        const roomRef = ref(db, `rooms/${roomCode}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
            showAlert('Error', 'Room #' + roomCode + ' not found or has been closed.');
            currentPlayer.roomCode = null;
            currentPlayer.isHost = false;
            return;
        }

        const roomData = snapshot.val();
        currentGameType = roomData.gameType || '21';
    }

    const playersRef = ref(db, `rooms/${roomCode}/players/${currentPlayer.id}`);
    await set(playersRef, {
        name: currentPlayer.name,
        isHost: currentPlayer.isHost,
        photoUrl: currentPlayer.photoUrl
    });

    onDisconnect(playersRef).remove();

    lobbyActions.classList.add('hidden');
    activeLobby.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    gameRoomCode.textContent = roomCode;
    
    const wheelRoomCode = document.getElementById('wheelRoomCode');
    if (wheelRoomCode) wheelRoomCode.textContent = roomCode;
    const avalonRoomCode = document.getElementById('avalonRoomCode');
    if (avalonRoomCode) avalonRoomCode.textContent = roomCode;
    if (myPlayerName) myPlayerName.textContent = currentPlayer.name;

    if (currentPlayer.isHost) {
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }

    if (activeLobbyRef) activeLobbyRef();
    activeLobbyRef = onValue(ref(db, `rooms/${roomCode}/players`), (snapshot) => {
        const players = snapshot.val();
        connectedPlayersList.innerHTML = '';
        let count = 0;
        
        if (players) {
            Object.values(players).forEach(p => {
                if (!p || typeof p !== 'object' || !p.name) return;
                const li = document.createElement('li');
                li.className = 'player-slot-chip' + (p.isHost ? ' is-host' : '');

                const avatar = document.createElement('div');
                avatar.className = 'player-slot-avatar';
                if (p.photoUrl) {
                    avatar.style.backgroundImage = `url('${p.photoUrl}')`;
                } else {
                    avatar.textContent = p.name.substring(0, 2).toUpperCase();
                }

                const nameSpan = document.createElement('span');
                nameSpan.className = 'player-slot-name';
                nameSpan.textContent = p.name;

                li.appendChild(avatar);
                li.appendChild(nameSpan);

                if (p.isHost) {
                    const crown = document.createElement('span');
                    crown.className = 'host-crown-badge';
                    crown.textContent = '👑';
                    li.appendChild(crown);
                }

                connectedPlayersList.appendChild(li);
                count++;
            });
        }
        playerCount.textContent = count;
    });

    if (activeStatusRef) activeStatusRef();
    activeStatusRef = onValue(ref(db, `rooms/${roomCode}/status`), (snapshot) => {
        const status = snapshot.val();
        if (status === 'playing') {
            triggerHaptic('success');
            if (currentGameType === 'wheel') {
                switchView('wheelGame');
                joinWheelListener(roomCode, currentPlayer.id, currentPlayer.isHost);
            } else if (currentGameType === 'avalon') {
                switchView('avalonGame');
                joinAvalonListener(roomCode, currentPlayer.id, currentPlayer.isHost);
            } else {
                switchView('game');
                joinGameListener(roomCode, currentPlayer.id, currentPlayer.isHost);
            }
        } else if (status === 'waiting') {
            if (document.getElementById('game')?.classList.contains('active')) {
                leaveGame();
                switchView('lobby');
                document.getElementById('massiveAlert')?.classList.add('hidden');
            }
            if (document.getElementById('wheelGame')?.classList.contains('active')) {
                leaveWheelGame();
                switchView('lobby');
            }
            if (document.getElementById('avalonGame')?.classList.contains('active')) {
                leaveAvalon();
                switchView('lobby');
            }
        }
    });
}

startGameBtn.addEventListener('click', async () => {
    if (!currentPlayer.isHost || !currentPlayer.roomCode) return;
    if (startGameLock) return;
    startGameLock = true;
    startGameBtn.disabled = true;
    triggerHaptic('medium');

    try {
        if (currentGameType === 'wheel') {
            await initWheelGame(currentPlayer.roomCode);
        } else if (currentGameType === 'avalon') {
            await initAvalon(currentPlayer.roomCode);
        } else {
            await initGame(currentPlayer.roomCode);
        }
        await set(ref(db, `rooms/${currentPlayer.roomCode}/status`), 'playing');
    } catch (e) {
        showAlert('Error', 'Failed to start game: ' + (e.message || e));
        startGameBtn.disabled = false;
    } finally {
        startGameLock = false;
        setTimeout(() => { startGameBtn.disabled = false; }, 2000);
    }
});

leaveGameBtn.addEventListener('click', () => {
    triggerHaptic('light');
    leaveRoom();
    switchView('lobby');
});

const leaveWheelBtn = document.getElementById('leaveWheelBtn');
if (leaveWheelBtn) {
    leaveWheelBtn.addEventListener('click', () => {
        triggerHaptic('light');
        leaveRoom();
        switchView('lobby');
    });
}

const leaveAvalonBtn = document.getElementById('leaveAvalonBtn');
if (leaveAvalonBtn) {
    leaveAvalonBtn.addEventListener('click', () => {
        triggerHaptic('light');
        leaveRoom();
        switchView('lobby');
    });
}

async function leaveRoom() {
    if (!currentPlayer.roomCode) return;

    const roomCode = currentPlayer.roomCode;
    const playerId = currentPlayer.id;

    try {
        onDisconnect(ref(db, `rooms/${roomCode}/players/${playerId}`)).cancel();
        await remove(ref(db, `rooms/${roomCode}/players/${playerId}`));

        if (currentPlayer.isHost) {
            await remove(ref(db, `rooms/${roomCode}`));
        } else {
            const snap = await get(ref(db, `rooms/${roomCode}/players`));
            if (!snap.exists()) {
                await remove(ref(db, `rooms/${roomCode}`));
            }
        }
    } catch (e) {
        console.warn('leaveRoom error:', e);
    }

    if (activeLobbyRef) { activeLobbyRef(); activeLobbyRef = null; }
    if (activeStatusRef) { activeStatusRef(); activeStatusRef = null; }

    leaveGame();
    leaveWheelGame();
    leaveAvalon();

    currentPlayer.roomCode = null;
    currentPlayer.isHost = false;

    lobbyActions.classList.remove('hidden');
    activeLobby.classList.add('hidden');
    document.getElementById('hostControls')?.classList.add('hidden');
    document.getElementById('myTotal') && (document.getElementById('myTotal').textContent = '0');
    document.getElementById('safeIndicator')?.classList.add('hidden');
    document.getElementById('myTableArea')?.classList.remove('hidden');
    document.getElementById('myStatusArea')?.classList.remove('hidden');
    document.getElementById('spyViewingArea')?.classList.add('hidden');
    document.getElementById('deathmatchTableArea')?.classList.add('hidden');
    if (document.getElementById('viewPlayerSelect')) document.getElementById('viewPlayerSelect').value = '';
    document.getElementById('backToMyTableBtn')?.classList.add('hidden');
}
