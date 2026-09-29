/* ============================================================
   ALPHA.BET 2026 COMPETITION - DISPLAY / OBS PANEL LOGIC
   Read-only broadcast display for audience and stream.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements
    const broadcastRoundEl = document.getElementById('broadcastRound');
    const currentStudentNameEl = document.getElementById('currentStudentName');
    const currentStudentScoreEl = document.getElementById('currentStudentScore');
    const displayGridEl = document.getElementById('displayGrid');

    const spotlightBoxNoEl = document.getElementById('spotlightBoxNo');
    const spotlightStateTextEl = document.getElementById('spotlightStateText');
    const displaySoundWaveEl = document.getElementById('displaySoundWave');
    const leaderboardListEl = document.getElementById('leaderboardList');

    const celebrationOverlayEl = document.getElementById('celebrationOverlay');
    const celebrationTitleEl = document.getElementById('celebrationTitle');
    const celebrationSubEl = document.getElementById('celebrationSub');

    // Full-screen Scoreboard Elements
    const scoreboardOverlayEl = document.getElementById('scoreboardOverlay');
    const scoreboardRoundEl = document.getElementById('scoreboardRound');
    const scoreboardListEl = document.getElementById('scoreboardList');

    let currentGameState = null;
    let competitionCode = null;

    // Extract competition code from URL path: /display/ABC123
    function extractCompetitionCode() {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2 && pathParts[0] === 'display') {
            return pathParts[1].toUpperCase();
        }
        return null;
    }

    // Register Role as Display on connect & reconnect
    function registerRole() {
        competitionCode = extractCompetitionCode();
        if (competitionCode) {
            document.getElementById('compCodeDisplay').textContent = competitionCode;
        }
        socket.emit('register_role', { role: 'display', code: competitionCode });
    }
    socket.on('connect', registerRole);
    registerRole();

    // Handle State Updates
    socket.on('state_update', (state) => {
        currentGameState = state;
        renderHeader(state);
        renderGrid(state);
        renderSpotlight(state);
        renderLeaderboard(state);
        if (state.isScoreboardVisible) {
            renderFullScreenScoreboard(state);
            scoreboardOverlayEl.classList.add('active');
        } else {
            scoreboardOverlayEl.classList.remove('active');
        }
    });

    socket.on('competition_reset', () => {
        scoreboardOverlayEl.classList.remove('active');
    });

    // Handle Audio Trigger (Audience / Stream Speaker)
    socket.on('audio_trigger', (data) => {
        if (displaySoundWaveEl) {
            displaySoundWaveEl.style.display = 'flex';
        }
        if (window.soundEngine && data && data.word) {
            window.soundEngine.speakWord(data.word, 
                () => {
                    if (displaySoundWaveEl) displaySoundWaveEl.style.display = 'flex';
                },
                () => {
                    if (displaySoundWaveEl) displaySoundWaveEl.style.display = 'none';
                }
            );
        }
    });

    // Handle Sound Effects & Celebrations
    socket.on('play_sound', (data) => {
        if (window.soundEngine && data.sound) {
            window.soundEngine.playSound(data.sound);
        }

        if (data.sound === 'correct') {
            triggerCelebration('CORRECT! ✓', '+1 POINT AWARDED');
        } else if (data.sound === 'wrong') {
            // subtle alert
        }
    });

    // Handle Full-Screen Scoreboard Display
    socket.on('show_scoreboard', (data) => {
        renderFullScreenScoreboard(data);
        scoreboardOverlayEl.classList.add('active');
        if (window.soundEngine) {
            window.soundEngine.playSound('round_change');
        }
    });

    function renderHeader(state) {
        if (!state) return;
        broadcastRoundEl.textContent = state.currentRound;

        const cur = state.currentStudent || { name: 'Student 1', totalScore: 0 };
        currentStudentNameEl.textContent = cur.name;
        currentStudentScoreEl.textContent = cur.totalScore || 0;
    }

    function renderGrid(state) {
        if (!state) return;
        displayGridEl.innerHTML = '';

        const gridState = state.gridState || {};

        for (let i = 1; i <= 20; i++) {
            const pad = i < 10 ? `0${i}` : `${i}`;
            const status = gridState[i] || 'available';

            const box = document.createElement('div');
            box.className = `d-box ${status}`;
            box.id = `dBox_${i}`;

            let statusLabel = 'AVAILABLE';
            if (status === 'active') statusLabel = 'ACTIVE';
            if (status === 'used') statusLabel = '✓ USED';

            box.innerHTML = `
                <div class="d-box-num">${pad}</div>
                <div class="d-box-tag">${statusLabel}</div>
            `;

            displayGridEl.appendChild(box);
        }
    }

    function renderSpotlight(state) {
        const q = state.activeQuestion;
        if (!q) {
            spotlightBoxNoEl.textContent = 'READY';
            spotlightStateTextEl.textContent = 'WAITING FOR QUESTION SELECTION...';
            displaySoundWaveEl.style.display = 'none';
            return;
        }

        spotlightBoxNoEl.textContent = `QUESTION ${q.boxLabel} ACTIVE`;

        if (q.status === 'submitted') {
            spotlightStateTextEl.textContent = 'SPELLING SUBMITTED — EVALUATING...';
            displaySoundWaveEl.style.display = 'none';
        } else {
            spotlightStateTextEl.textContent = 'LISTENING & SPELLING IN PROGRESS';
        }
    }

    function renderLeaderboard(state) {
        if (!state || !leaderboardListEl) return;
        leaderboardListEl.innerHTML = '';

        const sorted = [...(state.students || [])].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        sorted.forEach((s, idx) => {
            const item = document.createElement('div');
            item.className = `leaderboard-item ${s.id === state.currentStudentId ? 'active' : ''}`;
            item.innerHTML = `
                <div class="item-rank-name">
                    <span style="color:var(--accent-gold); font-family:var(--font-mono);">#${idx + 1}</span>
                    <span>${s.name}</span>
                </div>
                <div class="item-score">${s.totalScore || 0}</div>
            `;
            leaderboardListEl.appendChild(item);
        });
    }

    function triggerCelebration(title, sub) {
        celebrationTitleEl.textContent = title;
        celebrationSubEl.textContent = sub;
        celebrationOverlayEl.classList.add('active');

        setTimeout(() => {
            celebrationOverlayEl.classList.remove('active');
        }, 2200);
    }

    function renderFullScreenScoreboard(data) {
        if (!data || !data.students) return;

        scoreboardRoundEl.textContent = data.round || 'COMPETITION SCOREBOARD';

        const sorted = [...data.students].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        scoreboardListEl.innerHTML = '';

        sorted.forEach((s, idx) => {
            const item = document.createElement('div');
            let rankClass = '';
            if (idx === 0) rankClass = 'champion';
            else if (idx === 1) rankClass = 'runner-up';
            else if (idx === 2) rankClass = 'third-place';

            item.className = `scoreboard-item ${rankClass}`;

            let rankNumClass = '';
            if (idx === 0) rankNumClass = '';
            else if (idx === 1) rankNumClass = 'silver';
            else if (idx === 2) rankNumClass = 'bronze';

            const roundKey = data.round?.toLowerCase().includes('2') ? 'scoreR2' : 'scoreR1';
            const r1 = s.scoreR1 || 0;
            const r2 = s.scoreR2 || 0;
            const tb = s.scoreTB || 0;

            item.innerHTML = `
                <div class="scoreboard-rank">
                    <span class="rank-number ${rankNumClass}">#${idx + 1}</span>
                    <span class="student-name-large">${s.name}</span>
                </div>
                <div class="scoreboard-scores">
                    <div class="score-breakdown">
                        R1: ${r1} · R2: ${r2} · TB: ${tb}
                    </div>
                    <div class="total-score-large">${s.totalScore || 0}</div>
                </div>
            `;
            scoreboardListEl.appendChild(item);
        });
    }

    // Toggle Fullscreen via 'F' key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        }
    });
});
