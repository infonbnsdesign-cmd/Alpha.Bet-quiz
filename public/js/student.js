/* ============================================================
   ALPHA.BET 2026 COMPETITION - STUDENT / PREVIEW PANEL LOGIC
   The Student owns question selection from the 20-question grid.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements
    const studentNameEl = document.getElementById('studentName');
    const roundTitleEl = document.getElementById('roundTitle');
    const studentScoreEl = document.getElementById('studentScore');
    const questionsProgressEl = document.getElementById('questionsProgress');
    const questionGridEl = document.getElementById('questionGrid');

    // Answer Modal Elements
    const answerModalEl = document.getElementById('answerModal');
    const selectedBadgeEl = document.getElementById('selectedBadge');
    const audioStatusEl = document.getElementById('audioStatus');
    const spellingInputEl = document.getElementById('spellingInput');
    const submitBtnEl = document.getElementById('submitBtn');
    const inputSectionEl = document.getElementById('inputSection');
    const submittedSectionEl = document.getElementById('submittedSection');
    const submittedWordDisplayEl = document.getElementById('submittedWordDisplay');
    const oralSectionEl = document.getElementById('oralSection');
    const studentScoreboardModalEl = document.getElementById('studentScoreboardModal');
    const studentScoreboardListEl = document.getElementById('studentScoreboardList');
    const viewAllResultsBtnEl = document.getElementById('viewAllResultsBtn');
    const closeStudentScoreboardBtnEl = document.getElementById('closeStudentScoreboardBtn');

    let currentGameState = null;
    let competitionCode = null;

    // Extract competition code from URL path: /student/ABC123
    function extractCompetitionCode() {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2 && pathParts[0] === 'student') {
            return pathParts[1].toUpperCase();
        }
        return null;
    }

    // Register Role on connect & reconnect
    function registerRole() {
        competitionCode = extractCompetitionCode();
        if (competitionCode) {
            document.getElementById('compCodeDisplay').textContent = competitionCode;
        }
        socket.emit('register_role', { role: 'student', code: competitionCode });
    }
    socket.on('connect', registerRole);
    registerRole();

    // Handle State Updates
    socket.on('state_update', (state) => {
        currentGameState = state;
        renderHeader(state);
        renderGrid(state);
        renderAnswerStage(state);
        renderStudentScoreboard(state);
    });

    socket.on('show_scoreboard', (data) => {
        const fullData = { ...(currentGameState || {}), ...(data || {}), isScoreboardVisible: true };
        renderStudentScoreboard(fullData);
        if (window.soundEngine) {
            window.soundEngine.playSound('round_change');
        }
    });

    socket.on('hide_scoreboard', () => {
        if (studentScoreboardModalEl) studentScoreboardModalEl.classList.remove('active');
    });

    socket.on('competition_reset', () => {
        showToast('⚡ New Competition Started! Grid Reset (Boxes 01–20 Available).', 'success');
        if (studentScoreboardModalEl) studentScoreboardModalEl.classList.remove('active');
        if (answerModalEl) answerModalEl.classList.remove('active');
        if (spellingInputEl) {
            spellingInputEl.value = '';
            spellingInputEl.disabled = false;
        }
        if (submitBtnEl) submitBtnEl.disabled = false;
        if (inputSectionEl) inputSectionEl.style.display = 'block';
        if (submittedSectionEl) submittedSectionEl.style.display = 'none';
        registerRole();
        if (window.soundEngine) {
            window.soundEngine.playSound('round_change');
        }
    });

    // Handle Audio Trigger from Teacher
    socket.on('audio_trigger', (data) => {
        if (window.soundEngine && data && data.word) {
            audioStatusEl.innerHTML = `<span class="sound-bars"><span class="sound-bar"></span><span class="sound-bar"></span><span class="sound-bar"></span><span class="sound-bar"></span><span class="sound-bar"></span></span> Listening to Pronunciation...`;
            window.soundEngine.speakWord(data.word, 
                () => {
                    // onStart
                },
                () => {
                    // onEnd
                    audioStatusEl.innerHTML = `🎧 Pronunciation Played. Enter your spelling below:`;
                    if (spellingInputEl && !spellingInputEl.disabled) {
                        spellingInputEl.focus();
                    }
                }
            );
        }
    });

    // Handle Sound Effects
    socket.on('play_sound', (data) => {
        if (window.soundEngine && data.sound) {
            window.soundEngine.playSound(data.sound);
        }
    });

    // Handle Action Errors
    socket.on('action_error', (data) => {
        showToast(data.message || 'Action error', 'danger');
    });

    // Render Student Header Info
    function renderHeader(state) {
        if (!state) return;
        const cur = state.currentStudent || { name: 'Student 1', totalScore: 0, questionsCompleted: 0 };
        studentNameEl.textContent = cur.name;
        roundTitleEl.textContent = state.currentRound;
        studentScoreEl.textContent = cur.totalScore || 0;
        const qps = state.roundSettings?.questionsPerStudent || 5;
        questionsProgressEl.textContent = `Completed: ${cur.questionsCompleted || 0} / ${qps}`;
    }

    // Render 20-Question Grid
    function renderGrid(state) {
        if (!state) return;
        questionGridEl.innerHTML = '';

        const gridState = state.gridState || {};
        const isPaused = state.isPaused;

        for (let i = 1; i <= 20; i++) {
            const pad = i < 10 ? `0${i}` : `${i}`;
            const status = gridState[i] || 'available';

            const box = document.createElement('div');
            box.className = `q-box ${status}`;
            box.dataset.boxNo = i;

            box.innerHTML = `
                <div class="q-box-number">${pad}</div>
                <div class="q-box-status">${status === 'used' ? 'LOCKED' : status}</div>
            `;

            if (status === 'available' && !isPaused && !state.activeQuestion) {
                box.addEventListener('click', () => {
                    handleBoxSelect(i);
                });
            }

            questionGridEl.appendChild(box);
        }
    }

    // Student Selects a Box
    function handleBoxSelect(boxNo) {
        // Unlock audio on Android — this tap IS a user gesture
        if (window.soundEngine) {
            window.soundEngine.unlockAudio();
            window.soundEngine.playSound('select');
        }
        socket.emit('student_select_question', { boxNo });
    }

    // Render Answering Modal / Stage
    function renderAnswerStage(state) {
        const q = state.activeQuestion;
        if (!q) {
            answerModalEl.classList.remove('active');
            spellingInputEl.value = '';
            inputSectionEl.style.display = 'block';
            submittedSectionEl.style.display = 'none';
            if (oralSectionEl) oralSectionEl.style.display = 'none';
            return;
        }

        answerModalEl.classList.add('active');
        selectedBadgeEl.textContent = `QUESTION ${q.boxLabel} SELECTED`;

        // Preload audio for this word when question activates
        // (word is not sent to student, but we can request audio via socket)
        if (window.soundEngine && q.hasAudioPlayed === false) {
            window.soundEngine.initAudioContext();
        }

        // Check if student typing mode is enabled
        const isTypingEnabled = state.roundSettings?.studentTypingEnabled !== false;

        if (!isTypingEnabled) {
            // Oral Spelling Mode: No typing, student spells aloud to judge
            inputSectionEl.style.display = 'none';
            submittedSectionEl.style.display = 'none';
            if (oralSectionEl) oralSectionEl.style.display = 'block';
        } else {
            // Typing Mode: Student types their spelling
            if (oralSectionEl) oralSectionEl.style.display = 'none';

            if (q.status === 'submitted') {
                inputSectionEl.style.display = 'none';
                submittedSectionEl.style.display = 'block';
                submittedWordDisplayEl.textContent = q.studentAnswer;
            } else {
                inputSectionEl.style.display = 'block';
                submittedSectionEl.style.display = 'none';
                spellingInputEl.disabled = false;
                submitBtnEl.disabled = false;
                setTimeout(() => {
                    spellingInputEl.focus();
                }, 100);
            }
        }
    }

    // Submit Answer
    function submitSpelling() {
        const val = spellingInputEl.value.trim();
        if (!val) {
            showToast('Please type the spelling first!', 'warning');
            spellingInputEl.focus();
            return;
        }

        if (window.soundEngine) {
            window.soundEngine.playSound('submit');
        }

        spellingInputEl.disabled = true;
        submitBtnEl.disabled = true;

        socket.emit('student_submit_answer', { answer: val });
    }

    submitBtnEl.addEventListener('click', submitSpelling);

    spellingInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitSpelling();
        }
    });

    // View All Results button handler
    if (viewAllResultsBtnEl && studentScoreboardModalEl) {
        viewAllResultsBtnEl.addEventListener('click', () => {
            if (currentGameState && currentGameState.students) {
                renderStudentScoreboard(currentGameState);
                studentScoreboardModalEl.classList.add('active');
            }
        });
    }

    // Close Student Scoreboard button handler
    if (closeStudentScoreboardBtnEl && studentScoreboardModalEl) {
        closeStudentScoreboardBtnEl.addEventListener('click', () => {
            studentScoreboardModalEl.classList.remove('active');
        });
    }

    // Render Student Scoreboard Modal
    function renderStudentScoreboard(state) {
        if (!state) return;
        const isVisible = state.isScoreboardVisible === true;
        const studentsList = state.students || (currentGameState && currentGameState.students) || [];

        if (studentScoreboardListEl && studentsList.length > 0) {
            studentScoreboardListEl.innerHTML = '';
            const sorted = [...studentsList].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
            sorted.forEach((s, idx) => {
                const item = document.createElement('div');
                let rankClass = '';
                if (idx === 0) rankClass = 'champion';
                else if (idx === 1) rankClass = 'runner-up';
                else if (idx === 2) rankClass = 'third-place';
                if (s.id === state.currentStudentId) rankClass += ' current-student';

                item.className = `student-scoreboard-item ${rankClass}`;
                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:0.85rem; min-width:0;">
                        <span class="rank-number" style="font-family:var(--font-mono); font-size:1.25rem; font-weight:900; min-width:32px; color:${idx === 0 ? 'var(--accent-gold)' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd8535' : '#64748b'};">#${idx + 1}</span>
                        <div style="display:flex; flex-direction:column; min-width:0;">
                            <span style="font-size:1.15rem; font-weight:800; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</span>
                            <span style="font-size:0.75rem; color:#94a3b8; font-family:var(--font-mono);">
                                R1: ${s.scoreR1 || 0} · R2: ${s.scoreR2 || 0} · TB: ${s.scoreTB || 0}
                            </span>
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <span style="font-size:1.4rem; font-weight:900; color:var(--primary-cyan); font-family:var(--font-mono);">
                            ${s.totalScore || 0}
                        </span>
                        <span style="font-size:0.7rem; color:#94a3b8; display:block; font-weight:700;">PTS</span>
                    </div>
                `;
                studentScoreboardListEl.appendChild(item);
            });
        }

        if (isVisible && studentScoreboardModalEl) {
            // Dismiss question answering overlay if open so scoreboard is unobstructed
            if (answerModalEl) answerModalEl.classList.remove('active');
            studentScoreboardModalEl.classList.add('active');
        } else if (!isVisible && studentScoreboardModalEl) {
            studentScoreboardModalEl.classList.remove('active');
        }
    }

    // Toast Utility
    function showToast(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 3500);
    }
});
