import { db } from './firebase-config.js?v=29';
import { ref, set, onValue, update, remove, get, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { initGame, joinGameListener, leaveGame } from './21card.js?v=29';
import { initWheelGame, joinWheelListener, leaveWheelGame } from './wheel.js?v=29';
import { initAvalon, joinAvalonListener, leaveAvalon } from './avalon.js?v=29';

// ---- DOM Elements ----
const views = document.querySelectorAll('.view');
const navHomeBtn = document.getElementById('navHome');
const navAboutBtn = document.getElementById('navAbout');
const bottomNav = document.getElementById('bottomNav');
const customModal = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

// Registration
const playerNameInput = document.getElementById('playerNameInput');
const registerBtn = document.getElementById('registerBtn');

// Home / Lobby
const cardGamesBtn = document.getElementById('cardGamesBtn');
const avalonBtn = document.getElementById('avalonBtn');
const spinWheelBtn = document.getElementById('spinWheelBtn');
const createGameBtn = document.getElementById('createGameBtn');
const publicRoomsList = document.getElementById('publicRoomsList');
const backToHomeBtn = document.getElementById('backToHomeBtn');

// Active Lobby
const activeLobby = document.getElementById('activeLobby');
const displayRoomCode = document.getElementById('displayRoomCode');
const connectedPlayersList = document.getElementById('connectedPlayers');
const playerCount = document.getElementById('playerCount');
const startGameBtn = document.getElementById('startGameBtn');
const lobbyActions = document.querySelector('.lobby-actions');

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
    roomCode: null
};

export let activeLobbyRef = null;
export let activeStatusRef = null;
let startGameLock = false; // prevent double-click on Start Game

// ---- View Routing ----
function switchView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    if (viewId === 'home' || viewId === 'lobby' || viewId === 'about') {
        bottomNav.classList.remove('hidden');
    } else {
        bottomNav.classList.add('hidden');
    }

    if (viewId === 'home' || viewId === 'lobby') {
        navHomeBtn.classList.add('active');
        navAboutBtn.classList.remove('active');
    } else if (viewId === 'about') {
        navAboutBtn.classList.add('active');
        navHomeBtn.classList.remove('active');
    }
}

// ---- Modals ----
export function showAlert(title, message) {
    modalTitle.textContent = title;
    modalBody.textContent = message;
    customModal.classList.remove('hidden');
}

modalClose.addEventListener('click', () => {
    customModal.classList.add('hidden');
});

// ---- Initialization & Splash ----
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
}

switchView('splash-1');
setTimeout(() => {
    switchView('splash-2');
    setTimeout(() => {
        checkRegistration();
    }, 4000);
}, 3000);

function checkRegistration() {
    const tg = window.Telegram?.WebApp;
    const tgUser = tg?.initDataUnsafe?.user;

    if (tgUser && tgUser.first_name) {
        currentPlayer.name = tgUser.first_name;
        currentPlayer.id = tgUser.id.toString();
        localStorage.setItem('playerName', currentPlayer.name);
        localStorage.setItem('playerId', currentPlayer.id);
        switchView('home');
    } else {
        const savedName = localStorage.getItem('playerName');
        const savedId = localStorage.getItem('playerId');
        
        if (savedName && savedId) {
            currentPlayer.name = savedName;
            currentPlayer.id = savedId;
            switchView('home');
        } else {
            switchView('registration');
        }
    }
}

// ---- Registration Handler ----
registerBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name.length < 2) {
        showAlert('Error', 'Name must be at least 2 characters.');
        return;
    }
    const id = 'user_' + Math.random().toString(36).substr(2, 9);
    currentPlayer.name = name;
    currentPlayer.id = id;
    localStorage.setItem('playerName', name);
    localStorage.setItem('playerId', id);
    switchView('home');
});

// ---- Navigation ----
navHomeBtn.addEventListener('click', () => switchView('home'));
navAboutBtn.addEventListener('click', () => switchView('about'));
backToHomeBtn.addEventListener('click', () => {
    if (currentPlayer.roomCode) {
        leaveRoom();
    }
    switchView('home');
});

avalonBtn.addEventListener('click', () => {
    currentGameType = 'avalon';
    document.getElementById('lobbyTitle').textContent = 'Avalon Lobby';
    switchView('lobby');
});

export let currentGameType = '21';

cardGamesBtn.addEventListener('click', () => {
    currentGameType = '21';
    document.getElementById('lobbyTitle').textContent = '21 Lobby';
    switchView('lobby');
});

spinWheelBtn.addEventListener('click', () => {
    currentGameType = 'wheel';
    document.getElementById('lobbyTitle').textContent = 'Spin The Wheel Lobby';
    switchView('lobby');
});

// ---- Lobby Logic ----

// Generate a unique 4-digit room code not already in use
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Delete all existing rooms hosted by this player (awaited sequentially)
async function cleanupOldHostRooms() {
    const snap = await get(ref(db, 'rooms'));
    const allRooms = snap.val();
    if (!allRooms) return;
    for (const rCode of Object.keys(allRooms)) {
        if (allRooms[rCode].host === currentPlayer.id) {
            await remove(ref(db, `rooms/${rCode}`));
        }
    }
}

createGameBtn.addEventListener('click', async () => {
    // Guard against double-click
    if (createGameBtn.disabled) return;
    createGameBtn.disabled = true;

    try {
        // If already in a room, leave it first
        if (currentPlayer.roomCode) {
            await leaveRoom();
        }

        // Delete any orphaned host rooms
        await cleanupOldHostRooms();

        // Get a unique room code
        const roomCode = generateRoomCode();
        currentPlayer.isHost = true;
        currentPlayer.roomCode = roomCode;

        // Create room in Firebase
        await set(ref(db, `rooms/${roomCode}`), {
            host: currentPlayer.id,
            status: 'waiting',
            gameType: currentGameType,
            createdAt: Date.now(),
            players: {
                [currentPlayer.id]: {
                    name: currentPlayer.name,
                    isHost: true
                }
            }
        });

        joinRoom(roomCode, true);
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

            // Auto-delete genuinely empty rooms
            if (pCount === 0) {
                remove(ref(db, `rooms/${roomCode}`));
                return;
            }

            // Determine joinability
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

                const roomBtn = document.createElement('button');
                roomBtn.className = 'btn secondary full-width mb-10';
                roomBtn.style.textAlign = 'left';
                roomBtn.style.display = 'flex';
                roomBtn.style.justifyContent = 'space-between';
                roomBtn.innerHTML = `<span>Table: <strong>${roomCode}</strong></span> <span>👥 ${pCount}</span>`;

                roomBtn.addEventListener('click', async () => {
                    // Don't join if already in a room
                    if (currentPlayer.roomCode) {
                        showAlert('Already in a room', 'Leave your current room before joining another.');
                        return;
                    }
                    currentPlayer.isHost = false;
                    currentPlayer.roomCode = roomCode;
                    joinRoom(roomCode);
                });

                publicRoomsList.appendChild(roomBtn);
            }
        });
    }

    if (!hasActiveRooms) {
        publicRoomsList.innerHTML = '<p class="text-center mt-10" style="color: #666;">No active tables found.</p>';
    }
});

async function joinRoom(roomCode, skipCheck = false) {
    if (!skipCheck) {
        const roomRef = ref(db, `rooms/${roomCode}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
            showAlert('Error', 'Room not found or has been closed.');
            currentPlayer.roomCode = null;
            currentPlayer.isHost = false;
            return;
        }

        const roomData = snapshot.val();
        currentGameType = roomData.gameType || '21';
    }

    // Add player to room
    const playersRef = ref(db, `rooms/${roomCode}/players/${currentPlayer.id}`);
    await set(playersRef, {
        name: currentPlayer.name,
        isHost: currentPlayer.isHost
    });

    // Auto-remove on disconnect
    onDisconnect(playersRef).remove();

    // UI Updates
    lobbyActions.classList.add('hidden');
    activeLobby.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    gameRoomCode.textContent = roomCode;
    const wheelRoomCode = document.getElementById('wheelRoomCode');
    if (wheelRoomCode) wheelRoomCode.textContent = roomCode;
    const avalonRoomCode = document.getElementById('avalonRoomCode');
    if (avalonRoomCode) avalonRoomCode.textContent = roomCode;
    myPlayerName.textContent = currentPlayer.name;

    if (currentPlayer.isHost) {
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }

    // Listen for player list changes
    if (activeLobbyRef) activeLobbyRef();
    activeLobbyRef = onValue(ref(db, `rooms/${roomCode}/players`), (snapshot) => {
        const players = snapshot.val();
        connectedPlayersList.innerHTML = '';
        let count = 0;
        if (players) {
            Object.values(players).forEach(p => {
                const li = document.createElement('li');
                li.textContent = p.name + (p.isHost ? ' 👑 (Host)' : '');
                connectedPlayersList.appendChild(li);
                count++;
            });
        }
        playerCount.textContent = count;
    });

    // Listen for game status changes
    if (activeStatusRef) activeStatusRef();
    activeStatusRef = onValue(ref(db, `rooms/${roomCode}/status`), (snapshot) => {
        const status = snapshot.val();
        if (status === 'playing') {
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
            // Return to lobby if game just ended
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
        showAlert('Error', 'Failed to start game. Please try again.');
        startGameBtn.disabled = false;
    } finally {
        startGameLock = false;
        // Re-enable after a delay to prevent rapid re-clicks
        setTimeout(() => { startGameBtn.disabled = false; }, 2000);
    }
});

leaveGameBtn.addEventListener('click', () => {
    leaveRoom();
    switchView('lobby');
});

const leaveWheelBtn = document.getElementById('leaveWheelBtn');
if (leaveWheelBtn) {
    leaveWheelBtn.addEventListener('click', () => {
        leaveRoom();
        switchView('lobby');
    });
}

const leaveAvalonBtn = document.getElementById('leaveAvalonBtn');
if (leaveAvalonBtn) {
    leaveAvalonBtn.addEventListener('click', () => {
        leaveRoom();
        switchView('lobby');
    });
}

async function leaveRoom() {
    if (!currentPlayer.roomCode) return;

    const roomCode = currentPlayer.roomCode;
    const playerId = currentPlayer.id;

    try {
        // Cancel disconnect listener
        onDisconnect(ref(db, `rooms/${roomCode}/players/${playerId}`)).cancel();

        // Remove player from DB
        await remove(ref(db, `rooms/${roomCode}/players/${playerId}`));

        // If host leaves, delete the entire room so it doesn't stay orphaned
        if (currentPlayer.isHost) {
            await remove(ref(db, `rooms/${roomCode}`));
        } else {
            // If room becomes empty (e.g. last non-host leaves), clean up
            const snap = await get(ref(db, `rooms/${roomCode}/players`));
            if (!snap.exists()) {
                await remove(ref(db, `rooms/${roomCode}`));
            }
        }
    } catch (e) {
        console.warn('leaveRoom error:', e);
    }

    // Unsubscribe from listeners
    if (activeLobbyRef) { activeLobbyRef(); activeLobbyRef = null; }
    if (activeStatusRef) { activeStatusRef(); activeStatusRef = null; }

    leaveGame();
    leaveWheelGame();
    leaveAvalon();

    currentPlayer.roomCode = null;
    currentPlayer.isHost = false;

    // Reset UI
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
