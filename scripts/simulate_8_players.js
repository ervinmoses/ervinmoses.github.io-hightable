// ========================================================
// AVALON 8-PLAYER SIMULATOR
// Connects 8 simulated Arthurian knights/minions into a HighTable room
// ========================================================

const DB_URL = "https://hightable-a2a2e-default-rtdb.asia-southeast1.firebasedatabase.app";

const roomCode = process.argv[2];
if (!roomCode) {
    console.error("Usage: node simulate_8_players.js <ROOM_CODE>");
    process.exit(1);
}

const PLAYERS = [
    { id: 'sim_arthur', name: 'Arthur Pendragon' },
    { id: 'sim_lancelot', name: 'Sir Lancelot' },
    { id: 'sim_gawain', name: 'Sir Gawain' },
    { id: 'sim_galahad', name: 'Sir Galahad' },
    { id: 'sim_tristan', name: 'Sir Tristan' },
    { id: 'sim_guinevere', name: 'Lady Guinevere' },
    { id: 'sim_morgana', name: 'Morgana le Fay' },
    { id: 'sim_mordred', name: 'Mordred Shadow' }
];

const QUEST_REQUIREMENTS_8 = [3, 4, 4, 5, 5];

async function api(path, method = 'GET', body = null) {
    const url = `${DB_URL}/${path}.json`;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return await res.json();
}

async function joinAllPlayers() {
    console.log(`\n👑 Joining 8 Arthurian players into Room #${roomCode}...`);
    for (const p of PLAYERS) {
        await api(`rooms/${roomCode}/players/${p.id}`, 'PUT', {
            name: p.name,
            isHost: false,
            photoUrl: ''
        });
        console.log(`  ✓ ${p.name} joined table`);
    }
    console.log(`✨ All 8 players successfully seated at the High Table!\n`);
}

let lastHandledPhase = null;
let lastPublicVoteKey = null;
let lastQuestVoteKey = null;
let lastTeamProposedKey = null;

async function runGameLoop() {
    console.log(`📡 Listening for Avalon state updates in Room #${roomCode}...`);

    const interval = setInterval(async () => {
        try {
            const room = await api(`rooms/${roomCode}`);
            if (!room) {
                console.log("Room closed or not found.");
                clearInterval(interval);
                return;
            }

            if (room.status === 'waiting') {
                process.stdout.write(".");
                return;
            }

            const state = room.avalonState;
            if (!state) return;

            // Phase tracking
            if (state.phase !== lastHandledPhase) {
                console.log(`\n⚔️ [PHASE CHANGED]: ${state.phase.toUpperCase()}`);
                lastHandledPhase = state.phase;
            }

            // 1. REVEAL ROLES
            if (state.phase === 'reveal_roles' && state.roles) {
                if (!state._loggedRoles) {
                    state._loggedRoles = true;
                    console.log("\n📜 ROLES ASSIGNED FOR 8 PLAYERS:");
                    PLAYERS.forEach(p => {
                        const r = state.roles[p.id];
                        const allegiance = ['merlin', 'percival', 'servants'].includes(r) ? '🔵 GOOD' : '🔴 EVIL';
                        console.log(`   ${p.name.padEnd(20)} -> ${r.toUpperCase().padEnd(12)} (${allegiance})`);
                    });
                    console.log("\n⏳ Waiting for Host to begin Night Phase...");
                }
            }

            // 2. NIGHT PHASE
            if (state.phase === 'night_phase') {
                // Host automatically drives transition after 5s
            }

            // 3. TEAM BUILDING
            if (state.phase === 'team_building') {
                const questIdx = state.scores?.currentQuest || 0;
                const reqSize = QUEST_REQUIREMENTS_8[questIdx] || 3;
                const currentLeader = state.roundLeader;
                const teamKey = `team_${questIdx}_${state.failsTracker || 0}`;

                if (currentLeader && teamKey !== lastTeamProposedKey) {
                    lastTeamProposedKey = teamKey;
                    console.log(`\n👑 Quest #${questIdx + 1}: Team size needed = ${reqSize} knights.`);
                    const leaderName = PLAYERS.find(p => p.id === currentLeader)?.name || currentLeader;
                    console.log(`   Leader is: ${leaderName}`);

                    // Propose team
                    const shuffled = [...PLAYERS].sort(() => 0.5 - Math.random());
                    const selectedTeam = shuffled.slice(0, reqSize).map(p => p.id);
                    const selectedNames = selectedTeam.map(id => PLAYERS.find(p => p.id === id)?.name).join(", ");
                    console.log(`   ${leaderName} proposes quest team: [ ${selectedNames} ]`);

                    setTimeout(async () => {
                        await api(`rooms/${roomCode}/avalonState`, 'PATCH', {
                            phase: 'public_voting',
                            proposedTeam: selectedTeam,
                            publicVotes: {}
                        });
                        console.log(`   🗳️ Team submitted! Public Voting begun.`);
                    }, 1500);
                }
            }

            // 4. PUBLIC VOTING
            if (state.phase === 'public_voting') {
                const voteKey = `vote_${state.scores?.currentQuest}_${state.failsTracker || 0}`;
                if (voteKey !== lastPublicVoteKey) {
                    lastPublicVoteKey = voteKey;
                    console.log(`\n🗳️ ALL 8 PLAYERS VOTING ON PROPOSED TEAM...`);

                    // Each bot casts vote with realistic delays
                    PLAYERS.forEach((p, idx) => {
                        setTimeout(async () => {
                            // 75% chance to approve, 25% to reject
                            const vote = Math.random() > 0.25 ? 'approve' : 'reject';
                            await api(`rooms/${roomCode}/avalonState/publicVotes`, 'PATCH', {
                                [p.id]: vote
                            });
                            console.log(`   ${p.name.padEnd(20)} voted: ${vote.toUpperCase() === 'APPROVE' ? '✅ APPROVE' : '❌ REJECT'}`);
                        }, 500 + (idx * 300));
                    });
                }
            }

            // 5. QUEST VOTING
            if (state.phase === 'quest_voting') {
                const questVoteKey = `questvote_${state.scores?.currentQuest}`;
                if (questVoteKey !== lastQuestVoteKey) {
                    lastQuestVoteKey = questVoteKey;
                    const team = state.proposedTeam || [];
                    console.log(`\n⚔️ QUEST TEAM ON MISSION (${team.length} members):`);

                    team.forEach((pId, idx) => {
                        setTimeout(async () => {
                            const pName = PLAYERS.find(p => p.id === pId)?.name || pId;
                            const role = state.roles?.[pId];
                            const isEvil = ['assassin', 'morgana', 'minions'].includes(role);

                            // Good must vote success; Evil chooses
                            const vote = (!isEvil || Math.random() < 0.25) ? 'success' : 'fail';
                            await api(`rooms/${roomCode}/avalonState/questVotes`, 'PATCH', {
                                [pId]: vote
                            });
                            console.log(`   ${pName.padEnd(20)} secretly submitted quest card!`);
                        }, 600 + (idx * 400));
                    });
                }
            }

            // 6. ASSASSINATION
            if (state.phase === 'assassination') {
                console.log(`\n🗡️ ASSASSIN ATTEMPTING TO ASSASSINATE MERLIN!`);
                const goodPlayers = PLAYERS.filter(p => ['merlin', 'percival', 'servants'].includes(state.roles?.[p.id]));
                const target = goodPlayers[Math.floor(Math.random() * goodPlayers.length)];
                const isMerlin = state.roles?.[target.id] === 'merlin';
                console.log(`   Assassin targeted: ${target.name}!`);

                setTimeout(async () => {
                    await api(`rooms/${roomCode}/avalonState`, 'PATCH', {
                        phase: 'game_over',
                        winner: isMerlin ? 'evil' : 'good',
                        reason: isMerlin ? `Merlin (${target.name}) was assassinated!` : `Merlin survived! (${target.name} was not Merlin)`
                    });
                }, 2000);
            }

            // 7. GAME OVER
            if (state.phase === 'game_over') {
                console.log(`\n==============================================`);
                console.log(`👑 GAME OVER!`);
                console.log(`🏆 WINNER: ${state.winner?.toUpperCase()}`);
                console.log(`📜 REASON: ${state.reason}`);
                console.log(`==============================================\n`);
                clearInterval(interval);
            }

        } catch (err) {
            console.error("Simulation loop error:", err.message);
        }
    }, 800);
}

// Cleanup on exit
process.on('SIGINT', async () => {
    console.log("\nCleaning up simulation players...");
    for (const p of PLAYERS) {
        try {
            await api(`rooms/${roomCode}/players/${p.id}`, 'DELETE');
        } catch (e) {}
    }
    console.log("Done.");
    process.exit(0);
});

// Run
(async () => {
    await joinAllPlayers();
    await runGameLoop();
})();
