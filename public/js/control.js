/* ============================================================
   ALPHA.BET 2026 COMPETITION - TEACHER CONTROL PANEL LOGIC
   The Teacher evaluates answers and controls competition.
   Teacher does NOT select questions.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements - Top Bar
    const currentStudentNameEl = document.getElementById('currentStudentName');
    const studentScoreEl = document.getElementById('studentScore');
    const studentQuestionsCountEl = document.getElementById('studentQuestionsCount');
    const studentSelectDropdownEl = document.getElementById('studentSelectDropdown');
    const addStudentBtnEl = document.getElementById('addStudentBtn');
    const currentRoundTitleEl = document.getElementById('currentRoundTitle');
    const pauseBtnEl = document.getElementById('pauseBtn');

    // DOM Elements - Main Stage
    const waitingStageEl = document.getElementById('waitingStage');
    const evaluationStageEl = document.getElementById('evaluationStage');

    // Active Question Elements
    const selectedBoxPillEl = document.getElementById('selectedBoxPill');
    const selectedBoxLabelEl = document.getElementById('selectedBoxLabel');
    const correctWordDisplayEl = document.getElementById('correctWordDisplay');
    const wordMeaningDisplayEl = document.getElementById('wordMeaningDisplay');

    // Audio Buttons
    const playWordBtnEl = document.getElementById('playWordBtn');
    const replayWordBtnEl = document.getElementById('replayWordBtn');
    const audioStatePillEl = document.getElementById('audioStatePill');

    // Answer and Auto-Check Elements
    const studentAnswerDisplayEl = document.getElementById('studentAnswerDisplay');
    const autoCheckBadgeEl = document.getElementById('autoCheckBadge');
    const acceptResultBtnEl = document.getElementById('acceptResultBtn');
    const overrideResultBtnEl = document.getElementById('overrideResultBtn');

    // Round 2 Meaning Elements
    const round2MeaningSectionEl = document.getElementById('round2MeaningSection');
    const meaningCorrectBtnEl = document.getElementById('meaningCorrectBtn');
    const meaningIncorrectBtnEl = document.getElementById('meaningIncorrectBtn');

    // Confirm Button
    const confirmQuestionBtnEl = document.getElementById('confirmQuestionBtn');

    // Round Control Buttons
    const btnRound1El = document.getElementById('btnRound1');
    const btnRound2El = document.getElementById('btnRound2');
    const btnTieBreakerEl = document.getElementById('btnTieBreaker');
    const endTieBreakerBtnEl = document.getElementById('endTieBreakerBtn');

    // Settings Elements
    const questionsPerStudentInputEl = document.getElementById('questionsPerStudentInput');
    const setQuestionsPerStudentBtnEl = document.getElementById('setQuestionsPerStudentBtn');
    const audioFileInputEl = document.getElementById('audioFileInput');
    const uploadAudioBtnEl = document.getElementById('uploadAudioBtn');
    const resetCompetitionBtnEl = document.getElementById('resetCompetitionBtn');

    // Leaderboard Elements
    const controlLeaderboardListEl = document.getElementById('controlLeaderboardList');
    const toggleLeaderboardBtnEl = document.getElementById('toggleLeaderboardBtn');

    // Modals
    const addStudentModalEl = document.getElementById('addStudentModal');
    const newStudentInputEl = document.getElementById('newStudentInput');
    const saveStudentBtnEl = document.getElementById('saveStudentBtn');
    const cancelStudentBtnEl = document.getElementById('cancelStudentBtn');

    const uploadExcelModalEl = document.getElementById('uploadExcelModal');
    const excelFileInputEl = document.getElementById('excelFileInput');
    const uploadExcelBtnEl = document.getElementById('uploadExcelBtn');
    const cancelExcelBtnEl = document.getElementById('cancelExcelBtn');
    const openExcelModalBtnEl = document.getElementById('openExcelModalBtn');

    // Students Excel Upload Elements
    const uploadStudentsModalEl = document.getElementById('uploadStudentsModal');
    const openStudentExcelModalBtnEl = document.getElementById('openStudentExcelModalBtn');
    const importStudentsExcelBtnEl = document.getElementById('importStudentsExcelBtn');
    const closeStudentsModalBtnEl = document.getElementById('closeStudentsModalBtn');
    const cancelStudentsExcelBtnEl = document.getElementById('cancelStudentsExcelBtn');
    const studentsExcelFileInputEl = document.getElementById('studentsExcelFileInput');
    const uploadStudentsExcelSubmitBtnEl = document.getElementById('uploadStudentsExcelSubmitBtn');

    const scoreboardModalEl = document.getElementById('scoreboardModal');
    const openScoreboardBtnEl = document.getElementById('openScoreboardBtn');
    const closeScoreboardBtnEl = document.getElementById('closeScoreboardBtn');
    const scoreboardListEl = document.getElementById('scoreboardList');
    const broadcastScoreboardBtnEl = document.getElementById('broadcastScoreboardBtn');
    const dismissScoreboardBtnEl = document.getElementById('dismissScoreboardBtn');

    const resetConfirmModalEl = document.getElementById('resetConfirmModal');
    const cancelResetBtnEl = document.getElementById('cancelResetBtn');
    const confirmResetBtnEl = document.getElementById('confirmResetBtn');
    const resetGridBtnEl = document.getElementById('resetGridBtn');

    let currentGameState = null;
    let competitionCode = null;

    // Extract competition code from URL path: /control/ABC123
    function extractCompetitionCode() {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2 && pathParts[0] === 'control') {
            return pathParts[1].toUpperCase();
        }
        return null;
    }

    // Register Role as Control on connect & reconnect
    function registerRole() {
        competitionCode = extractCompetitionCode();
        if (competitionCode) {
            document.getElementById('compCodeDisplay').textContent = competitionCode;
        }
        socket.emit('register_role', { role: 'control', code: competitionCode });
    }
    socket.on('connect', registerRole);
    registerRole();

    // Handle State Updates
    socket.on('state_update', (state) => {
        currentGameState = state;
        renderDashboard(state);
        renderActiveQuestion(state);
        if (state.isScoreboardVisible) {
            openScoreboard();
        }
    });

    socket.on('show_scoreboard', () => {
        openScoreboard();
    });

    socket.on('competition_reset', () => {
        showToast('⚡ New Competition Started! All scores & 20 questions reset.', 'success');
        if (scoreboardModalEl) scoreboardModalEl.classList.remove('active');
        if (resetConfirmModalEl) resetConfirmModalEl.classList.remove('active');
        registerRole();
    });

    // Handle Audio Trigger (so teacher hears the word pronunciation as well)
    socket.on('audio_trigger', (data) => {
        if (window.soundEngine && data && data.word) {
            audioStatePillEl.textContent = '🔊 Playing Pronunciation...';
            audioStatePillEl.className = 'role-badge student';
            window.soundEngine.speakWord(data.word, 
                () => {},
                () => {
                    audioStatePillEl.textContent = '✓ Played';
                    audioStatePillEl.className = 'role-badge';
                }
            );
        }
    });

    // Handle Action Errors
    socket.on('action_error', (data) => {
        showToast(data.message || 'Action error', 'danger');
    });

    // Render Dashboard
    function renderDashboard(state) {
        if (!state) return;

        const cur = state.currentStudent || { name: 'Student 1', totalScore: 0, questionsCompleted: 0 };
        currentStudentNameEl.textContent = cur.name;
        studentScoreEl.textContent = cur.totalScore || 0;
        const qps = state.roundSettings?.questionsPerStudent || 5;
        studentQuestionsCountEl.textContent = `${cur.questionsCompleted || 0} / ${qps} Questions`;
        if (questionsPerStudentInputEl) questionsPerStudentInputEl.value = qps;

        currentRoundTitleEl.textContent = state.currentRound;

        // Populate student dropdown
        const currentId = state.currentStudentId;
        studentSelectDropdownEl.innerHTML = '';
        (state.students || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.name} (${s.totalScore || 0} pts)`;
            if (s.id === currentId) opt.selected = true;
            studentSelectDropdownEl.appendChild(opt);
        });

        // Pause state
        if (state.isPaused) {
            pauseBtnEl.innerHTML = '▶ RESUME COMPETITION';
            pauseBtnEl.className = 'btn btn-warning';
        } else {
            pauseBtnEl.innerHTML = '⏸ PAUSE';
            pauseBtnEl.className = 'btn btn-secondary';
        }

        // Round button highlights
        btnRound1El.className = state.roundKey === 'round_1' ? 'btn btn-primary' : 'btn btn-secondary';
        btnRound2El.className = state.roundKey === 'round_2' ? 'btn btn-primary' : 'btn btn-secondary';
        btnTieBreakerEl.className = state.roundKey === 'tie_breaker' ? 'btn btn-warning' : 'btn btn-secondary';

        // Tie Breaker end button visibility
        if (state.roundKey === 'tie_breaker') {
            endTieBreakerBtnEl.style.display = 'inline-flex';
        } else {
            endTieBreakerBtnEl.style.display = 'none';
        }

        // Render Control Panel Leaderboard
        renderControlLeaderboard(state);
    }

    // Render Control Panel Leaderboard
    function renderControlLeaderboard(state) {
        if (!controlLeaderboardListEl || !state.students) return;

        const sorted = [...state.students].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        controlLeaderboardListEl.innerHTML = '';

        sorted.forEach((s, idx) => {
            const item = document.createElement('div');
            let rankClass = '';
            let rankNumClass = '';
            if (idx === 0) { rankClass = 'champion'; rankNumClass = ''; }
            else if (idx === 1) { rankNumClass = 'silver'; }
            else if (idx === 2) { rankNumClass = 'bronze'; }
            if (s.id === state.currentStudentId) rankClass += ' current-student';

            item.className = `leaderboard-item ${rankClass}`;

            const r1 = s.scoreR1 || 0;
            const r2 = s.scoreR2 || 0;
            const tb = s.scoreTB || 0;

            item.innerHTML = `
                <div class="leaderboard-rank">
                    <span class="rank-number ${rankNumClass}">#${idx + 1}</span>
                    <span>${s.name}</span>
                </div>
                <div class="leaderboard-scores">
                    <span class="score-breakdown">R1:${r1} R2:${r2} TB:${tb}</span>
                    <span class="total-score">${s.totalScore || 0}</span>
                </div>
            `;
            controlLeaderboardListEl.appendChild(item);
        });
    }

    // Render Main Evaluation Stage
    function renderActiveQuestion(state) {
        const q = state.activeQuestion;

        if (!q) {
            waitingStageEl.style.display = 'flex';
            evaluationStageEl.style.display = 'none';
            return;
        }

        waitingStageEl.style.display = 'none';
        evaluationStageEl.style.display = 'flex';

        selectedBoxPillEl.textContent = `BOX ${q.boxLabel}`;
        selectedBoxLabelEl.textContent = `STUDENT SELECTED: QUESTION ${q.boxLabel}`;
        correctWordDisplayEl.textContent = q.word;
        wordMeaningDisplayEl.textContent = q.meaning ? `"${q.meaning}"` : "(No definition provided)";

        // Student Answer
        if (q.studentAnswer) {
            studentAnswerDisplayEl.innerHTML = `<span style="color:#ffffff">${q.studentAnswer}</span>`;
        } else {
            studentAnswerDisplayEl.innerHTML = `<span class="waiting-student-type">Student listening / typing spelling...</span>`;
        }

        // Automatic Check Badge & Overrides
        const effectiveVerdict = q.manualOverride || q.autoResult;

        if (q.status === 'submitted' || effectiveVerdict) {
            if (effectiveVerdict === 'correct') {
                autoCheckBadgeEl.className = 'check-verdict-badge correct';
                autoCheckBadgeEl.innerHTML = `✓ CORRECT SPELLING ${q.manualOverride ? '(OVERRIDDEN)' : ''}`;
            } else {
                autoCheckBadgeEl.className = 'check-verdict-badge incorrect';
                autoCheckBadgeEl.innerHTML = `✕ WRONG SPELLING ${q.manualOverride ? '(OVERRIDDEN)' : ''}`;
            }
            overrideResultBtnEl.disabled = false;
            acceptResultBtnEl.disabled = false;
            confirmQuestionBtnEl.disabled = false;
        } else {
            autoCheckBadgeEl.className = 'check-verdict-badge';
            autoCheckBadgeEl.style.background = 'rgba(255,255,255,0.05)';
            autoCheckBadgeEl.style.color = '#94a3b8';
            autoCheckBadgeEl.innerHTML = `Waiting for student submit...`;
            overrideResultBtnEl.disabled = true;
            acceptResultBtnEl.disabled = true;
            confirmQuestionBtnEl.disabled = true;
        }

        // Round 2 Oral Meaning Check
        if (state.roundKey === 'round_2') {
            round2MeaningSectionEl.style.display = 'flex';
            if (q.meaningResult === 'correct') {
                meaningCorrectBtnEl.className = 'btn btn-success';
                meaningIncorrectBtnEl.className = 'btn btn-secondary';
            } else if (q.meaningResult === 'incorrect') {
                meaningCorrectBtnEl.className = 'btn btn-secondary';
                meaningIncorrectBtnEl.className = 'btn btn-danger';
            } else {
                meaningCorrectBtnEl.className = 'btn btn-secondary';
                meaningIncorrectBtnEl.className = 'btn btn-secondary';
            }
        } else {
            round2MeaningSectionEl.style.display = 'none';
        }
    }

    // Audio Play Trigger
    playWordBtnEl.addEventListener('click', () => {
        socket.emit('teacher_play_audio');
    });

    replayWordBtnEl.addEventListener('click', () => {
        socket.emit('teacher_play_audio');
    });

    // Accept / Confirm Result
    acceptResultBtnEl.addEventListener('click', () => {
        showToast('Automatic result accepted. Click Confirm & Record to finish.', 'info');
    });

    // Override Result
    overrideResultBtnEl.addEventListener('click', () => {
        socket.emit('teacher_override_result', {});
    });

    // Round 2 Meaning Marking
    meaningCorrectBtnEl.addEventListener('click', () => {
        socket.emit('teacher_mark_meaning', { result: 'correct' });
    });

    meaningIncorrectBtnEl.addEventListener('click', () => {
        socket.emit('teacher_mark_meaning', { result: 'incorrect' });
    });

    // Confirm and Record Score (transitions question to USED)
    confirmQuestionBtnEl.addEventListener('click', () => {
        socket.emit('teacher_confirm_question');
    });

    // Student Switcher
    studentSelectDropdownEl.addEventListener('change', (e) => {
        socket.emit('teacher_switch_student', { studentId: e.target.value });
    });

    // Pause / Resume
    pauseBtnEl.addEventListener('click', () => {
        const nextPaused = !currentGameState?.isPaused;
        socket.emit('teacher_set_paused', { isPaused: nextPaused });
    });

    // Round Switchers
    async function switchRound(roundKey, roundTitle) {
        socket.emit('teacher_change_round', { roundType: roundKey });
        try {
            await fetch(`/api/competitions/${competitionCode}/change-round`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roundType: roundKey })
            });
        } catch (e) {}
        showToast(`Switched to ${roundTitle}! 20 fresh questions loaded.`, 'success');
    }

    btnRound1El.addEventListener('click', () => {
        switchRound('round_1', 'Round 1 — Spell It');
    });

    btnRound2El.addEventListener('click', () => {
        switchRound('round_2', 'Round 2 — Spell & Meaning');
    });

    btnTieBreakerEl.addEventListener('click', () => {
        switchRound('tie_breaker', 'Tie-Breaker Challenge');
    });

    endTieBreakerBtnEl.addEventListener('click', () => {
        openScoreboard();
    });

    if (resetGridBtnEl) {
        resetGridBtnEl.addEventListener('click', () => {
            socket.emit('teacher_reset_grid');
            showToast('🎲 Question grid reset with 20 fresh words!', 'success');
        });
    }

    // Add Student Modal Handlers
    addStudentBtnEl.addEventListener('click', () => {
        newStudentInputEl.value = '';
        addStudentModalEl.classList.add('active');
        newStudentInputEl.focus();
    });

    cancelStudentBtnEl.addEventListener('click', () => {
        addStudentModalEl.classList.remove('active');
    });

    saveStudentBtnEl.addEventListener('click', () => {
        const name = newStudentInputEl.value.trim();
        if (name) {
            socket.emit('teacher_add_student', { name });
            addStudentModalEl.classList.remove('active');
        }
    });

    // Excel Word Bank Upload Modal
    openExcelModalBtnEl.addEventListener('click', () => {
        uploadExcelModalEl.classList.add('active');
    });

    cancelExcelBtnEl.addEventListener('click', () => {
        uploadExcelModalEl.classList.remove('active');
    });

    uploadExcelBtnEl.addEventListener('click', async () => {
        const file = excelFileInputEl.files[0];
        if (!file) {
            alert('Please select an Excel (.xlsx, .xls) file first.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            uploadExcelBtnEl.disabled = true;
            uploadExcelBtnEl.textContent = 'Uploading...';
            const res = await fetch(`/api/competitions/${competitionCode}/upload-words`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Success! Word bank updated with ${data.count} words.`, 'success');
                uploadExcelModalEl.classList.remove('active');
            } else {
                alert(`Upload failed: ${data.error}`);
            }
        } catch (err) {
            alert(`Network error: ${err.message}`);
        } finally {
            uploadExcelBtnEl.disabled = false;
            uploadExcelBtnEl.textContent = 'Upload & Refresh Grid';
        }
    });

    // Student Excel Upload Modal Handlers
    function openStudentsModal() {
        if (uploadStudentsModalEl) {
            if (studentsExcelFileInputEl) studentsExcelFileInputEl.value = '';
            uploadStudentsModalEl.classList.add('active');
        }
    }

    function closeStudentsModal() {
        if (uploadStudentsModalEl) {
            uploadStudentsModalEl.classList.remove('active');
        }
    }

    if (openStudentExcelModalBtnEl) openStudentExcelModalBtnEl.addEventListener('click', openStudentsModal);
    if (importStudentsExcelBtnEl) importStudentsExcelBtnEl.addEventListener('click', openStudentsModal);
    if (closeStudentsModalBtnEl) closeStudentsModalBtnEl.addEventListener('click', closeStudentsModal);
    if (cancelStudentsExcelBtnEl) cancelStudentsExcelBtnEl.addEventListener('click', closeStudentsModal);

    if (uploadStudentsExcelSubmitBtnEl) {
        uploadStudentsExcelSubmitBtnEl.addEventListener('click', async () => {
            const file = studentsExcelFileInputEl?.files?.[0];
            if (!file) {
                showToast('Please choose an Excel file (.xlsx / .xls / .csv) first', 'warning');
                return;
            }

            const importModeEl = document.querySelector('input[name="studentImportMode"]:checked');
            const replaceExisting = importModeEl ? importModeEl.value === 'replace' : false;

            const formData = new FormData();
            formData.append('file', file);
            formData.append('replaceExisting', replaceExisting);

            try {
                uploadStudentsExcelSubmitBtnEl.disabled = true;
                uploadStudentsExcelSubmitBtnEl.textContent = 'Importing...';

                const res = await fetch(`/api/competitions/${competitionCode}/upload-students`, {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (data.success) {
                    showToast(`Success! Imported ${data.count} student(s). Total: ${data.totalStudents}`, 'success');
                    closeStudentsModal();
                } else {
                    showToast(`Import failed: ${data.error}`, 'danger');
                }
            } catch (err) {
                showToast(`Network error: ${err.message}`, 'danger');
            } finally {
                uploadStudentsExcelSubmitBtnEl.disabled = false;
                uploadStudentsExcelSubmitBtnEl.textContent = 'Import Students';
            }
        });
    }

    // Scoreboard Modal
    function openScoreboard() {
        if (!currentGameState) return;
        scoreboardListEl.innerHTML = '';

        // Sort students by total score descending
        const sorted = [...(currentGameState.students || [])].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        sorted.forEach((s, idx) => {
            const item = document.createElement('div');
            item.className = `leaderboard-item ${s.id === currentGameState.currentStudentId ? 'active' : ''}`;
            item.innerHTML = `
                <div class="item-rank-name">
                    <span style="color:var(--accent-gold); font-family:var(--font-mono); font-size:1.3rem;">#${idx + 1}</span>
                    <span style="font-size:1.2rem;">${s.name}</span>
                </div>
                <div style="display:flex; align-items:center; gap:1.5rem;">
                    <span style="color:#94a3b8; font-size:0.85rem;">R1: ${s.scoreR1 || 0} | R2: ${s.scoreR2 || 0} | TB: ${s.scoreTB || 0}</span>
                    <span class="item-score">${s.totalScore || 0} pts</span>
                </div>
            `;
            scoreboardListEl.appendChild(item);
        });

        scoreboardModalEl.classList.add('active');
    }

    openScoreboardBtnEl.addEventListener('click', openScoreboard);
    closeScoreboardBtnEl.addEventListener('click', () => {
        scoreboardModalEl.classList.remove('active');
    });

    if (broadcastScoreboardBtnEl) {
        broadcastScoreboardBtnEl.addEventListener('click', () => {
            socket.emit('teacher_show_scoreboard');
            showToast('Scoreboard broadcast to display', 'info');
        });
    }

    if (dismissScoreboardBtnEl) {
        dismissScoreboardBtnEl.addEventListener('click', () => {
            socket.emit('teacher_dismiss_scoreboard');
            scoreboardModalEl.classList.remove('active');
            showToast('Scoreboard dismissed', 'info');
        });
    }

    // Questions Per Student Setting
    setQuestionsPerStudentBtnEl.addEventListener('click', () => {
        const count = parseInt(questionsPerStudentInputEl.value, 10);
        if (isNaN(count) || count < 1 || count > 20) {
            showToast('Please enter a number between 1 and 20', 'warning');
            return;
        }
        socket.emit('teacher_set_questions_per_student', { count });
        showToast(`Questions per student set to ${count}`, 'success');
    });

    // Toggle Leaderboard Panel
    let leaderboardExpanded = true;
    toggleLeaderboardBtnEl.addEventListener('click', () => {
        leaderboardExpanded = !leaderboardExpanded;
        if (controlLeaderboardListEl) {
            controlLeaderboardListEl.style.display = leaderboardExpanded ? 'flex' : 'none';
        }
        toggleLeaderboardBtnEl.textContent = leaderboardExpanded ? '▼ Collapse' : '▲ Expand';
    });

    // Audio File Upload
    uploadAudioBtnEl.addEventListener('click', async () => {
        const files = audioFileInputEl.files;
        if (!files || files.length === 0) {
            showToast('Please select audio file(s) first', 'warning');
            return;
        }

        const formData = new FormData();
        for (const file of files) {
            formData.append('audios', file);
        }

        try {
            uploadAudioBtnEl.disabled = true;
            uploadAudioBtnEl.textContent = 'Uploading...';
            const res = await fetch(`/api/competitions/${competitionCode}/upload-audio-bulk`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Successfully uploaded ${data.count} audio file(s)`, 'success');
                audioFileInputEl.value = '';
            } else {
                showToast(`Upload failed: ${data.error}`, 'danger');
            }
        } catch (err) {
            showToast(`Network error: ${err.message}`, 'danger');
        } finally {
            uploadAudioBtnEl.disabled = false;
            uploadAudioBtnEl.textContent = 'Upload Audio(s)';
        }
    });

    // Competition Reset Modal
    if (resetCompetitionBtnEl) {
        resetCompetitionBtnEl.addEventListener('click', () => {
            if (resetConfirmModalEl) {
                resetConfirmModalEl.classList.add('active');
            }
        });
    }

    if (cancelResetBtnEl) {
        cancelResetBtnEl.addEventListener('click', () => {
            if (resetConfirmModalEl) {
                resetConfirmModalEl.classList.remove('active');
            }
        });
    }

    if (confirmResetBtnEl) {
        confirmResetBtnEl.addEventListener('click', async () => {
            confirmResetBtnEl.disabled = true;
            confirmResetBtnEl.textContent = 'Resetting...';
            try {
                // 1. Emit socket reset event
                socket.emit('teacher_reset_all');
                // 2. Also call API endpoint for guaranteed execution
                await fetch(`/api/competitions/${competitionCode}/reset`, { method: 'POST' }).catch(() => {});
                showToast('Competition has been completely reset!', 'success');
            } catch (err) {
                console.error('Reset error:', err);
                showToast('Reset failed: ' + err.message, 'danger');
            } finally {
                confirmResetBtnEl.disabled = false;
                confirmResetBtnEl.textContent = 'Yes, Reset Everything';
                if (resetConfirmModalEl) {
                    resetConfirmModalEl.classList.remove('active');
                }
            }
        });
    }

    // Toast Utility
    function showToast(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }
});
