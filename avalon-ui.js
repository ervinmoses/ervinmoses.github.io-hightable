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
    resetAvalonGame
} from './avalon.js?v=22';

const avalonGameArea = document.getElementById('avalonGameArea');
let holdTimer = null;
let currentInterval = null;

// Helper to get asset paths
const getAsset = (name) => `./assets/avalon/${name}.jpg`;

window.updateAvalonUI = (state, players, myId, isHost, currentRoom) => {
    // Clear existing interval if any
    if (currentInterval) clearInterval(currentInterval);

    let html = '';
    
    // Top Scoreboard (show in all phases except setup)
    if (state.phase !== 'setup') {
        html += renderScoreboard(state);
    }

    switch (state.phase) {
        case 'setup':
            html += renderSetup(isHost);
            break;
        case 'reveal_roles':
            html += renderRevealRoles(state, isHost, myId);
            break;
        case 'night_phase':
            html += renderNightPhase(state, players, myId);
            break;
        case 'team_building':
            html += renderTeamBuilding(state, players, isHost, myId);
            break;
        case 'public_voting':
            html += renderPublicVoting(state, players, isHost, myId);
            // Host checks if we can move on
            if (isHost) checkPublicVotesComplete(state);
            break;
        case 'quest_voting':
            html += renderQuestVoting(state, players, isHost, myId);
            if (isHost) checkQuestVotesComplete(state);
            break;
        case 'assassination':
            html += renderAssassination(state, players, myId);
            break;
        case 'game_over':
            html += renderGameOver(state, isHost);
            break;
    }

    avalonGameArea.innerHTML = html;
    
    // Attach Event Listeners
    attachEventListeners(state, players, myId, isHost);
};

function renderScoreboard(state) {
    let qResults = state.questResults || [];
    let circles = '';
    for (let i = 0; i < 5; i++) {
        let color = '#444';
        if (qResults[i]) {
            color = qResults[i].failed ? 'var(--danger-color)' : 'var(--primary-color)';
        }
        circles += `<div style="width: 20px; height: 20px; border-radius: 50%; background-color: ${color}; display: inline-block; margin: 0 5px;"></div>`;
    }
    return `
        <div class="glass text-center mb-10">
            <h3>Quests</h3>
            <div>${circles}</div>
            <p class="text-sm mt-5">Good: ${state.scores?.good || 0} | Evil: ${state.scores?.evil || 0}</p>
        </div>
    `;
}

function renderSetup(isHost) {
    if (isHost) {
        return `
            <div class="glass text-center">
                <h2>Avalon Setup</h2>
                <p>The game automatically assigns roles based on the player count.</p>
                <p>Host does NOT play and acts only as the controller.</p>
                <p class="text-danger mt-10">Requires 5-14 players (excluding Host).</p>
                <button id="btnStartAvalon" class="btn primary full-width mt-20">Start Game</button>
            </div>
        `;
    } else {
        return `
            <div class="glass text-center">
                <h2>Avalon Setup</h2>
                <p>Waiting for Host to configure and start the game...</p>
            </div>
        `;
    }
}

function renderRevealRoles(state, isHost, myId) {
    let hostControls = isHost ? `<button id="btnBeginNight" class="btn secondary full-width mt-20">Everyone Ready? Begin Night Phase</button>` : '';
    
    if (isHost) {
        return `
            <div class="glass text-center">
                <h2>Host Control</h2>
                <p>Wait for all players to view their roles.</p>
                ${hostControls}
            </div>
        `;
    }
    
    const myRole = state.roles[myId];
    return `
        <div class="glass text-center">
            <h2>Your Role</h2>
            <p>Tap and hold the card to secretly view your role.</p>
            <div id="roleCardContainer" class="mt-20" style="position: relative; display: inline-block; user-select: none;">
                <div id="roleCardBack" style="width:200px; height:280px; background-color:#dcdcdc; border-radius:10px; cursor:pointer; display:flex; justify-content:center; align-items:center; color:#333; font-size:6rem; font-weight:bold; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
                    ?
                </div>
                <img id="roleCardFront" src="${getAsset(myRole)}" onerror="alert('Failed to load image at: ' + this.src); this.onerror=null;" class="hidden" style="width:200px; border-radius:10px; box-shadow: 0 4px 8px rgba(0,0,0,0.5);" alt="Role">
            </div>
        </div>
    `;
}

function renderNightPhase(state, players, myId) {
    if (isHost) {
        currentInterval = setInterval(() => {
            const now = Date.now();
            const remain = Math.max(0, Math.ceil((state.nightEndTime - now) / 1000));
            const el = document.getElementById('nightTimer');
            if (el) el.textContent = remain;
        }, 100);

        return `
            <div class="glass text-center" style="border: 2px solid var(--accent-color);">
                <h2 class="text-danger">NIGHT PHASE</h2>
                <p>Time remaining: <strong id="nightTimer">5</strong>s</p>
                <div class="mt-20 text-muted">Players are reviewing night info...</div>
            </div>
        `;
    }

    const myRole = state.roles[myId];
    let info = 'You open your eyes but see nothing.';
    
    // Logic for what they see
    const evils = [];
    const merlins = []; // for Percival
    Object.keys(state.roles).forEach(id => {
        if (id === myId) return;
        const r = state.roles[id];
        const isEvil = ['assassin', 'morgana', 'mordred', 'minions', 'oberon'].includes(r);
        
        if (isEvil && r !== 'oberon') evils.push(players[id].name);
        
        if (r === 'merlin' || r === 'morgana') merlins.push(players[id].name);
    });

    if (myRole === 'merlin') {
        const visibleEvils = [];
        Object.keys(state.roles).forEach(id => {
            if (id === myId) return;
            const r = state.roles[id];
            if (['assassin', 'morgana', 'minions', 'oberon'].includes(r)) visibleEvils.push(players[id].name);
        });
        info = visibleEvils.length > 0 ? `The agents of Evil are: ${visibleEvils.join(', ')}` : 'You see no evil.';
    } else if (['assassin', 'morgana', 'mordred', 'minions'].includes(myRole)) {
        info = evils.length > 0 ? `Your fellow Evil agents are: ${evils.join(', ')}` : 'You are the only Evil agent.';
    } else if (myRole === 'percival') {
        info = merlins.length > 0 ? `Merlin (or Morgana) is among: ${merlins.join(', ')}` : 'You see no one.';
    }

    // Dynamic timer
    currentInterval = setInterval(() => {
        const now = Date.now();
        const remain = Math.max(0, Math.ceil((state.nightEndTime - now) / 1000));
        const el = document.getElementById('nightTimer');
        if (el) el.textContent = remain;
    }, 100);

    return `
        <div class="glass text-center" style="border: 2px solid var(--accent-color);">
            <h2 class="text-danger">NIGHT PHASE</h2>
            <p>Time remaining: <strong id="nightTimer">5</strong>s</p>
            <div class="mt-20" style="padding:20px; background:rgba(0,0,0,0.5); border-radius:8px;">
                <h3 style="color:#fff;">${info}</h3>
            </div>
        </div>
    `;
}

function renderTeamBuilding(state, players, isHost, myId) {
    const leaderId = state.roundLeader;
    
    // 1. Show all players and if they are leader
    let pList = `<div class="wheel-player-grid mt-10">`;
    Object.keys(players).forEach(id => {
        if (players[id].isHost) return;
        const isLeader = (id === leaderId);
        pList += `
            <div class="table-player-card glass wheel-player-box" style="position:relative;">
                ${isLeader ? `<img src="${getAsset('leader')}" style="position:absolute; top:-15px; right:-15px; width:40px; border-radius:50%; z-index:10; border:2px solid gold;">` : ''}
                <strong>${players[id].name}</strong>
            </div>
        `;
    });
    pList += `</div>`;

    // 2. Leader Controls / Waiting Text
    let controls = '';
    if (!leaderId) {
        if (isHost) {
            let opts = Object.keys(players)
                .filter(id => !players[id].isHost)
                .map(id => `<option value="${id}">${players[id].name}</option>`).join('');
            controls = `
                <div class="mt-20 glass">
                    <h4>Select Round Leader</h4>
                    <select id="selLeader" class="full-width mb-10"><option value="">Select player...</option>${opts}</select>
                    <button id="btnAssignLeader" class="btn primary full-width">Assign Leader</button>
                </div>
            `;
        } else {
            controls = `<p class="mt-20 text-muted">Waiting for Host to assign a Leader...</p>`;
        }
    } else {
        if (myId === leaderId) {
            let chks = Object.keys(players)
                .filter(id => !players[id].isHost)
                .map(id => `<label style="display:block; margin:10px 0;"><input type="checkbox" class="chk-team" value="${id}"> ${players[id].name}</label>`).join('');
            controls = `
                <div class="mt-20 glass text-left">
                    <h4>You are the Leader! Propose a team:</h4>
                    <div class="mt-10 mb-10" style="padding:10px; background:rgba(0,0,0,0.3); border-radius:5px;">
                        ${chks}
                    </div>
                    <button id="btnSubmitTeam" class="btn primary full-width">Propose Team</button>
                </div>
            `;
        } else {
            controls = `<p class="mt-20 text-muted">Waiting for ${players[leaderId].name} to propose a team...</p>`;
        }
    }

    let failsText = state.failsTracker > 0 ? `<p class="text-danger mt-10">Rejected Teams: ${state.failsTracker} / 5</p>` : '';

    return `
        <div class="text-center">
            <h3>Team Building</h3>
            ${failsText}
            ${pList}
            ${controls}
        </div>
    `;
}

function renderPublicVoting(state, players, isHost, myId) {
    const hasVoted = state.publicVotes && state.publicVotes[myId];
    
    let teamHtml = state.proposedTeam.map(id => `<span class="tag" style="background:var(--primary-color); padding:5px 10px; border-radius:20px; margin:5px; display:inline-block;">${players[id].name} <img src="${getAsset('team')}" style="width:20px; vertical-align:middle; border-radius:50%;"></span>`).join('');

    let votingControls = '';
    
    if (isHost) {
        votingControls = `<p class="mt-20 text-muted">Waiting for players to vote...</p>`;
    } else if (!hasVoted) {
        votingControls = `
            <div style="display:flex; justify-content:space-around; margin-top:20px;">
                <img src="${getAsset('approve')}" id="btnVoteApprove" style="width:120px; cursor:pointer; border-radius:10px; border:2px solid transparent;" class="vote-btn">
                <img src="${getAsset('reject')}" id="btnVoteReject" style="width:120px; cursor:pointer; border-radius:10px; border:2px solid transparent;" class="vote-btn">
            </div>
        `;
    } else {
        votingControls = `<p class="mt-20 text-muted">Vote cast. Waiting for others...</p>`;
    }

    return `
        <div class="glass text-center">
            <h3>Proposed Team</h3>
            <div class="mt-10 mb-20">${teamHtml}</div>
            <hr>
            <h4>Vote on this team:</h4>
            ${votingControls}
        </div>
    `;
}

function renderQuestVoting(state, players, isHost, myId) {
    let content = '';

    if (isHost) {
        content = `<p class="mt-20 text-muted">The team is on the Quest. Waiting for their return...</p>`;
    } else {
        const isTeamMember = state.proposedTeam.includes(myId);
        const hasVoted = state.questVotes && state.questVotes[myId];
        const myRole = state.roles[myId];
        const isEvil = ['assassin', 'morgana', 'mordred', 'minions', 'oberon'].includes(myRole);

        if (isTeamMember) {
            if (!hasVoted) {
                content = `
                    <h4>You are on the Quest!</h4>
                    <div style="display:flex; justify-content:space-around; margin-top:20px;">
                        <img src="${getAsset('success')}" id="btnQuestSuccess" style="width:120px; cursor:pointer; border-radius:10px;">
                        ${isEvil ? `<img src="${getAsset('fail')}" id="btnQuestFail" style="width:120px; cursor:pointer; border-radius:10px;">` : `<img src="${getAsset('fail')}" style="width:120px; opacity:0.3; filter:grayscale(100%);">`}
                    </div>
                `;
            } else {
                content = `<p class="mt-20 text-muted">Quest vote cast. Waiting for others...</p>`;
            }
        } else {
            content = `<p class="mt-20 text-muted">The team is on the Quest. Waiting for their return...</p>`;
        }
    }

    return `
        <div class="glass text-center">
            <h3>Quest Phase</h3>
            ${content}
        </div>
    `;
}

function renderAssassination(state, players, myId) {
    if (isHost) {
        return `
            <div class="glass text-center">
                <h3>ASSASSINATION PHASE</h3>
                <p>Good has 3 points! Waiting for the Assassin to take their shot...</p>
            </div>
        `;
    }

    const myRole = state.roles[myId];
    
    if (myRole === 'assassin') {
        let opts = Object.keys(players)
            .filter(id => id !== myId && !players[id].isHost && !['morgana', 'mordred', 'minions', 'oberon'].includes(state.roles[id]))
            .map(id => `<option value="${id}">${players[id].name}</option>`).join('');
            
        return `
            <div class="glass text-center danger-border">
                <h3 class="text-danger">ASSASSINATION PHASE</h3>
                <p>The Good team has won 3 Quests. You must assassinate Merlin to steal the win!</p>
                <select id="selAssassinate" class="full-width mt-10 mb-10"><option value="">Select target...</option>${opts}</select>
                <button id="btnAssassinate" class="btn danger full-width">Assassinate</button>
            </div>
        `;
    } else {
        return `
            <div class="glass text-center">
                <h3>ASSASSINATION PHASE</h3>
                <p>Good has 3 points! Waiting for the Assassin to take their shot...</p>
            </div>
        `;
    }
}

function renderGameOver(state, isHost) {
    const winColor = state.winner === 'good' ? 'var(--primary-color)' : 'var(--danger-color)';
    const winText = state.winner === 'good' ? 'BLUE TEAM WINS' : 'RED TEAM WINS';
    
    let hostControls = isHost ? `<button id="btnRestartAvalon" class="btn secondary full-width mt-20">Restart Game</button>` : '';

    return `
        <div class="glass text-center" style="border: 3px solid ${winColor};">
            <h1 style="color:${winColor};">${winText}</h1>
            <p class="mt-10 mb-10">${state.reason}</p>
            ${hostControls}
        </div>
    `;
}


// ========================
// Event Listeners Attacher
// ========================
function attachEventListeners(state, players, myId, isHost) {
    // Setup
    const btnStart = document.getElementById('btnStartAvalon');
    if (btnStart) {
        btnStart.onclick = () => {
            startAvalonGame();
        };
    }

    // Role Reveal
    const roleCardContainer = document.getElementById('roleCardContainer');
    if (roleCardContainer) {
        const front = document.getElementById('roleCardFront');
        const back = document.getElementById('roleCardBack');
        
        const showRole = () => { front.classList.remove('hidden'); back.classList.add('hidden'); };
        const hideRole = () => { front.classList.add('hidden'); back.classList.remove('hidden'); };
        
        roleCardContainer.addEventListener('mousedown', showRole);
        roleCardContainer.addEventListener('touchstart', showRole);
        
        window.addEventListener('mouseup', hideRole);
        window.addEventListener('touchend', hideRole);
    }
    
    const btnBeginNight = document.getElementById('btnBeginNight');
    if (btnBeginNight) btnBeginNight.onclick = beginNightPhase;

    // Team Building
    const btnAssignLeader = document.getElementById('btnAssignLeader');
    if (btnAssignLeader) {
        btnAssignLeader.onclick = () => {
            const val = document.getElementById('selLeader').value;
            if (val) proposeLeader(val);
        };
    }

    const btnSubmitTeam = document.getElementById('btnSubmitTeam');
    if (btnSubmitTeam) {
        btnSubmitTeam.onclick = () => {
            const chks = document.querySelectorAll('.chk-team:checked');
            const ids = Array.from(chks).map(c => c.value);
            submitTeam(ids);
        };
    }

    // Public Voting
    const btnVoteApprove = document.getElementById('btnVoteApprove');
    if (btnVoteApprove) btnVoteApprove.onclick = () => submitPublicVote('approve');
    const btnVoteReject = document.getElementById('btnVoteReject');
    if (btnVoteReject) btnVoteReject.onclick = () => submitPublicVote('reject');

    // Quest Voting
    const btnQuestSuccess = document.getElementById('btnQuestSuccess');
    if (btnQuestSuccess) btnQuestSuccess.onclick = () => submitQuestVote('success');
    const btnQuestFail = document.getElementById('btnQuestFail');
    if (btnQuestFail) btnQuestFail.onclick = () => submitQuestVote('fail');

    // Assassination
    const btnAssassinate = document.getElementById('btnAssassinate');
    if (btnAssassinate) {
        btnAssassinate.onclick = () => {
            const val = document.getElementById('selAssassinate').value;
            if (val) assassinate(val);
        };
    }

    // Restart
    const btnRestartAvalon = document.getElementById('btnRestartAvalon');
    if (btnRestartAvalon) btnRestartAvalon.onclick = resetAvalonGame;
}
