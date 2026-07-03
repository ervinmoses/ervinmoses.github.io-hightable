import { db } from './firebase-config.js?v=29';
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
    
    const restartWheelBtn = document.getElementById('restartWheelBtn');
    if (restartWheelBtn) {
        if (isHost) restartWheelBtn.classList.remove('hidden');
        else restartWheelBtn.classList.add('hidden');
    }
    
    wheelWinnerDisplay.classList.add('hidden');

    // Listen to players to build the wheel
    onValue(ref(db, `rooms/${currentRoom}/players`), (snapshot) => {
        const players = snapshot.val();
        if (!players) return;
        
        const wheelCircle = document.getElementById('wheelCircle');
        if (!wheelCircle) return;
        wheelCircle.innerHTML = '';
        
        const playerIds = Object.keys(players);
        const playerCount = playerIds.length;
        
        if (playerCount === 0) return;
        
        const sliceAngle = 360 / playerCount;
        let gradientStops = [];
        
        playerIds.forEach((id, index) => {
            const p = players[id];
            
            // Premium alternating colors (dark charcoal and gold-tinted)
            let color1 = index % 2 === 0 ? '#111' : '#222';
            if (playerCount % 2 !== 0 && index === playerCount - 1) {
                // If odd number of players, make the last slice distinct so first and last don't blend
                color1 = '#300';
            }
            
            const startAngle = index * sliceAngle;
            const endAngle = (index + 1) * sliceAngle;
            gradientStops.push(`${color1} ${startAngle}deg ${endAngle}deg`);
            
            const label = document.createElement('div');
            label.className = 'wheel-label';
            label.textContent = p.name;
            
            // align text radially in the middle of the slice
            const textAngle = startAngle + (sliceAngle / 2) - 90;
            label.style.transform = `rotate(${textAngle}deg)`;
            
            label.dataset.id = id;
            label.dataset.index = index;
            
            wheelCircle.appendChild(label);
        });
        
        wheelCircle.style.background = `conic-gradient(${gradientStops.join(', ')})`;
        wheelCircle.style.transition = 'none';
        wheelCircle.style.transform = 'rotate(0deg)';
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

function startSpinAnimation(winnerId) {
    const spinBtn = document.getElementById('spinBtn');
    const wheelWinnerDisplay = document.getElementById('wheelWinnerDisplay');
    const wheelCircle = document.getElementById('wheelCircle');
    
    if (spinBtn) spinBtn.disabled = true;
    if (wheelWinnerDisplay) wheelWinnerDisplay.classList.add('hidden');
    if (!wheelCircle) return;
    
    const labels = Array.from(wheelCircle.querySelectorAll('.wheel-label'));
    if (labels.length === 0) return;
    
    const winnerLabel = labels.find(l => l.dataset.id === winnerId);
    if (!winnerLabel) return;
    
    const index = parseInt(winnerLabel.dataset.index);
    const playerCount = labels.length;
    const sliceAngle = 360 / playerCount;
    
    // The winning slice's center is at `index * sliceAngle + sliceAngle/2`.
    // We want this center to align with the pointer (top center, 0 degrees).
    // So we rotate clockwise by `360 - that angle`.
    const targetAngle = 360 - (index * sliceAngle + sliceAngle/2);
    
    // Add extra rotations for suspense
    const extraSpins = 5 * 360;
    
    // Add slight randomness within the slice so it doesn't always land dead center
    const randomOffset = (Math.random() - 0.5) * (sliceAngle * 0.8);
    
    const finalRotation = extraSpins + targetAngle + randomOffset;
    
    // First reset transition in case of multiple spins (though host disables spinBtn)
    // Then apply new rotation
    wheelCircle.style.transition = 'transform 6s cubic-bezier(0.175, 0.885, 0.32, 1)';
    wheelCircle.style.transform = `rotate(${finalRotation}deg)`;
    
    setTimeout(() => {
        finishSpin(winnerId, winnerLabel.textContent);
    }, 6000);
}

function finishSpin(winnerId, winnerName) {
    const wheelWinnerText = document.getElementById('wheelWinnerText');
    if (wheelWinnerText) wheelWinnerText.textContent = `${winnerName} IS THE CHOSEN ONE!`;
    const wheelWinnerDisplay = document.getElementById('wheelWinnerDisplay');
    if (wheelWinnerDisplay) wheelWinnerDisplay.classList.remove('hidden');
    
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
