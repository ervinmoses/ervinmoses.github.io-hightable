import { db } from './firebase-config.js?v=22';
import { ref, set, onValue, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { showAlert } from './app.js?v=22';

let currentRoom = null;
let myId = null;
let isHost = false;
let avalonListeners = [];
let playersData = {};

// Game Constants
const QUEST_REQUIREMENTS = {
    5:  [2, 3, 2, 3, 3],
    6:  [2, 3, 4, 3, 4],
    7:  [2, 3, 3, 4, 4], // Q4 needs 2 fails
    8:  [3, 4, 4, 5, 5], // Q4 needs 2 fails
    9:  [3, 4, 4, 5, 5], // Q4 needs 2 fails
    10: [3, 4, 4, 5, 5], // Q4 needs 2 fails
    11: [4, 5, 5, 6, 6], // Q4 needs 2 fails
    12: [4, 5, 5, 6, 6], // Q4 needs 2 fails
    13: [5, 6, 6, 7, 7], // Q4 needs 2 fails
    14: [5, 6, 6, 7, 7], // Q4 needs 2 fails
};

const DISTRIBUTION = {
    5:  { good: 3, evil: 2 },
    6:  { good: 4, evil: 2 },
    7:  { good: 4, evil: 3 },
    8:  { good: 5, evil: 3 },
    9:  { good: 6, evil: 3 },
    10: { good: 6, evil: 4 },
    11: { good: 7, evil: 4 },
    12: { good: 8, evil: 4 },
    13: { good: 8, evil: 5 },
    14: { good: 9, evil: 5 }
};

export async function initAvalon(roomCode) {
    // We start in setup phase where host starts the game
    await set(ref(db, `rooms/${roomCode}/avalonState`), {
        phase: 'setup'
    });
}

export function joinAvalonListener(roomCode, playerId, hostStatus) {
    currentRoom = roomCode;
    myId = playerId;
    isHost = hostStatus;

    // Show Avalon UI (will map this inside app.js/index.html UI updates)
    document.getElementById('avalonGame').classList.remove('hidden');

    const stateRef = ref(db, `rooms/${roomCode}/avalonState`);
    const listener = onValue(stateRef, async (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
        playersData = playersSnap.val() || {};

        renderAvalonUI(state, playersData);
    });

    avalonListeners.push({ ref: stateRef, listener });
}

export function leaveAvalon() {
    avalonListeners.forEach(l => {
        if (typeof l.listener === 'function') l.listener();
    });
    avalonListeners = [];
    currentRoom = null;
    isHost = false;
    document.getElementById('avalonGame').classList.add('hidden');
}

// ========================
// State Transitions & Logic
// ========================

export async function startAvalonGame() {
    if (!isHost || !currentRoom) return;
    
    const playersSnapshot = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnapshot.val();
    
    // Only non-hosts play
    const playingIds = Object.keys(players).filter(id => !players[id].isHost);
    const count = playingIds.length;
    
    if (count < 5 || count > 14) {
        showAlert('Error', 'Avalon requires 5 to 14 non-host players.');
        return;
    }

    const { good, evil } = DISTRIBUTION[count];
    
    // Auto-Assign Roles based on count
    let goodRoles = ['merlin', 'percival'];
    while (goodRoles.length < good) goodRoles.push('servants');
    
    let evilRoles = ['assassin', 'morgana'];
    if (count >= 7 && count !== 8 && count !== 9) evilRoles.push('oberon'); // 7, 10, 11+
    if (count >= 9) evilRoles.push('mordred'); // 9, 10, 11+
    while (evilRoles.length < evil) evilRoles.push('minions');
    
    // Validate bounds
    if (goodRoles.length > good) goodRoles.length = good;
    if (evilRoles.length > evil) evilRoles.length = evil;
    
    let allRoles = [...goodRoles, ...evilRoles];
    // Shuffle roles
    for (let i = allRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRoles[i], allRoles[j]] = [allRoles[j], allRoles[i]];
    }
    
    let assignedRoles = {};
    playingIds.forEach((id, index) => {
        assignedRoles[id] = allRoles[index];
    });

    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'reveal_roles',
        roles: assignedRoles,
        scores: { good: 0, evil: 0, currentQuest: 0 },
        questResults: []
    });
}

export async function beginNightPhase() {
    if (!isHost) return;
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'night_phase',
        nightEndTime: Date.now() + 5000 
    });
    
    // Host drives transition after 5.5s
    setTimeout(async () => {
        const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
        if (s.val().phase === 'night_phase') {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'team_building',
                roundLeader: null,
                proposedTeam: [],
                votes: {},
                failsTracker: 0
            });
        }
    }, 5500);
}

export async function proposeLeader(leaderId) {
    if (!isHost) return;
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        roundLeader: leaderId,
        proposedTeam: []
    });
}

export async function submitTeam(teamIds) {
    const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
    const state = s.val();
    
    const playingCount = Object.keys(playersData).filter(id => !playersData[id].isHost).length;
    const req = QUEST_REQUIREMENTS[playingCount][state.scores.currentQuest];
    
    if (teamIds.length !== req) {
        showAlert('Error', `You must select exactly ${req} players.`);
        return;
    }

    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'public_voting',
        proposedTeam: teamIds,
        publicVotes: {} 
    });
}

export async function submitPublicVote(vote) {
    await update(ref(db, `rooms/${currentRoom}/avalonState/publicVotes`), {
        [myId]: vote
    });
}

// We will export a method for the Host to check votes, or we can check via listener in UI
export async function checkPublicVotesComplete(state) {
    if (!isHost) return;
    if (state.phase !== 'public_voting') return;
    
    const playingIds = Object.keys(playersData).filter(id => !playersData[id].isHost);
    if (Object.keys(state.publicVotes || {}).length === playingIds.length) {
        let approveCount = 0;
        let rejectCount = 0;
        Object.values(state.publicVotes).forEach(v => {
            if (v === 'approve') approveCount++;
            else rejectCount++;
        });
        
        if (approveCount > rejectCount) {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'quest_voting',
                questVotes: {},
                failsTracker: 0 
            });
        } else {
            const fails = (state.failsTracker || 0) + 1;
            if (fails >= 5) {
                await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                    phase: 'game_over',
                    winner: 'evil',
                    reason: '5 consecutive rejected teams'
                });
            } else {
                await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                    phase: 'team_building',
                    failsTracker: fails,
                    roundLeader: null,
                    proposedTeam: []
                });
            }
        }
    }
}

export async function submitQuestVote(vote) {
    await update(ref(db, `rooms/${currentRoom}/avalonState/questVotes`), {
        [myId]: vote
    });
}

export async function checkQuestVotesComplete(state) {
    if (!isHost) return;
    if (state.phase !== 'quest_voting') return;
    
    const req = (state.proposedTeam || []).length;
    if (Object.keys(state.questVotes || {}).length === req) {
        let failsCount = 0;
        Object.values(state.questVotes || {}).forEach(v => {
            if (v === 'fail') failsCount++;
        });
        
        const playingCount = Object.keys(playersData).filter(id => !playersData[id].isHost).length;
        let requiredFails = 1;
        if (state.scores.currentQuest === 3 && playingCount >= 7) {
            requiredFails = 2;
        }
        
        let questFailed = failsCount >= requiredFails;
        let newScores = { ...state.scores };
        if (questFailed) newScores.evil += 1;
        else newScores.good += 1;
        
        let newQuestResults = [...(state.questResults || [])];
        newQuestResults.push({
            failed: questFailed,
            failsCount: failsCount
        });
        
        if (newScores.evil >= 3) {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'game_over',
                scores: newScores,
                questResults: newQuestResults,
                winner: 'evil',
                reason: '3 Quests Failed'
            });
        } else if (newScores.good >= 3) {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'assassination',
                scores: newScores,
                questResults: newQuestResults
            });
        } else {
            newScores.currentQuest += 1;
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'team_building',
                scores: newScores,
                questResults: newQuestResults,
                roundLeader: null,
                proposedTeam: [],
                failsTracker: 0
            });
        }
    }
}

export async function assassinate(targetId) {
    const stateSnap = await get(ref(db, `rooms/${currentRoom}/avalonState`));
    const state = stateSnap.val();
    const targetRole = state.roles[targetId];
    
    if (targetRole === 'merlin') {
        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
            phase: 'game_over',
            winner: 'evil',
            reason: 'Assassin successfully killed Merlin!'
        });
    } else {
        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
            phase: 'game_over',
            winner: 'good',
            reason: `Assassin missed! They killed ${targetRole}.`
        });
    }
}

export async function resetAvalonGame() {
    if (!isHost) return;
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'setup'
    });
}

// UI Rendering Hook (implemented in app.js or a separate UI controller file if needed)
function renderAvalonUI(state, players) {
    if (typeof window.updateAvalonUI === 'function') {
        window.updateAvalonUI(state, players, myId, isHost, currentRoom);
    }
}
