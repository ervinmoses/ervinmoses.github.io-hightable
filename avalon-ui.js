import {
    startAvalonGame,
    beginNightPhase,
    proposeLeader,
    submitTeam,
    submitPublicVote,
    checkPublicVotesComplete,
    submitQuestVote,
    checkQuestVotesComplete,
    assassinate,
    resetAvalonGame,
    QUEST_REQUIREMENTS,
    continueQuestResult
} from './avalon.js?v=29';

const avalonGameArea = document.getElementById('avalonGameArea');
let currentInterval = null;

// Store role & myId across renders so the persistent mini-card works
let _myRole = null;
let _myId = null;

// Helper to get asset paths
const getAsset = (name) => `./assets/avalon/${name}.jpg`;

// ========================
// ROLE NAMES & TEAMS
// ========================
const ROLE_LABEL = {
    merlin:   'Merlin',
    percival: 'Percival',
    servants: 'Servant of Arthur',
    assassin: 'Assassin',
    morgana:  'Morgana',
    mordred:  'Mordred',
    oberon:   'Oberon',
    minions:  'Minion of Mordred'
};

const ROLE_DESC = {
    merlin:   'You know who the Evil agents are. Guide the Good team — but stay hidden or the Assassin will find you.',
    percival: 'You see two players — one is Merlin, the other may be Morgana. Protect the real Merlin.',
    servants: 'You serve the forces of Good. Trust your instincts and support Merlin without knowing who they are.',
    assassin: 'You are Evil. If Good wins 3 Quests, you get one shot to identify and kill Merlin to steal the victory.',
    morgana:  'You are Evil. You appear as Merlin to Percival — sow confusion and mislead the Good team.',
    mordred:  'You are Evil. Merlin cannot see you. Use this invisibility to operate in the shadows.',
    oberon:   'You are Evil — but you do not know your allies and they do not know you. Work alone in the dark.',
    minions:  'You serve the forces of Evil. Sabotage Quests and protect your evil allies from suspicion.'
};

const EVIL_ROLES = ['assassin', 'morgana', 'mordred', 'minions', 'oberon'];
const GOOD_ROLES = ['merlin', 'percival', 'servants'];

// ========================
// MAIN RENDER ENTRY
// ========================
window.updateAvalonUI = (state, players, myId, isHost, currentRoom) => {
    if (currentInterval) clearInterval(currentInterval);

    _myId = myId;
    if (state.roles && state.roles[myId]) {
        _myRole = state.roles[myId];
    }

    let html = '';

    // Persistent role mini-card (only for non-host players with a role, from team_building onwards)
    const showingPhases = ['team_building', 'public_voting', 'quest_voting', 'assassination', 'game_over'];
    if (!isHost && _myRole && showingPhases.includes(state.phase)) {
        html += renderMiniRoleCard(_myRole);
    }

    // Scoreboard (show in all phases except setup & reveal_roles)
    if (!['setup', 'reveal_roles'].includes(state.phase)) {
        html += renderScoreboard(state, players);
    }

    switch (state.phase) {
        case 'setup':
            html += renderSetup(isHost, players);
            break;
        case 'reveal_roles':
            html += renderRevealRoles(state, isHost, myId);
            break;
        case 'night_phase':
            html += renderNightPhase(state, players, myId, isHost);
            break;
        case 'team_building':
            html += renderTeamBuilding(state, players, isHost, myId);
            break;
        case 'public_voting':
            html += renderPublicVoting(state, players, isHost, myId);
            if (isHost) checkPublicVotesComplete(state);
            break;
        case 'quest_voting':
            html += renderQuestVoting(state, players, isHost, myId);
            if (isHost) checkQuestVotesComplete(state);
            break;
        case 'assassination':
            html += renderAssassination(state, players, myId, isHost);
            break;
        case 'quest_result':
            html += renderQuestResult(state, players, isHost);
            break;
        case 'game_over':
            html += renderGameOver(state, isHost, players);
            break;
    }

    avalonGameArea.innerHTML = html;
    attachEventListeners(state, players, myId, isHost);
};

// ========================
// MINI ROLE CARD (persistent)
// ========================
function renderMiniRoleCard(role) {
    const isGood = GOOD_ROLES.includes(role);
    const teamColor = isGood ? '#4fc3f7' : '#ef5350';
    return `
        <div style="display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.4); border-radius:10px; padding:10px; margin-bottom:12px; border:1px solid rgba(255,255,255,0.1); user-select:none;">
            <div id="miniCardBack" style="width:50px; height:70px; background:linear-gradient(135deg,#2a2a4a,#1a1a2e); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:1.8rem; font-weight:bold; color:#888; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.5); flex-shrink:0; border:1px solid rgba(255,255,255,0.15);">?</div>
            <img id="miniCardFront" src="${getAsset(role)}" class="hidden" style="width:50px; height:70px; border-radius:6px; object-fit:cover; box-shadow:0 2px 6px rgba(0,0,0,0.5); flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <p style="margin:0; font-size:0.7rem; color:rgba(255,255,255,0.4);">YOUR ROLE</p>
                <p id="miniRoleLabel" style="margin:0; font-size:0.9rem; font-weight:bold; color:${teamColor}; filter:blur(6px); transition:filter 0.1s;">${ROLE_LABEL[role] || role}</p>
                <p style="margin:0; font-size:0.65rem; color:rgba(255,255,255,0.3);">Hold card to reveal</p>
            </div>
        </div>
    `;
}

// ========================
// SCOREBOARD
// ========================
function renderScoreboard(state, players) {
    const playingCount = players ? Object.keys(players).filter(id => !players[id].isHost).length : 0;
    let qResults = state.questResults || [];
    const currentQuest = state.scores?.currentQuest ?? 0;

    let circles = '';
    for (let i = 0; i < 5; i++) {
        const req = QUEST_REQUIREMENTS[playingCount] ? QUEST_REQUIREMENTS[playingCount][i] : '?';
        const needs2Fails = playingCount >= 7 && (i === 3 || i === 4);
        let bg = 'rgba(255,255,255,0.1)';
        let icon = '';
        if (qResults[i]) {
            bg = qResults[i].failed ? '#c62828' : '#1565c0';
            icon = qResults[i].failed ? '✕' : '✓';
        } else if (i === currentQuest) {
            bg = 'rgba(255,200,0,0.3)';
            icon = '►';
        }
        circles += `
            <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
                <div style="width:36px; height:36px; border-radius:50%; background:${bg}; display:flex; align-items:center; justify-content:center; font-size:0.9rem; color:#fff; border: ${i === currentQuest ? '2px solid gold' : '1px solid rgba(255,255,255,0.2)'};">${icon}</div>
                <span style="font-size:0.6rem; color:rgba(255,255,255,0.5);">${req}${needs2Fails ? '★' : ''}</span>
            </div>`;
    }

    const good = state.scores?.good || 0;
    const evil = state.scores?.evil || 0;

    return `
        <div class="glass mb-12" style="padding:12px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="color:#4fc3f7; font-weight:bold; font-size:0.85rem;">🛡 Good: ${good}</span>
                <span style="font-size:0.7rem; color:rgba(255,255,255,0.4);">★=2 fails needed</span>
                <span style="color:#ef5350; font-weight:bold; font-size:0.85rem;">⚔ Evil: ${evil}</span>
            </div>
            <div style="display:flex; justify-content:space-around;">${circles}</div>
            ${state.failsTracker > 0 ? `<p style="text-align:center; color:#ef5350; font-size:0.75rem; margin-top:8px;">⚠ Rejected Teams: ${state.failsTracker}/5</p>` : ''}
        </div>
    `;
}

// ========================
// PHASE 1: SETUP
// ========================
function renderSetup(isHost, players) {
    const pCount = Object.values(players).filter(p => !p.isHost).length;
    let pList = `<ul style="list-style:none; margin:0; padding:0;">`;
    Object.values(players).forEach(p => {
        if (!p.isHost) pList += `<li style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.08); font-size:0.9rem;">👤 ${p.name}</li>`;
    });
    pList += `</ul>`;

    if (isHost) {
        const ready = pCount >= 5 && pCount <= 14;
        return `
            <div class="glass text-center">
                <h2 style="margin-bottom:6px;">⚔ Avalon Setup</h2>
                <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Roles auto-assigned by player count. Host does not play.</p>
                <div style="margin:16px 0; background:rgba(0,0,0,0.3); border-radius:8px; padding:12px;">
                    <h4 style="color:${ready ? '#4fc3f7' : '#ef5350'}; margin-bottom:10px;">Players: ${pCount} ${ready ? '✓ Ready' : '(Need 5–14)'}</h4>
                    ${pList}
                </div>
                <button id="btnStartAvalon" class="btn primary full-width mt-10" ${ready ? '' : 'disabled'}>Start Game →</button>
            </div>`;
    } else {
        return `
            <div class="glass text-center">
                <h2>⚔ Avalon Setup</h2>
                <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Waiting for Host to start the game...</p>
                <div style="margin:16px 0; background:rgba(0,0,0,0.3); border-radius:8px; padding:12px;">
                    <h4 style="color:var(--accent-color); margin-bottom:10px;">Players: ${pCount}</h4>
                    ${pList}
                </div>
            </div>`;
    }
}

// ========================
// PHASE 2: REVEAL ROLES
// ========================
function renderRevealRoles(state, isHost, myId) {
    if (isHost) {
        return `
            <div class="glass text-center">
                <h2>🌙 Roles Distributed</h2>
                <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">All players are viewing their roles. When everyone is ready, begin the Night Phase so players can see their night information.</p>
                <div style="margin:20px 0; padding:16px; background:rgba(0,0,0,0.3); border-radius:8px;">
                    <p style="font-size:0.85rem; color:rgba(255,255,255,0.5);">ℹ Night Phase reveals:</p>
                    <ul style="text-align:left; font-size:0.8rem; color:rgba(255,255,255,0.5); margin:8px 0 0 16px; line-height:1.8;">
                        <li>Merlin sees Evil (not Mordred)</li>
                        <li>Percival sees Merlin & Morgana</li>
                        <li>Evil see each other (not Oberon)</li>
                    </ul>
                </div>
                <button id="btnBeginNight" class="btn primary full-width">Begin Night Phase 🌙</button>
            </div>`;
    }

    const myRole = state.roles?.[myId];
    if (!myRole) return `<div class="glass text-center"><p>Loading your role...</p></div>`;

    const isGood = GOOD_ROLES.includes(myRole);
    const teamColor = isGood ? '#4fc3f7' : '#ef5350';
    const teamLabel = isGood ? '🛡 Good Team' : '⚔ Evil Team';
    const desc = ROLE_DESC[myRole] || '';

    return `
        <div class="glass text-center">
            <h2>🌙 Your Role</h2>
            <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Keep this secret! <strong>Tap and hold</strong> the card to reveal.</p>
            <div id="roleCardContainer" style="margin:20px auto; position:relative; width:200px; height:280px; user-select:none; cursor:pointer;">
                <div id="roleCardBack" style="position:absolute; top:0; left:0; width:200px; height:280px; background:linear-gradient(135deg,#2a2a4a,#1a1a2e); border-radius:14px; display:flex; flex-direction:column; justify-content:center; align-items:center; color:#888; font-size:5rem; font-weight:bold; box-shadow:0 8px 24px rgba(0,0,0,0.6); border:2px solid rgba(255,255,255,0.15);">
                    ?
                    <span style="font-size:0.7rem; color:rgba(255,255,255,0.3); margin-top:8px;">HOLD TO REVEAL</span>
                </div>
                <img id="roleCardFront" src="${getAsset(myRole)}" class="hidden" style="position:absolute; top:0; left:0; width:200px; height:280px; border-radius:14px; object-fit:cover; box-shadow:0 8px 24px rgba(0,0,0,0.6);" alt="${myRole}">
            </div>
            <div id="roleDescPanel" class="hidden" style="margin-top:14px; padding:14px 16px; background:rgba(0,0,0,0.55); border-radius:10px; border:1px solid ${teamColor}40; text-align:left;">
                <p style="color:${teamColor}; font-weight:bold; font-size:0.85rem; margin-bottom:6px;">${ROLE_LABEL[myRole]} — ${teamLabel}</p>
                <p style="color:rgba(255,255,255,0.75); font-size:0.82rem; line-height:1.5; margin:0;">${desc}</p>
            </div>
            <p id="roleHoldHint" style="color:rgba(255,255,255,0.35); font-size:0.75rem; margin-top:10px;">Hold card to see role &amp; description</p>
            <p style="color:rgba(255,255,255,0.25); font-size:0.7rem; margin-top:4px;">Wait for Host to begin Night Phase</p>
        </div>`;
}

// ========================
// NIGHT PHASE
// ========================
function renderNightPhase(state, players, myId, isHost) {
    const nightDuration = Math.ceil(((state.nightEndTime || Date.now()) - Date.now()) / 1000);

    if (isHost) {
        currentInterval = setInterval(() => {
            const remain = Math.max(0, Math.ceil((state.nightEndTime - Date.now()) / 1000));
            const el = document.getElementById('nightTimer');
            if (el) el.textContent = remain;
        }, 200);
        return `
            <div class="glass text-center" style="border:2px solid rgba(100,100,200,0.5);">
                <h2 class="text-danger">🌙 NIGHT PHASE</h2>
                <p style="color:rgba(255,255,255,0.6);">Players are receiving their night information.</p>
                <p style="margin-top:16px;">Transitioning in <strong id="nightTimer">${Math.max(0, nightDuration)}</strong>s...</p>
            </div>`;
    }

    const myRole = state.roles?.[myId];
    let info = '';
    let infoTitle = 'You open your eyes...';

    if (myRole) {
        // Build visible lists
        const evilVisible = [];   // seen by merlin & evil
        const evilTeam = [];      // other evils (seen by evil, not oberon)
        const percivalTargets = []; // merlin + morgana (seen by percival)

        Object.keys(state.roles).forEach(id => {
            if (id === myId) return;
            const r = state.roles[id];
            if (EVIL_ROLES.includes(r) && r !== 'oberon') evilTeam.push(players[id]?.name || id);
            if (['assassin', 'morgana', 'minions', 'oberon'].includes(r)) evilVisible.push(players[id]?.name || id);
            if (['merlin', 'morgana'].includes(r)) percivalTargets.push(players[id]?.name || id);
        });

        if (myRole === 'merlin') {
            infoTitle = '👁 You are Merlin. You see the servants of Evil:';
            info = evilVisible.length > 0 ? evilVisible.join(', ') : 'None visible to you.';
        } else if (['assassin', 'morgana', 'mordred', 'minions'].includes(myRole)) {
            infoTitle = '⚔ You are Evil. Your allies are:';
            info = evilTeam.filter(n => n !== (players[myId]?.name)).length > 0
                ? evilTeam.filter(n => n !== (players[myId]?.name)).join(', ')
                : 'You have no visible allies.';
        } else if (myRole === 'percival') {
            infoTitle = '🔍 You are Percival. Merlin (or Morgana) is among:';
            info = percivalTargets.length > 0 ? percivalTargets.join(', ') : 'No one.';
        } else if (myRole === 'oberon') {
            infoTitle = '🌑 You are Oberon.';
            info = 'You do not know your allies, and they do not know you.';
        } else {
            infoTitle = '🛡 You are a Servant of Arthur.';
            info = 'You see nothing this night. Stay true to the cause.';
        }
    }

    currentInterval = setInterval(() => {
        const remain = Math.max(0, Math.ceil((state.nightEndTime - Date.now()) / 1000));
        const el = document.getElementById('nightTimer');
        if (el) el.textContent = remain;
    }, 200);

    return `
        <div class="glass text-center" style="border:2px solid rgba(100,100,200,0.5);">
            <h2 class="text-danger">🌙 NIGHT PHASE</h2>
            <p style="color:rgba(255,255,255,0.5); font-size:0.8rem;">Closing in <strong id="nightTimer">${Math.max(0, nightDuration)}</strong>s — memorise this!</p>
            <div style="margin:16px 0; padding:16px; background:rgba(0,0,0,0.85); border-radius:10px; border:1px solid rgba(255,255,255,0.05);">
                <p style="color:rgba(255,255,255,0.25); font-size:0.75rem; margin-bottom:8px;">${infoTitle}</p>
                <p style="color:rgba(255,255,255,0.22); font-size:0.95rem; font-weight:bold; line-height:1.5;">${info}</p>
            </div>
            <p style="color:rgba(255,255,255,0.2); font-size:0.7rem;">Screen dimmed for privacy</p>
        </div>`;
}

// ========================
// PHASE 3: TEAM BUILDING
// ========================
function renderTeamBuilding(state, players, isHost, myId) {
    const leaderId = state.roundLeader;
    const playingCount = Object.keys(players).filter(id => !players[id].isHost).length;
    const req = (QUEST_REQUIREMENTS[playingCount] || [])[state.scores?.currentQuest ?? 0] || '?';
    const questNum = (state.scores?.currentQuest ?? 0) + 1;

    // Player grid showing who is leader
    let pGrid = `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:12px 0;">`;
    Object.keys(players).forEach(id => {
        if (players[id].isHost) return;
        const isLeader = id === leaderId;
        pGrid += `
            <div style="background:${isLeader ? 'rgba(255,200,0,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${isLeader ? 'gold' : 'rgba(255,255,255,0.1)'}; border-radius:8px; padding:8px; text-align:center; position:relative;">
                ${isLeader ? `<span style="position:absolute;top:-8px;right:-4px;font-size:1rem;">👑</span>` : ''}
                <p style="margin:0; font-size:0.8rem; font-weight:bold; color:${isLeader ? 'gold' : '#fff'};">${players[id].name}</p>
            </div>`;
    });
    pGrid += `</div>`;

    let controls = '';
    const proposedTeam = Array.isArray(state.proposedTeam) ? state.proposedTeam : [];

    if (!leaderId) {
        if (isHost) {
            let opts = Object.keys(players)
                .filter(id => !players[id].isHost)
                .map(id => `<option value="${id}">${players[id].name}</option>`).join('');
            controls = `
                <div class="glass mt-10">
                    <h4 style="margin-bottom:10px;">📋 Assign Round Leader</h4>
                    <select id="selLeader" style="width:100%; padding:10px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:#fff; margin-bottom:10px;">
                        <option value="">Select player...</option>${opts}
                    </select>
                    <button id="btnAssignLeader" class="btn primary full-width">Assign Leader 👑</button>
                </div>`;
        } else {
            controls = `<p style="color:rgba(255,255,255,0.4); margin-top:16px; font-size:0.85rem;">⏳ Waiting for Host to assign a Leader...</p>`;
        }
    } else {
        if (!isHost && myId === leaderId) {
            // Leader sees the checkbox selection
            let chks = Object.keys(players)
                .filter(id => !players[id].isHost && id !== leaderId)
                .map(id => {
                    const alreadySelected = proposedTeam.includes(id);
                    return `
                        <label id="lbl-${id}" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(255,255,255,0.04); border-radius:6px; margin-bottom:6px; cursor:pointer; border:1px solid rgba(255,255,255,0.08);">
                            <input type="checkbox" class="chk-team" value="${id}" ${alreadySelected ? 'checked' : ''} style="width:18px; height:18px;">
                            <span style="font-size:0.9rem;">${players[id].name}</span>
                        </label>`;
                }).join('');
            controls = `
                <div class="glass mt-10 text-left">
                    <h4>👑 You are the Leader!</h4>
                    <p style="color:rgba(255,255,255,0.5); font-size:0.8rem; margin-bottom:10px;">Select exactly <strong style="color:gold;">${req}</strong> players for Quest ${questNum}:</p>
                    <div id="teamCheckboxes">${chks}</div>
                    <p id="selCount" style="text-align:center; color:rgba(255,255,255,0.5); font-size:0.8rem; margin:8px 0;">Selected: 0 / ${req}</p>
                    <button id="btnSubmitTeam" class="btn primary full-width" disabled>Propose Team (select ${req})</button>
                </div>`;
        } else if (!isHost) {
            const leaderName = players[leaderId]?.name || 'Leader';
            controls = `<p style="color:rgba(255,255,255,0.4); margin-top:16px; font-size:0.85rem;">⏳ Waiting for <strong>${leaderName}</strong> to propose a team of ${req}...</p>`;
        } else {
            // Host sees a summary
            controls = `<p style="color:rgba(255,255,255,0.4); margin-top:16px; font-size:0.85rem;">⏳ Waiting for <strong>${players[leaderId]?.name}</strong> to propose a team...</p>`;
        }
    }

    return `
        <div>
            <div class="glass text-center" style="padding:12px 16px;">
                <h3 style="margin-bottom:4px;">⚔ Quest ${questNum} — Team Building</h3>
                <p style="color:rgba(255,255,255,0.5); font-size:0.8rem;">Need <strong style="color:gold;">${req}</strong> players on the quest</p>
            </div>
            ${pGrid}
            ${controls}
        </div>`;
}

// ========================
// PHASE 4: PUBLIC VOTING
// ========================
function renderPublicVoting(state, players, isHost, myId) {
    const hasVoted = state.publicVotes?.[myId];
    const proposedTeam = Array.isArray(state.proposedTeam) ? state.proposedTeam : [];
    const totalVotes = Object.keys(state.publicVotes || {}).length;
    const playingCount = Object.keys(players).filter(id => !players[id].isHost).length;

    let teamHtml = proposedTeam.map(id =>
        `<div style="background:rgba(79,195,247,0.15); border:1px solid rgba(79,195,247,0.4); border-radius:8px; padding:8px 14px; margin:4px; display:inline-block; font-size:0.9rem;">👤 ${players[id]?.name || id}</div>`
    ).join('');

    let votingControls = '';
    if (isHost) {
        votingControls = `
            <p style="color:rgba(255,255,255,0.5); font-size:0.85rem; margin-top:12px;">⏳ Votes cast: ${totalVotes} / ${playingCount}</p>`;
    } else if (!hasVoted) {
        votingControls = `
            <p style="color:rgba(255,255,255,0.6); font-size:0.85rem; margin-bottom:12px;">Do you approve this team?</p>
            <div style="display:flex; justify-content:space-around; gap:12px;">
                <div style="text-align:center; flex:1;">
                    <img src="${getAsset('approve')}" id="btnVoteApprove" style="width:110px; cursor:pointer; border-radius:12px; border:2px solid transparent; transition:border 0.2s;" class="vote-btn">
                    <p style="color:#4fc3f7; font-size:0.75rem; margin-top:4px;">APPROVE</p>
                </div>
                <div style="text-align:center; flex:1;">
                    <img src="${getAsset('reject')}" id="btnVoteReject" style="width:110px; cursor:pointer; border-radius:12px; border:2px solid transparent; transition:border 0.2s;" class="vote-btn">
                    <p style="color:#ef5350; font-size:0.75rem; margin-top:4px;">REJECT</p>
                </div>
            </div>`;
    } else {
        votingControls = `<p style="color:rgba(255,255,255,0.4); margin-top:12px; font-size:0.85rem;">✓ Vote cast. Waiting for others... (${totalVotes}/${playingCount})</p>`;
    }

    return `
        <div class="glass text-center">
            <h3>🗳 Team Vote</h3>
            <p style="color:rgba(255,255,255,0.5); font-size:0.8rem; margin-bottom:10px;">Proposed team:</p>
            <div style="margin-bottom:12px;">${teamHtml}</div>
            <hr style="border-color:rgba(255,255,255,0.1);">
            ${votingControls}
        </div>`;
}

function renderQuestVoting(state, players, isHost, myId) {
    const proposedTeam = Array.isArray(state.proposedTeam) ? state.proposedTeam : [];
    const isTeamMember = proposedTeam.includes(myId);
    const hasVoted = state.questVotes?.[myId];
    const teamVotes = Object.keys(state.questVotes || {}).length;

    if (isHost) {
        return `
            <div class="glass text-center">
                <h3>⚔ Quest in Progress</h3>
                <p style="color:rgba(255,255,255,0.5); font-size:0.85rem;">Team is voting on the Quest. Waiting...</p>
                <p style="color:rgba(255,255,255,0.4); margin-top:8px; font-size:0.8rem;">Votes: ${teamVotes} / ${proposedTeam.length}</p>
            </div>`;
    }

    let content = '';
    if (isTeamMember && !hasVoted) {
        content = `
            <h4 style="color:gold;">You are on the Quest!</h4>
            <p style="color:rgba(255,255,255,0.6); font-size:0.85rem; margin-bottom:16px;">Choose your card wisely:</p>
            <div style="display:flex; justify-content:space-around; gap:12px;">
                <div style="text-align:center; flex:1;">
                    <img src="${getAsset('success')}" id="btnQuestSuccess" style="width:110px; cursor:pointer; border-radius:12px; border:2px solid rgba(79,195,247,0.5); transition:transform 0.15s;">
                    <p style="color:#4fc3f7; font-size:0.75rem; margin-top:4px;">SUCCESS</p>
                </div>
                <div style="text-align:center; flex:1;">
                    <img src="${getAsset('fail')}" id="btnQuestFail" style="width:110px; cursor:pointer; border-radius:12px; border:2px solid rgba(239,83,80,0.5); transition:transform 0.15s;">
                    <p style="color:#ef5350; font-size:0.75rem; margin-top:4px;">FAIL</p>
                </div>
            </div>`;
    } else if (isTeamMember && hasVoted) {
        content = `<p style="color:rgba(255,255,255,0.5);">✓ Quest vote cast. Waiting for team... (${teamVotes}/${proposedTeam.length})</p>`;
    } else {
        content = `<p style="color:rgba(255,255,255,0.5);">⏳ The team is on the Quest. Waiting for their return... (${teamVotes}/${proposedTeam.length})</p>`;
    }

    return `
        <div class="glass text-center">
            <h3>⚔ Quest Phase</h3>
            ${content}
        </div>`;
}

// ========================
// QUEST RESULT
// ========================
function renderQuestResult(state, players, isHost) {
    const r = state.questResultData || {};
    const success = r.successCount ?? 0;
    const fails = r.failsCount ?? 0;
    const failed = r.questFailed ?? false;
    const questNum = (state.scores?.currentQuest ?? 0); // already incremented in scores before coming here? No — questResult stores the COMPLETED quest number
    
    const resultColor = failed ? '#ef5350' : '#4fc3f7';
    const resultText = failed ? '⚔ Quest Failed!' : '🛡 Quest Succeeded!';
    const resultBg = failed ? 'rgba(198,40,40,0.2)' : 'rgba(21,101,192,0.2)';
    const teamWin = failed ? 'Red Team' : 'Blue Team';

    // Build card icons
    let successIcons = '';
    for (let i = 0; i < success; i++) successIcons += `<span style="font-size:1.8rem; margin:4px;">🛡</span>`;
    let failIcons = '';
    for (let i = 0; i < fails; i++) failIcons += `<span style="font-size:1.8rem; margin:4px;">⚔</span>`;

    const hostBtn = isHost
        ? `<button id="btnContinueQuest" class="btn primary full-width mt-20">Continue →</button>`
        : `<p style="color:rgba(255,255,255,0.4); font-size:0.8rem; margin-top:16px;">Waiting for Host to continue...</p>`;

    return `
        <div class="glass text-center" style="border:3px solid ${resultColor}; background:${resultBg};">
            <h2 style="color:${resultColor}; animation: questPulse 0.6s ease-out;">${resultText}</h2>
            <p style="color:rgba(255,255,255,0.7); font-size:0.85rem; margin-bottom:16px;">${teamWin} wins this quest!</p>
            <div style="display:flex; justify-content:space-around; margin:16px 0;">
                <div style="text-align:center;">
                    <p style="color:#4fc3f7; font-size:0.75rem; margin-bottom:4px;">SUCCESS</p>
                    <div>${successIcons || '<span style="color:rgba(255,255,255,0.3);">—</span>'}</div>
                    <p style="color:#4fc3f7; font-weight:bold; font-size:1.2rem; margin-top:6px;">${success}</p>
                </div>
                <div style="width:1px; background:rgba(255,255,255,0.1);"></div>
                <div style="text-align:center;">
                    <p style="color:#ef5350; font-size:0.75rem; margin-bottom:4px;">FAIL</p>
                    <div>${failIcons || '<span style="color:rgba(255,255,255,0.3);">—</span>'}</div>
                    <p style="color:#ef5350; font-weight:bold; font-size:1.2rem; margin-top:6px;">${fails}</p>
                </div>
            </div>
            ${r.requiredFails > 1 ? `<p style="color:rgba(255,255,255,0.4); font-size:0.75rem;">(This quest required ${r.requiredFails} fails)</p>` : ''}
            ${hostBtn}
        </div>
        <style>
            @keyframes questPulse {
                0% { transform: scale(0.8); opacity:0; }
                60% { transform: scale(1.1); }
                100% { transform: scale(1); opacity:1; }
            }
        </style>`;
}

// ========================
// ASSASSINATION PHASE
// ========================
function renderAssassination(state, players, myId, isHost) {
    if (isHost) {
        return `
            <div class="glass text-center" style="border:2px solid #ef5350;">
                <h3 class="text-danger">🗡 Assassination Phase</h3>
                <p style="color:rgba(255,255,255,0.6);">Good team has 3 quest victories! Waiting for the Assassin to take their shot at Merlin...</p>
            </div>`;
    }

    const myRole = state.roles?.[myId];
    if (myRole === 'assassin') {
        // Only show good-team players (exclude known evils)
        let opts = Object.keys(players)
            .filter(id => !players[id].isHost && id !== myId && GOOD_ROLES.includes(state.roles?.[id]))
            .map(id => `<option value="${id}">${players[id].name}</option>`).join('');

        return `
            <div class="glass text-center" style="border:2px solid #ef5350;">
                <h3 class="text-danger">🗡 Assassination Phase</h3>
                <p style="color:rgba(255,255,255,0.7); font-size:0.85rem;">Good has won 3 Quests. Assassinate Merlin to steal the victory!</p>
                <select id="selAssassinate" style="width:100%; padding:10px; background:rgba(0,0,0,0.5); border:1px solid #ef5350; border-radius:8px; color:#fff; margin:14px 0;">
                    <option value="">Select your target...</option>${opts}
                </select>
                <button id="btnAssassinate" class="btn danger full-width">🗡 Assassinate</button>
            </div>`;
    } else {
        return `
            <div class="glass text-center" style="border:2px solid #ef5350;">
                <h3 class="text-danger">🗡 Assassination Phase</h3>
                <p style="color:rgba(255,255,255,0.6);">Good has 3 quest victories! Waiting for the Assassin to find Merlin...</p>
            </div>`;
    }
}

// ========================
// GAME OVER
// ========================
function renderGameOver(state, isHost, players) {
    const isGoodWin = state.winner === 'good';
    const winColor = isGoodWin ? '#4fc3f7' : '#ef5350';
    const winText = isGoodWin ? '🛡 GOOD TEAM WINS!' : '⚔ EVIL TEAM WINS!';
    const winBg = isGoodWin ? 'rgba(21,101,192,0.2)' : 'rgba(198,40,40,0.2)';

    // Show all roles
    let rolesHtml = '';
    if (state.roles && players) {
        rolesHtml = `<div style="margin-top:16px; border-top:1px solid rgba(255,255,255,0.1); padding-top:12px;">
            <p style="color:rgba(255,255,255,0.5); font-size:0.8rem; margin-bottom:8px;">ROLES REVEALED:</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">`;
        Object.keys(state.roles).forEach(id => {
            if (!players[id]) return;
            const r = state.roles[id];
            const isGood = GOOD_ROLES.includes(r);
            rolesHtml += `<div style="background:${isGood ? 'rgba(21,101,192,0.2)' : 'rgba(198,40,40,0.2)'}; border-radius:6px; padding:6px 8px; font-size:0.78rem;">
                <strong style="color:${isGood ? '#4fc3f7' : '#ef5350'};">${ROLE_LABEL[r] || r}</strong>
                <br><span style="color:rgba(255,255,255,0.5);">${players[id].name}</span>
            </div>`;
        });
        rolesHtml += `</div></div>`;
    }

    let hostControls = isHost ? `<button id="btnRestartAvalon" class="btn secondary full-width mt-20">🔄 Play Again</button>` : '';

    return `
        <div class="glass text-center" style="border:3px solid ${winColor}; background:${winBg};">
            <h1 style="color:${winColor}; font-size:1.8rem; margin-bottom:8px;">${winText}</h1>
            <p style="color:rgba(255,255,255,0.8); font-size:0.9rem;">${state.reason || ''}</p>
            ${rolesHtml}
            ${hostControls}
        </div>`;
}

// ========================
// EVENT LISTENERS
// ========================
function attachEventListeners(state, players, myId, isHost) {
    // Setup
    const btnStart = document.getElementById('btnStartAvalon');
    if (btnStart) btnStart.onclick = () => startAvalonGame();

    // Role card (big card, reveal_roles phase)
    const roleCardContainer = document.getElementById('roleCardContainer');
    if (roleCardContainer) {
        const front = document.getElementById('roleCardFront');
        const back = document.getElementById('roleCardBack');
        const descPanel = document.getElementById('roleDescPanel');
        const holdHint = document.getElementById('roleHoldHint');

        const showCard = () => {
            front?.classList.remove('hidden');
            back?.classList.add('hidden');
            descPanel?.classList.remove('hidden');
            if (holdHint) holdHint.style.display = 'none';
        };
        const hideCard = () => {
            front?.classList.add('hidden');
            back?.classList.remove('hidden');
            descPanel?.classList.add('hidden');
            if (holdHint) holdHint.style.display = '';
            window.removeEventListener('mouseup', hideCard);
            window.removeEventListener('touchend', hideCard);
        };
        roleCardContainer.addEventListener('mousedown', () => {
            showCard();
            window.addEventListener('mouseup', hideCard);
        });
        roleCardContainer.addEventListener('touchstart', () => {
            showCard();
            window.addEventListener('touchend', hideCard);
        }, { passive: true });
    }

    // Mini role card (persistent in later phases)
    const miniBack = document.getElementById('miniCardBack');
    const miniFront = document.getElementById('miniCardFront');
    const miniLabel = document.getElementById('miniRoleLabel');
    if (miniBack) {
        const showMini = () => {
            miniFront?.classList.remove('hidden');
            miniBack.classList.add('hidden');
            if (miniLabel) miniLabel.style.filter = 'blur(0)';
        };
        const hideMini = () => {
            miniFront?.classList.add('hidden');
            miniBack.classList.remove('hidden');
            if (miniLabel) miniLabel.style.filter = 'blur(6px)';
            window.removeEventListener('mouseup', hideMini);
            window.removeEventListener('touchend', hideMini);
        };
        miniBack.addEventListener('mousedown', () => {
            showMini();
            window.addEventListener('mouseup', hideMini);
        });
        miniBack.addEventListener('touchstart', () => {
            showMini();
            window.addEventListener('touchend', hideMini);
        }, { passive: true });
    }

    // Night phase trigger
    const btnBeginNight = document.getElementById('btnBeginNight');
    if (btnBeginNight) btnBeginNight.onclick = beginNightPhase;

    // Assign leader
    const btnAssignLeader = document.getElementById('btnAssignLeader');
    if (btnAssignLeader) {
        btnAssignLeader.onclick = () => {
            const val = document.getElementById('selLeader')?.value;
            if (val) proposeLeader(val);
        };
    }

    // Team checkbox logic — dynamic disable when max reached
    const playingCount = Object.keys(players).filter(id => !players[id].isHost).length;
    const req = (QUEST_REQUIREMENTS[playingCount] || [])[state.scores?.currentQuest ?? 0] || 0;
    const checkboxContainer = document.getElementById('teamCheckboxes');
    const selCountEl = document.getElementById('selCount');
    const btnSubmitTeam = document.getElementById('btnSubmitTeam');

    if (checkboxContainer && btnSubmitTeam) {
        const updateCheckboxState = () => {
            const allChks = Array.from(checkboxContainer.querySelectorAll('.chk-team'));
            const count = allChks.filter(c => c.checked).length;

            if (selCountEl) selCountEl.textContent = `Selected: ${count} / ${req}`;

            allChks.forEach(chk => {
                const label = chk.closest('label');
                if (!chk.checked && count >= req) {
                    chk.disabled = true;
                    if (label) label.style.opacity = '0.4';
                } else {
                    chk.disabled = false;
                    if (label) label.style.opacity = '1';
                }
            });

            btnSubmitTeam.disabled = count !== req;
            btnSubmitTeam.textContent = count === req
                ? `✓ Propose Team (${req} selected)`
                : `Select ${req - count} more player${req - count !== 1 ? 's' : ''}`;
        };

        // Use click on label, not change on checkbox, for mobile reliability
        checkboxContainer.querySelectorAll('.chk-team').forEach(chk => {
            chk.addEventListener('change', updateCheckboxState);
        });

        btnSubmitTeam.onclick = () => {
            const ids = Array.from(checkboxContainer.querySelectorAll('.chk-team:checked')).map(c => c.value);
            if (ids.length === req) submitTeam(ids);
        };

        updateCheckboxState();
    }

    // Voting buttons
    const btnVoteApprove = document.getElementById('btnVoteApprove');
    if (btnVoteApprove) {
        btnVoteApprove.onclick = () => {
            btnVoteApprove.style.border = '2px solid #4fc3f7';
            submitPublicVote('approve');
        };
    }
    const btnVoteReject = document.getElementById('btnVoteReject');
    if (btnVoteReject) {
        btnVoteReject.onclick = () => {
            btnVoteReject.style.border = '2px solid #ef5350';
            submitPublicVote('reject');
        };
    }

    // Quest voting
    const btnQuestSuccess = document.getElementById('btnQuestSuccess');
    if (btnQuestSuccess) {
        btnQuestSuccess.onclick = () => {
            btnQuestSuccess.style.transform = 'scale(0.95)';
            submitQuestVote('success');
        };
    }
    const btnQuestFail = document.getElementById('btnQuestFail');
    if (btnQuestFail) {
        btnQuestFail.onclick = () => {
            btnQuestFail.style.transform = 'scale(0.95)';
            submitQuestVote('fail');
        };
    }

    // Quest result continue (host only)
    const btnContinueQuest = document.getElementById('btnContinueQuest');
    if (btnContinueQuest) btnContinueQuest.onclick = () => continueQuestResult(state);

    // Assassination
    const btnAssassinate = document.getElementById('btnAssassinate');
    if (btnAssassinate) {
        btnAssassinate.onclick = () => {
            const val = document.getElementById('selAssassinate')?.value;
            if (val) assassinate(val);
        };
    }

    // Restart
    const btnRestartAvalon = document.getElementById('btnRestartAvalon');
    if (btnRestartAvalon) btnRestartAvalon.onclick = resetAvalonGame;
}
