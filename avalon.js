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

 e x p o r t   a s y n c   f u n c t i o n   c h e c k B o t A c t i o n s ( s t a t e ,   p l a y e r s )   { 
         i f   ( ! s t a t e   | |   s t a t e . p h a s e   = = =   ' g a m e _ o v e r ' )   r e t u r n ; 
         
         / /   W e   r u n   b o t s   o n l y   o n   H o s t   t o   a v o i d   d u p l i c a t e   w r i t e s 
         i f   ( ! i s H o s t )   r e t u r n ; 
 
         c o n s t   b o t I d s   =   O b j e c t . k e y s ( p l a y e r s ) . f i l t e r ( i d   = >   p l a y e r s [ i d ] . i s B o t ) ; 
         i f   ( b o t I d s . l e n g t h   = = =   0 )   r e t u r n ; 
 
         / /   H e l p e r   t o   s i m u l a t e   d e l a y 
         c o n s t   w a i t   =   ( m s )   = >   n e w   P r o m i s e ( r   = >   s e t T i m e o u t ( r ,   m s ) ) ; 
 
         s w i t c h   ( s t a t e . p h a s e )   { 
                 c a s e   ' t e a m _ b u i l d i n g ' : 
                         i f   ( p l a y e r s [ s t a t e . r o u n d L e a d e r ]   & &   p l a y e r s [ s t a t e . r o u n d L e a d e r ] . i s B o t )   { 
                                 i f   ( s t a t e . p r o p o s e d T e a m   & &   s t a t e . p r o p o s e d T e a m . l e n g t h   >   0 )   r e t u r n ;   / /   a l r e a d y   p r o p o s e d 
                                 
                                 c o n s t   p l a y i n g C o u n t   =   O b j e c t . k e y s ( p l a y e r s ) . f i l t e r ( i d   = >   ! p l a y e r s [ i d ] . i s H o s t   | |   p l a y e r s [ i d ] . i s B o t   | |   t r u e ) . l e n g t h ;   
                                 / /   w a i t   w e   r e d e f i n e d   p l a y e r s   t o   a l l   p l a y . 
                                 c o n s t   r e q   =   Q U E S T _ R E Q U I R E M E N T S [ p l a y i n g C o u n t ] [ s t a t e . s c o r e s . c u r r e n t Q u e s t ] ; 
                                 
                                 / /   B o t   s e l e c t s   r a n d o m   t e a m 
                                 l e t   a l l P l a y i n g I d s   =   O b j e c t . k e y s ( p l a y e r s ) ; 
                                 l e t   s h u f f l e d   =   a l l P l a y i n g I d s . s o r t ( ( )   = >   0 . 5   -   M a t h . r a n d o m ( ) ) ; 
                                 l e t   b o t T e a m   =   s h u f f l e d . s l i c e ( 0 ,   r e q ) ; 
                                 
                                 / /   w a i t   2   s e c o n d s   t h e n   p r o p o s e 
                                 s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                         / /   C h e c k   i f   p h a s e   i s   s t i l l   t e a m _ b u i l d i n g 
                                         c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                         i f   ( s . v a l ( ) . p h a s e   = = =   ' t e a m _ b u i l d i n g '   & &   s . v a l ( ) . r o u n d L e a d e r   = = =   s t a t e . r o u n d L e a d e r )   { 
                                                 a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ,   { 
                                                         p h a s e :   ' p u b l i c _ v o t i n g ' , 
                                                         p r o p o s e d T e a m :   b o t T e a m , 
                                                         p u b l i c V o t e s :   { }   
                                                 } ) ; 
                                         } 
                                 } ,   2 0 0 0 ) ; 
                         } 
                         b r e a k ; 
                         
                 c a s e   ' p u b l i c _ v o t i n g ' : 
                         b o t I d s . f o r E a c h ( b o t I d   = >   { 
                                 i f   ( ! s t a t e . p u b l i c V o t e s   | |   ! s t a t e . p u b l i c V o t e s [ b o t I d ] )   { 
                                         s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                                 c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                                 i f   ( s . v a l ( ) . p h a s e   = = =   ' p u b l i c _ v o t i n g '   & &   ! s . v a l ( ) . p u b l i c V o t e s ? . [ b o t I d ] )   { 
                                                         c o n s t   v o t e   =   M a t h . r a n d o m ( )   >   0 . 3   ?   ' a p p r o v e '   :   ' r e j e c t ' ; 
                                                         a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e / p u b l i c V o t e s \ ) ,   { 
                                                                 [ b o t I d ] :   v o t e 
                                                         } ) ; 
                                                 } 
                                         } ,   1 5 0 0   +   M a t h . r a n d o m ( )   *   2 0 0 0 ) ; 
                                 } 
                         } ) ; 
                         b r e a k ; 
                         
                 c a s e   ' q u e s t _ v o t i n g ' : 
                         c o n s t   p r o p o s e d T e a m   =   s t a t e . p r o p o s e d T e a m   | |   [ ] ; 
                         b o t I d s . f o r E a c h ( b o t I d   = >   { 
                                 i f   ( p r o p o s e d T e a m . i n c l u d e s ( b o t I d ) )   { 
                                         i f   ( ! s t a t e . q u e s t V o t e s   | |   ! s t a t e . q u e s t V o t e s [ b o t I d ] )   { 
                                                 s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                                         c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                                         i f   ( s . v a l ( ) . p h a s e   = = =   ' q u e s t _ v o t i n g '   & &   ! s . v a l ( ) . q u e s t V o t e s ? . [ b o t I d ] )   { 
                                                                 c o n s t   r o l e   =   s t a t e . r o l e s [ b o t I d ] ; 
                                                                 l e t   v o t e   =   ' s u c c e s s ' ; 
                                                                 / /   E v i l s   m i g h t   f a i l .   A s s u m e d   8 0 %   f a i l   r a t e   f o r   b o t s   i f   e v i l . 
                                                                 i f   ( [ ' a s s a s s i n ' ,   ' m o r g a n a ' ,   ' m o r d r e d ' ,   ' o b e r o n ' ,   ' m i n i o n s ' ] . i n c l u d e s ( r o l e ) )   { 
                                                                         v o t e   =   M a t h . r a n d o m ( )   >   0 . 2   ?   ' f a i l '   :   ' s u c c e s s ' ; 
                                                                 } 
                                                                 a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e / q u e s t V o t e s \ ) ,   { 
                                                                         [ b o t I d ] :   v o t e 
                                                                 } ) ; 
                                                         } 
                                                 } ,   1 5 0 0   +   M a t h . r a n d o m ( )   *   2 0 0 0 ) ; 
                                         } 
                                 } 
                         } ) ; 
                         b r e a k ; 
                         
                 c a s e   ' l o t l _ p h a s e ' : 
                         i f   ( s t a t e . l o t l H o l d e r   & &   p l a y e r s [ s t a t e . l o t l H o l d e r ]   & &   p l a y e r s [ s t a t e . l o t l H o l d e r ] . i s B o t )   { 
                                 i f   ( s t a t e . l o t l I n s p e c t e d )   { 
                                         / /   f i n i s h   l o t l 
                                         s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                                 c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                                 i f   ( s . v a l ( ) . p h a s e   = = =   ' l o t l _ p h a s e ' )   { 
                                                         a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ,   { 
                                                                 p h a s e :   ' t e a m _ b u i l d i n g ' , 
                                                                 l o t l H o l d e r :   s . v a l ( ) . l o t l I n s p e c t e d , 
                                                                 l o t l I n s p e c t e d :   n u l l 
                                                         } ) ; 
                                                 } 
                                         } ,   2 0 0 0 ) ; 
                                 }   e l s e   { 
                                         / /   i n s p e c t   s o m e o n e 
                                         s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                                 c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                                 i f   ( s . v a l ( ) . p h a s e   = = =   ' l o t l _ p h a s e '   & &   ! s . v a l ( ) . l o t l I n s p e c t e d )   { 
                                                         l e t   a v a i l a b l e   =   O b j e c t . k e y s ( p l a y e r s ) . f i l t e r ( i d   = >   i d   ! = =   s t a t e . l o t l H o l d e r ) ; 
                                                         l e t   t a r g e t   =   a v a i l a b l e [ M a t h . f l o o r ( M a t h . r a n d o m ( )   *   a v a i l a b l e . l e n g t h ) ] ; 
                                                         a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ,   { 
                                                                 l o t l I n s p e c t e d :   t a r g e t 
                                                         } ) ; 
                                                 } 
                                         } ,   2 0 0 0 ) ; 
                                 } 
                         } 
                         b r e a k ; 
                         
                 c a s e   ' a s s a s s i n a t i o n ' : 
                         / /   I f   b o t   i s   a s s a s s i n ,   a s s a s s i n a t e   r a n d o m l y   f r o m   g o o d   t e a m 
                         c o n s t   a s s a s s i n I d   =   O b j e c t . k e y s ( s t a t e . r o l e s ) . f i n d ( i d   = >   s t a t e . r o l e s [ i d ]   = = =   ' a s s a s s i n ' ) ; 
                         i f   ( a s s a s s i n I d   & &   p l a y e r s [ a s s a s s i n I d ]   & &   p l a y e r s [ a s s a s s i n I d ] . i s B o t )   { 
                                 / /   T o   a v o i d   m u l t i p l e   t r i g g e r s ,   w e   u s e   a   s i m p l e   t i m e o u t   w i t h o u t   c h e c k i n g   s t a t e   f l a g   ( s i n c e   i t   t r a n s i t i o n s   a w a y ) 
                                 / /   b u t   w e   s h o u l d   j u s t   e n s u r e   w e   d o n ' t   f i r e   1 0   t i m e s .   
                                 / /   W e ' l l   r e l y   o n   t h e   p h a s e   t r a n s i t i o n   t o   s t o p   i t . 
                                 s e t T i m e o u t ( a s y n c   ( )   = >   { 
                                         c o n s t   s   =   a w a i t   g e t ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ) ; 
                                         i f   ( s . v a l ( ) . p h a s e   = = =   ' a s s a s s i n a t i o n ' )   { 
                                                 l e t   a v a i l a b l e   =   O b j e c t . k e y s ( p l a y e r s ) . f i l t e r ( i d   = >   i d   ! = =   a s s a s s i n I d   & &   ! [ ' a s s a s s i n ' ,   ' m o r g a n a ' ,   ' m o r d r e d ' ,   ' o b e r o n ' ,   ' m i n i o n s ' ] . i n c l u d e s ( s . v a l ( ) . r o l e s [ i d ] ) ) ; 
                                                 l e t   t a r g e t   =   a v a i l a b l e [ M a t h . f l o o r ( M a t h . r a n d o m ( )   *   a v a i l a b l e . l e n g t h ) ] ; 
                                                 i f   ( s . v a l ( ) . r o l e s [ t a r g e t ]   = = =   ' m e r l i n ' )   { 
                                                         a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ,   { 
                                                                 p h a s e :   ' g a m e _ o v e r ' , 
                                                                 w i n n e r :   ' e v i l ' , 
                                                                 r e a s o n :   ' A s s a s s i n   s u c c e s s f u l l y   k i l l e d   M e r l i n ! ' 
                                                         } ) ; 
                                                 }   e l s e   { 
                                                         a w a i t   u p d a t e ( r e f ( d b ,   \  o o m s / \ / a v a l o n S t a t e \ ) ,   { 
                                                                 p h a s e :   ' g a m e _ o v e r ' , 
                                                                 w i n n e r :   ' g o o d ' , 
                                                                 r e a s o n :   \ A s s a s s i n   m i s s e d !   T h e y   k i l l e d   \ . \ 
                                                         } ) ; 
                                                 } 
                                         } 
                                 } ,   4 0 0 0 ) ; 
                         } 
                         b r e a k ; 
         } 
 } 
  
 