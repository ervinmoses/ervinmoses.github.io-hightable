import { db } from './firebase-config.js';
import { ref, set, onValue, push, update, remove, get, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { initGame, joinGameListener, leaveGame } from './game.js';
import { initWheelGame, joinWheelListener, leaveWheelGame } from './wheel.js';

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

// ---- View Routing ----
function switchView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    // Handle bottom nav visibility
    if (viewId === 'home' || viewId === 'lobby' || viewId === 'about') {
        bottomNav.classList.remove('hidden');
    } else {
        bottomNav.classList.add('hidden');
    }

    // Handle Nav active states
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
// Check Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand(); // Expand to full height
}

// Splash Sequence
switchView('splash-1');
setTimeout(() => {
    switchView('splash-2');
    setTimeout(() => {
        checkRegistration();
    }, 3000); // Show splash 2 for 3s
}, 2000); // Show splash 1 for 2s

function checkRegistration() {
    // 1. Try local storage
    const savedName = localStorage.getItem('playerName');
    const savedId = localStorage.getItem('playerId');
    
    // 2. Try Telegram
    const tg = window.Telegram?.WebApp;
    const tgUser = tg?.initDataUnsafe?.user;

    if (savedName && savedId) {
        currentPlayer.name = savedName;
        currentPlayer.id = savedId;
        switchView('home');
    } else if (tgUser && tgUser.first_name) {
        currentPlayer.name = tgUser.first_name;
        currentPlayer.id = tgUser.id.toString();
        localStorage.setItem('playerName', currentPlayer.name);
        localStorage.setItem('playerId', currentPlayer.id);
        switchView('home');
    } else {
        switchView('registration');
    }
}

// ---- Registration Handler ----
registerBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name.length < 2) {
        showAlert('Error', 'Name must be at least 2 characters.');
        return;
    }
    
    // Generate simple ID if not on Telegram
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
        // Need to leave room first
        leaveRoom();
    }
    switchView('home');
});

// Coming Soon Alerts
avalonBtn.addEventListener('click', () => showAlert('Coming Soon', 'Avalon is currently in development!'));

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
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 4 digits
}

createGameBtn.addEventListener('click', async () => {
    createGameBtn.disabled = true;
    setTimeout(() => createGameBtn.disabled = false, 2000);

    const roomCode = generateRoomCode();
    currentPlayer.isHost = true;
    currentPlayer.roomCode = roomCode;

    // Create room in Firebase
    const roomRef = ref(db, `rooms/${roomCode}`);
    await set(roomRef, {
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

    joinRoom(roomCode);
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
            const playerCount = room.players ? Object.keys(room.players).length : 0;
            
            // Auto-delete empty rooms
            if (playerCount === 0) {
                remove(ref(db, `rooms/${roomCode}`));
                return;
            }

            // Only show rooms in 'waiting' state so players can join
            const rGameType = room.gameType || '21';
            if (room.status === 'waiting' && rGameType === currentGameType) {
                hasActiveRooms = true;
                
                const roomBtn = document.createElement('button');
                roomBtn.className = 'btn secondary full-width mb-10';
                roomBtn.style.textAlign = 'left';
                roomBtn.style.display = 'flex';
                roomBtn.style.justifyContent = 'space-between';
                roomBtn.innerHTML = `<span>Table: <strong>${roomCode}</strong></span> <span>👥 ${playerCount}</span>`;
                
                roomBtn.addEventListener('click', () => {
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

async function joinRoom(roomCode) {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
        showAlert('Error', 'Room not found.');
        return;
    }

    // Add player to room
    const playersRef = ref(db, `rooms/${roomCode}/players/${currentPlayer.id}`);
    await set(playersRef, {
        name: currentPlayer.name,
        isHost: currentPlayer.isHost
    });
    
    // Automatically remove player if they disconnect
    onDisconnect(playersRef).remove();

    // UI Updates
    lobbyActions.classList.add('hidden');
    activeLobby.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    gameRoomCode.textContent = roomCode;
    myPlayerName.textContent = currentPlayer.name;

    if (currentPlayer.isHost) {
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }

    // Listen for player changes
    if (activeLobbyRef) activeLobbyRef(); // Unsub existing if any
    activeLobbyRef = onValue(ref(db, `rooms/${roomCode}/players`), (snapshot) => {
        const players = snapshot.val();
        connectedPlayersList.innerHTML = '';
        let count = 0;
        
        if (players) {
            Object.values(players).forEach(p => {
                const li = document.createElement('li');
                li.textContent = p.name + (p.isHost ? ' (Host)' : '');
                connectedPlayersList.appendChild(li);
                count++;
            });
        }
        playerCount.textContent = count;
    });

    // Listen for game status changes
    if (activeStatusRef) activeStatusRef(); // Unsub existing if any
    activeStatusRef = onValue(ref(db, `rooms/${roomCode}/status`), (snapshot) => {
        const status = snapshot.val();
        if (status === 'playing') {
            if (currentGameType === 'wheel') {
                switchView('wheelGame');
                joinWheelListener(roomCode, currentPlayer.id, currentPlayer.isHost);
            } else {
                switchView('game');
                joinGameListener(roomCode, currentPlayer.id, currentPlayer.isHost);
            }
        } else if (status === 'waiting') {
            // Return to lobby if a game just ended
            if (document.getElementById('game').classList.contains('active')) {
                leaveGame();
                switchView('lobby');
                document.getElementById('massiveAlert').classList.add('hidden');
            }
            if (document.getElementById('wheelGame').classList.contains('active')) {
                leaveWheelGame();
                switchView('lobby');
            }
        }
    });
}

startGameBtn.addEventListener('click', async () => {
    if (!currentPlayer.isHost || !currentPlayer.roomCode) return;
    
    // Initialize game state in Firebase
    if (currentGameType === 'wheel') {
        await initWheelGame(currentPlayer.roomCode);
    } else {
        await initGame(currentPlayer.roomCode);
    }
    
    // Set status to playing
    await set(ref(db, `rooms/${currentPlayer.roomCode}/status`), 'playing');
});

leaveGameBtn.addEventListener('click', () => {
    leaveRoom();
    switchView('lobby');
});

async function leaveRoom() {
    if (currentPlayer.roomCode) {
        // Cancel disconnect listener so it doesn't trigger unexpectedly
        onDisconnect(ref(db, `rooms/${currentPlayer.roomCode}/players/${currentPlayer.id}`)).cancel();
        
        // Remove player from DB
        await remove(ref(db, `rooms/${currentPlayer.roomCode}/players/${currentPlayer.id}`));
        
        // Check if room is empty and auto-delete
        const playersSnapshot = await get(ref(db, `rooms/${currentPlayer.roomCode}/players`));
        if (!playersSnapshot.exists()) {
            await remove(ref(db, `rooms/${currentPlayer.roomCode}`));
        }
        
        // Unsubscribe from room listeners
        if (activeLobbyRef) { activeLobbyRef(); activeLobbyRef = null; }
        if (activeStatusRef) { activeStatusRef(); activeStatusRef = null; }
        
        leaveGame(); // Clean up game listeners
        leaveWheelGame(); // Clean up wheel listeners
        
        currentPlayer.roomCode = null;
        currentPlayer.isHost = false;
        
        // Reset UI
        lobbyActions.classList.remove('hidden');
        activeLobby.classList.add('hidden');
        document.getElementById('hostControls').classList.add('hidden');
        if (document.getElementById('myTotal')) document.getElementById('myTotal').textContent = '0';
        if (document.getElementById('safeIndicator')) document.getElementById('safeIndicator').classList.add('hidden');
        if (document.getElementById('myTableArea')) document.getElementById('myTableArea').classList.remove('hidden');
        if (document.getElementById('myStatusArea')) document.getElementById('myStatusArea').classList.remove('hidden');
        if (document.getElementById('spyViewingArea')) document.getElementById('spyViewingArea').classList.add('hidden');
        if (document.getElementById('deathmatchTableArea')) document.getElementById('deathmatchTableArea').classList.add('hidden');
        if (document.getElementById('viewPlayerSelect')) document.getElementById('viewPlayerSelect').value = '';
        if (document.getElementById('backToMyTableBtn')) document.getElementById('backToMyTableBtn').classList.add('hidden');
    }
}
