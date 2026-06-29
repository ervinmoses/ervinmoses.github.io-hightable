import { db } from './firebase-config.js?v=21';
import { ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let currentRoom = null;
let myId = null;
let isHost = false;
let wheelListener = null;

export async function initWheelGame(roomCode) {
    const playersSnapshot = await get(ref(db, `rooms/${roomCode}/players`));
    const players = playersSnapshot.val();
    
    // Initialize wheel state if host
    if (isHost) {
        await set(ref(db, `rooms/${roomCode}/wheelState`), {
            isSpinning: false,
            winner: null,
            spinTime: Date.now()
        });
    }
}

export function joinWheelListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;

    const wheelHostControls = document.getElementById('wheelHostControls');
    const wheelWinnerDisplay = document.getElementById('wheelWinnerDisplay');
    const wheelPlayerGrid = document.getElementById('wheelPlayerGrid');

    if (isHost) {
        wheelHostControls.classList.remove('hidden');
    } else {
        wheelHostControls.classList.add('hidden');
    }
    
    wheelWinnerDisplay.classList.add('hidden');

    // Listen to players to build the grid
    onValue(ref(db, `rooms/${currentRoom}/players`), (snapshot) => {
        const players = snapshot.val();
        if (!players) return;
        
        wheelPlayerGrid.innerHTML = '';
        Object.keys(players).forEach(id => {
            const p = players[id];
            const div = document.createElement('div');
            div.className = 'wheel-player-box glass';
            div.id = `wheel-player-${id}`;
            div.textContent = p.name;
            wheelPlayerGrid.appendChild(div);
        });
    });

    // Listen to wheel state
    if (wheelListener) wheelListener();
    wheelListener = onValue(ref(db, `rooms/${currentRoom}/wheelState`), (snapshot) => {
        const state = snapshot.val();
        if (!state) return;
        
        if (state.isSpinning) {
            startSpinAnimation(state.winner);
        }
    });
}

export function leaveWheelGame() {
    if (wheelListener) {
        wheelListener();
        wheelListener = null;
    }
    currentRoom = null;
    myId = null;
    isHost = false;
}

let animationInterval = null;

function startSpinAnimation(winnerId) {
    const spinBtn = document.getElementById('spinBtn');
    const wheelWinnerDisplay = document.getElementById('wheelWinnerDisplay');
    const wheelWinnerText = document.getElementById('wheelWinnerText');
    
    if (spinBtn) spinBtn.disabled = true;
    wheelWinnerDisplay.classList.add('hidden');
    
    const boxes = document.querySelectorAll('.wheel-player-box');
    if (boxes.length === 0) return;
    
    let timeElapsed = 0;
    const spinDuration = 3000;
    const intervalTime = 100;
    
    if (animationInterval) clearInterval(animationInterval);
    
    animationInterval = setInterval(() => {
        boxes.forEach(b => b.classList.remove('active-spin'));
        const randomIndex = Math.floor(Math.random() * boxes.length);
        boxes[randomIndex].classList.add('active-spin');
        
        timeElapsed += intervalTime;
        if (timeElapsed >= spinDuration) {
            clearInterval(animationInterval);
            finishSpin(winnerId);
        }
    }, intervalTime);
}

function finishSpin(winnerId) {
    const boxes = document.querySelectorAll('.wheel-player-box');
    boxes.forEach(b => b.classList.remove('active-spin'));
    
    const winnerBox = document.getElementById(`wheel-player-${winnerId}`);
    if (winnerBox) {
        winnerBox.classList.add('active-spin');
        const winnerName = winnerBox.textContent;
        const wheelWinnerText = document.getElementById('wheelWinnerText');
        wheelWinnerText.textContent = `${winnerName} IS THE CHOSEN ONE!`;
        document.getElementById('wheelWinnerDisplay').classList.remove('hidden');
    }
    
    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) spinBtn.disabled = false;
}

// Global listeners for buttons
document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'spinBtn') {
        if (!isHost || !currentRoom) return;
        
        const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
        const players = playersSnapshot.val();
        if (!players) return;
        
        const playerIds = Object.keys(players);
        const winnerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        
        await update(ref(db, `rooms/${currentRoom}/wheelState`), {
            isSpinning: true,
            winner: winnerId,
            spinTime: Date.now()
        });
    }
    
    if (e.target && e.target.id === 'restartWheelBtn') {
        if (!isHost || !currentRoom) return;
        
        await update(ref(db, `rooms/${currentRoom}`), {
            status: 'waiting',
            wheelState: null
        });
    }
});
