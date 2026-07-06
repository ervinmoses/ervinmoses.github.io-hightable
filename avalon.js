import { db } from './firebase-config.js?v=29';
import { ref, set, onValue, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { showAlert } from './app.js?v=29';

let currentRoom = null;
let myId = null;
let isHost = false;
let avalonListeners = [];
let playersData = {};

// Game Constants
export const QUEST_REQUIREMENTS = {
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

    const restartBtn = document.getElementById('restartAvalonBtn');
    if (restartBtn) {
        if (isHost) restartBtn.classList.remove('hidden');
        else restartBtn.classList.add('hidden');
    }

    const stateRef = ref(db, `rooms/${roomCode}/avalonState`);
    const listener = onValue(stateRef, async (snapshot) => {
        const state = snapshot.val();
        if (!state) return;

        const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
        playersData = playersSnap.val() || {};
        
        if (state.bots) {
            playersData = { ...playersData, ...state.bots };
        }

        renderAvalonUI(state, playersData);
        
        if (isHost) {
            checkBotActions(state, playersData);
        }
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
    const players = playersSnapshot.val() || {};
    
    let playingIds = Object.keys(players);
    let count = playingIds.length;
    
    let botsToCreate = {};
    if (count < 5) {
        const needed = 5 - count;
        for (let i = 0; i < needed; i++) {
            const botId = `bot_${Date.now()}_${i}`;
            botsToCreate[botId] = {
                name: `Bot ${i + 1}`,
                isHost: false,
                isBot: true
            };
            playingIds.push(botId);
        }
        count = 5;
    } else if (count > 14) {
        showAlert('Error', 'Avalon requires up to 14 players.');
        return;
    }

    const { good, evil } = DISTRIBUTION[count];
    
    let goodRoles = ['merlin', 'percival'];
    while (goodRoles.length < good) goodRoles.push('servants');
    
    let evilRoles = ['assassin', 'morgana'];
    if (count >= 7 && count !== 8 && count !== 9) evilRoles.push('oberon'); 
    if (count >= 9) evilRoles.push('mordred'); 
    while (evilRoles.length < evil) evilRoles.push('minions');
    
    if (goodRoles.length > good) goodRoles.length = good;
    if (evilRoles.length > evil) evilRoles.length = evil;
    
    let allRoles = [...goodRoles, ...evilRoles];
    for (let i = allRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRoles[i], allRoles[j]] = [allRoles[j], allRoles[i]];
    }
    
    let assignedRoles = {};
    playingIds.forEach((id, index) => {
        assignedRoles[id] = allRoles[index];
    });

    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'player_adjustment',
        roles: assignedRoles,
        scores: { good: 0, evil: 0, currentQuest: 0 },
        questResults: [],
        turnOrder: playingIds,
        lotlEnabled: false,
        lotlHolder: null,
        failsTracker: 0,
        bots: Object.keys(botsToCreate).length > 0 ? botsToCreate : null,
        playerReadyStatus: {}
    });
}

export async function updatePlayerAdjustment(turnOrder, lotlEnabled) {
    if (!isHost) return;
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        turnOrder,
        lotlEnabled,
        lotlHolder: lotlEnabled ? turnOrder[turnOrder.length - 1] : null
    });
}

export async function setPlayerReady(isReady) {
    await update(ref(db, `rooms/${currentRoom}/avalonState/playerReadyStatus`), {
        [myId]: isReady
    });
}

export async function checkAllReady(state, players) {
    if (!isHost) return;
    if (state.phase !== 'player_adjustment') return;

    const realPlayers = Object.keys(players).filter(id => !players[id].isBot);
    const allReady = realPlayers.every(id => state.playerReadyStatus && state.playerReadyStatus[id]);

    if (allReady) {
        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
            phase: 'countdown',
            countdownEndTime: Date.now() + 3000
        });

        // After countdown, transition to reveal_roles
        setTimeout(async () => {
            const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
            if (s.val().phase === 'countdown') {
                await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                    phase: 'reveal_roles'
                });
            }
        }, 3200);
    }
}

export async function confirmSetupOrder() {
    // Deprecated, use checkAllReady
}

export async function beginNightPhase() {
    if (!isHost) return;
    const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
    const turnOrder = s.val().turnOrder;
    const randomLeaderId = turnOrder[Math.floor(Math.random() * turnOrder.length)];

    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'night_phase',
        nightEndTime: Date.now() + 5000
    });
    
    setTimeout(async () => {
        const s2 = await get(ref(db, `rooms/${currentRoom}/avalonState`));
        if (s2.val().phase === 'night_phase') {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'team_building',
                roundLeader: randomLeaderId,
                proposedTeam: [],
                votes: {},
                failsTracker: 0
            });
        }
    }, 5500);
}

export async function proposeLeader(leaderId) {
    // Deprecated via manual assign; logic now handled automatically
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
                const turnOrder = state.turnOrder || [];
                let currentIndex = turnOrder.indexOf(state.roundLeader);
                let nextLeader = turnOrder[(currentIndex + 1) % turnOrder.length];
                
                await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                    phase: 'team_building',
                    failsTracker: fails,
                    roundLeader: nextLeader,
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
    if (Object.keys(state.questVotes || {}).length < req) return; // not all voted yet

    let failsCount = 0;
    Object.values(state.questVotes || {}).forEach(v => {
        if (v === 'fail') failsCount++;
    });
    
    const playingCount = Object.keys(playersData).filter(id => !playersData[id].isHost).length;
    let requiredFails = 1;
    // Quest 4 and 5 (index 3 and 4) require 2 fails if players >= 7
    if ((state.scores.currentQuest === 3 || state.scores.currentQuest === 4) && playingCount >= 7) {
        requiredFails = 2;
    }
    
    const questFailed = failsCount >= requiredFails;
    let newScores = { ...state.scores };
    if (questFailed) newScores.evil += 1;
    else newScores.good += 1;
    
    let newQuestResults = [...(state.questResults || [])];
    newQuestResults.push({ failed: questFailed, failsCount });
    
    // Show result screen first — host will press Continue to advance
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'quest_result',
        scores: newScores,
        questResults: newQuestResults,
        questResultData: {
            successCount: req - failsCount,
            failsCount,
            questFailed,
            requiredFails
        }
    });
}

export async function continueQuestResult(state) {
    if (!isHost) return;
    if (state.phase !== 'quest_result') return;

    const { questFailed } = state.questResultData || {};
    const newScores = state.scores;
    const newQuestResults = state.questResults;

    if (newScores.evil >= 3) {
        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
            phase: 'game_over',
            winner: 'evil',
            reason: '3 Quests Failed — Evil wins!'
        });
    } else if (newScores.good >= 3) {
        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
            phase: 'assassination',
        });
    } else {
        const nextQuest = newScores.currentQuest + 1;
        const turnOrder = state.turnOrder || [];
        let currentIndex = turnOrder.indexOf(state.roundLeader);
        let nextLeader = turnOrder[(currentIndex + 1) % turnOrder.length];

        if (state.lotlEnabled && [1, 2, 3].includes(newScores.currentQuest)) {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'lotl_phase',
                scores: { ...newScores, currentQuest: nextQuest },
                roundLeader: nextLeader,
                proposedTeam: [],
                publicVotes: {},
                questVotes: {},
                questResultData: null,
                failsTracker: 0,
                lotlInspected: null
            });
        } else {
            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                phase: 'team_building',
                scores: { ...newScores, currentQuest: nextQuest },
                roundLeader: nextLeader,
                proposedTeam: [],
                publicVotes: {},
                questVotes: {},
                questResultData: null,
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

export async function inspectLotl(targetId) {
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        lotlInspected: targetId
    });
}

export async function finishLotl(state) {
    await update(ref(db, `rooms/${currentRoom}/avalonState`), {
        phase: 'team_building',
        lotlHolder: state.lotlInspected,
        lotlInspected: null
    });
}

// UI Rendering Hook (implemented in app.js or a separate UI controller file if needed)
function renderAvalonUI(state, players) {
    if (typeof window.updateAvalonUI === 'function') {
        window.updateAvalonUI(state, players, myId, isHost, currentRoom);
    }
}

export async function checkBotActions(state, players) {
    if (!state || state.phase === 'game_over') return;
    
    // We run bots only on Host to avoid duplicate writes
    if (!isHost) return;

    const botIds = Object.keys(players).filter(id => players[id].isBot);
    if (botIds.length === 0) return;

    // Helper to simulate delay
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    switch (state.phase) {
        case 'team_building':
            if (players[state.roundLeader] && players[state.roundLeader].isBot) {
                if (state.proposedTeam && state.proposedTeam.length > 0) return; // already proposed
                
                const playingCount = Object.keys(players).filter(id => !players[id].isHost || players[id].isBot || true).length;  
                const req = QUEST_REQUIREMENTS[playingCount][state.scores.currentQuest];
                
                // Bot selects random team
                let allPlayingIds = Object.keys(players);
                let shuffled = allPlayingIds.sort(() => 0.5 - Math.random());
                let botTeam = shuffled.slice(0, req);
                
                // wait 2 seconds then propose
                setTimeout(async () => {
                    // Check if phase is still team_building
                    const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                    if (s.val().phase === 'team_building' && s.val().roundLeader === state.roundLeader) {
                        await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                            phase: 'public_voting',
                            proposedTeam: botTeam,
                            publicVotes: {}  
                        });
                    }
                }, 2000);
            }
            break;
            
        case 'public_voting':
            botIds.forEach(botId => {
                if (!state.publicVotes || !state.publicVotes[botId]) {
                    setTimeout(async () => {
                        const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                        if (s.val().phase === 'public_voting' && !s.val().publicVotes?.[botId]) {
                            const vote = Math.random() > 0.3 ? 'approve' : 'reject';
                            await update(ref(db, `rooms/${currentRoom}/avalonState/publicVotes`), {
                                [botId]: vote
                            });
                        }
                    }, 1500 + Math.random() * 2000);
                }
            });
            break;
            
        case 'quest_voting':
            const proposedTeam = state.proposedTeam || [];
            botIds.forEach(botId => {
                if (proposedTeam.includes(botId)) {
                    if (!state.questVotes || !state.questVotes[botId]) {
                        setTimeout(async () => {
                            const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                            if (s.val().phase === 'quest_voting' && !s.val().questVotes?.[botId]) {
                                const role = state.roles[botId];
                                let vote = 'success';
                                // Evils might fail. Assumed 80% fail rate for bots if evil.
                                if (['assassin', 'morgana', 'mordred', 'oberon', 'minions'].includes(role)) {
                                    vote = Math.random() > 0.2 ? 'fail' : 'success';
                                }
                                await update(ref(db, `rooms/${currentRoom}/avalonState/questVotes`), {
                                    [botId]: vote
                                });
                            }
                        }, 1500 + Math.random() * 2000);
                    }
                }
            });
            break;
            
        case 'lotl_phase':
            if (state.lotlHolder && players[state.lotlHolder] && players[state.lotlHolder].isBot) {
                if (state.lotlInspected) {
                    // finish lotl
                    setTimeout(async () => {
                        const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                        if (s.val().phase === 'lotl_phase') {
                            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                                phase: 'team_building',
                                lotlHolder: s.val().lotlInspected,
                                lotlInspected: null
                            });
                        }
                    }, 2000);
                } else {
                    // inspect someone
                    setTimeout(async () => {
                        const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                        if (s.val().phase === 'lotl_phase' && !s.val().lotlInspected) {
                            let available = Object.keys(players).filter(id => id !== state.lotlHolder);
                            let target = available[Math.floor(Math.random() * available.length)];
                            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                                lotlInspected: target
                            });
                        }
                    }, 2000);
                }
            }
            break;
            
        case 'assassination':
            // If bot is assassin, assassinate randomly from good team
            const assassinId = Object.keys(state.roles).find(id => state.roles[id] === 'assassin');
            if (assassinId && players[assassinId] && players[assassinId].isBot) {
                setTimeout(async () => {
                    const s = await get(ref(db, `rooms/${currentRoom}/avalonState`));
                    if (s.val().phase === 'assassination') {
                        let available = Object.keys(players).filter(id => id !== assassinId && !['assassin', 'morgana', 'mordred', 'oberon', 'minions'].includes(s.val().roles[id]));
                        let target = available[Math.floor(Math.random() * available.length)];
                        if (s.val().roles[target] === 'merlin') {
                            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                                phase: 'game_over',
                                winner: 'evil',
                                reason: 'Assassin successfully killed Merlin!'
                            });
                        } else {
                            await update(ref(db, `rooms/${currentRoom}/avalonState`), {
                                phase: 'game_over',
                                winner: 'good',
                                reason: `Assassin missed! They killed ${s.val().roles[target]}.`
                            });
                        }
                    }
                }, 4000);
            }
            break;
    }
}
