const fs = require('fs');
const path = require('path');
const wordsLoader = require('./wordsLoader');

const STATE_FILE = path.join(__dirname, '../data/saved_state.json');

class GameState {
    constructor() {
        this.state = this.getInitialState();
        this.loadSavedState();
    }

    getInitialState() {
        const questions = wordsLoader.get20Questions();
        const gridState = {};
        questions.forEach(q => {
            gridState[q.boxNo] = 'available';
        });

        return {
            competitionName: "ALPHA.bet 2026 Competition",
            isPaused: false,
            isScoreboardVisible: false,   // Full-screen scoreboard flag
            currentRound: "ROUND 1 — SPELL IT",
            roundKey: "round_1",
            students: [
                { id: "s1", name: "Student 1", scoreR1: 0, scoreR2: 0, scoreTB: 0, totalScore: 0, questionsCompleted: 0 },
                { id: "s2", name: "Student 2", scoreR1: 0, scoreR2: 0, scoreTB: 0, totalScore: 0, questionsCompleted: 0 }
            ],
            currentStudentId: "s1",
            questions: questions,
            gridState: gridState,
            usedWords: [],
            activeQuestion: null,
            lastResult: null,
            roundSettings: {
                questionsPerStudent: 5   // <-- Configurable, default 5
            }
        };
    }

    loadSavedState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = fs.readFileSync(STATE_FILE, 'utf8');
                const parsed = JSON.parse(data);
                if (parsed && parsed.questions && parsed.gridState) {
                    // Migrate: ensure new fields exist
                    if (parsed.isScoreboardVisible === undefined) parsed.isScoreboardVisible = false;
                    if (!parsed.roundSettings) parsed.roundSettings = { questionsPerStudent: 5 };
                    this.state = parsed;
                    console.log('[GameState] Restored existing competition state from disk.');
                    return;
                }
            }
        } catch (e) {
            console.warn('[GameState] Could not load saved state, using clean initial state:', e.message);
        }
        this.saveState();
    }

    saveState() {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (e) {
            console.error('[GameState] Error saving state:', e);
        }
    }

    getState(role = 'display') {
        const currentStudent = this.state.students.find(s => s.id === this.state.currentStudentId) || this.state.students[0];

        let safeActiveQuestion = null;
        if (this.state.activeQuestion) {
            if (role === 'control') {
                safeActiveQuestion = { ...this.state.activeQuestion };
            } else if (role === 'student') {
                safeActiveQuestion = {
                    boxNo: this.state.activeQuestion.boxNo,
                    boxLabel: this.state.activeQuestion.boxLabel,
                    status: this.state.activeQuestion.status,
                    studentAnswer: this.state.activeQuestion.studentAnswer,
                    hasAudioPlayed: this.state.activeQuestion.hasAudioPlayed || false
                };
            } else {
                safeActiveQuestion = {
                    boxNo: this.state.activeQuestion.boxNo,
                    boxLabel: this.state.activeQuestion.boxLabel,
                    status: this.state.activeQuestion.status,
                    revealedWord: this.state.activeQuestion.status === 'confirmed' ? this.state.activeQuestion.word : null
                };
            }
        }

        return {
            competitionName: this.state.competitionName,
            isPaused: this.state.isPaused,
            isScoreboardVisible: this.state.isScoreboardVisible,
            currentRound: this.state.currentRound,
            roundKey: this.state.roundKey,
            students: this.state.students,
            currentStudent: currentStudent,
            currentStudentId: this.state.currentStudentId,
            gridState: this.state.gridState,
            activeQuestion: safeActiveQuestion,
            lastResult: this.state.lastResult,
            roundSettings: this.state.roundSettings,
            totalQuestions: 20
        };
    }

    // 1. STUDENT ONLY: Select question from 20-box grid
    selectQuestion(boxNo) {
        if (this.state.isPaused) {
            return { success: false, error: "Competition is currently paused." };
        }
        if (this.state.isScoreboardVisible) {
            return { success: false, error: "Scoreboard is active. Wait for the teacher to continue." };
        }
        if (this.state.activeQuestion) {
            return { success: false, error: "A question is already active. Complete it before choosing another." };
        }
        const boxNumber = parseInt(boxNo, 10);
        if (boxNumber < 1 || boxNumber > 20) {
            return { success: false, error: "Invalid question box number." };
        }
        if (this.state.gridState[boxNumber] === 'used') {
            return { success: false, error: `Question ${boxNumber} is already used and locked.` };
        }

        const q = this.state.questions.find(item => item.boxNo === boxNumber);
        if (!q) {
            return { success: false, error: `Question ${boxNumber} not found.` };
        }

        this.state.gridState[boxNumber] = 'active';
        this.state.activeQuestion = {
            boxNo: q.boxNo,
            boxLabel: q.boxLabel,
            word: q.word,
            meaning: q.meaning,
            audioFile: q.audioFile,
            status: 'active',
            studentAnswer: '',
            autoResult: null,
            manualOverride: null,
            meaningResult: null,
            hasAudioPlayed: false,
            timestamp: Date.now()
        };

        this.saveState();
        return { success: true };
    }

    // 2. TEACHER ONLY: Trigger audio playback
    playAudio() {
        if (!this.state.activeQuestion) {
            return { success: false, error: "No active question." };
        }
        this.state.activeQuestion.hasAudioPlayed = true;
        this.saveState();
        return {
            success: true,
            word: this.state.activeQuestion.word,
            audioFile: this.state.activeQuestion.audioFile
        };
    }

    // 3. STUDENT ONLY: Submit spelling
    submitStudentAnswer(answer) {
        if (!this.state.activeQuestion) {
            return { success: false, error: "No active question." };
        }
        const cleanedAnswer = (answer || '').trim();
        const correctWord = this.state.activeQuestion.word.trim();
        const isCorrect = cleanedAnswer.toLowerCase() === correctWord.toLowerCase();

        this.state.activeQuestion.studentAnswer = cleanedAnswer;
        this.state.activeQuestion.autoResult = isCorrect ? 'correct' : 'incorrect';
        this.state.activeQuestion.status = 'submitted';

        this.saveState();
        return { success: true, autoResult: this.state.activeQuestion.autoResult };
    }

    // 4. TEACHER ONLY: Override automatic check result
    overrideResult(newResult) {
        if (!this.state.activeQuestion) return { success: false };
        if (newResult === 'correct' || newResult === 'incorrect') {
            this.state.activeQuestion.manualOverride = newResult;
        } else {
            const currentEffective = this.state.activeQuestion.manualOverride || this.state.activeQuestion.autoResult;
            this.state.activeQuestion.manualOverride = currentEffective === 'correct' ? 'incorrect' : 'correct';
        }
        this.saveState();
        return { success: true, manualOverride: this.state.activeQuestion.manualOverride };
    }

    // 5. TEACHER ONLY: Mark meaning result for Round 2
    markMeaning(result) {
        if (!this.state.activeQuestion) return { success: false };
        this.state.activeQuestion.meaningResult = result;
        this.saveState();
        return { success: true, meaningResult: result };
    }

    // 6. TEACHER ONLY: Confirm result, update scores, set question USED
    // Returns { success, lastResult, scoreboardTriggered }
    confirmAndFinishQuestion() {
        if (!this.state.activeQuestion) {
            return { success: false, error: "No active question." };
        }

        const q = this.state.activeQuestion;
        const boxNo = q.boxNo;
        const effectiveSpellingResult = q.manualOverride || q.autoResult || 'incorrect';
        const isSpellingCorrect = effectiveSpellingResult === 'correct';

        let points = 0;
        let meaningCorrect = false;

        if (this.state.roundKey === 'round_1') {
            points = isSpellingCorrect ? 1 : 0;
        } else if (this.state.roundKey === 'round_2') {
            meaningCorrect = q.meaningResult === 'correct';
            points = (isSpellingCorrect ? 1 : 0) + (meaningCorrect ? 1 : 0);
        } else {
            points = isSpellingCorrect ? 1 : 0;
        }

        const student = this.state.students.find(s => s.id === this.state.currentStudentId);
        if (student) {
            if (this.state.roundKey === 'round_1') {
                student.scoreR1 = (student.scoreR1 || 0) + points;
            } else if (this.state.roundKey === 'round_2') {
                student.scoreR2 = (student.scoreR2 || 0) + points;
            } else {
                student.scoreTB = (student.scoreTB || 0) + points;
            }
            student.totalScore = (student.scoreR1 || 0) + (student.scoreR2 || 0) + (student.scoreTB || 0);
            student.questionsCompleted = (student.questionsCompleted || 0) + 1;
        }

        this.state.gridState[boxNo] = 'used';
        if (!this.state.usedWords.includes(q.word.toLowerCase())) {
            this.state.usedWords.push(q.word.toLowerCase());
        }

        this.state.lastResult = {
            boxNo: boxNo,
            boxLabel: q.boxLabel,
            word: q.word,
            studentAnswer: q.studentAnswer,
            isSpellingCorrect: isSpellingCorrect,
            meaningCorrect: meaningCorrect,
            points: points,
            studentName: student ? student.name : "Student",
            timestamp: Date.now()
        };

        this.state.activeQuestion = null;

        // --- AUTO SCOREBOARD CHECK ---
        // After questionsPerStudent questions → show full-screen scoreboard
        const questionsPerStudent = this.state.roundSettings.questionsPerStudent || 5;
        let scoreboardTriggered = false;
        if (student && student.questionsCompleted >= questionsPerStudent) {
            this.state.isScoreboardVisible = true;
            scoreboardTriggered = true;
        }

        this.saveState();
        return { success: true, lastResult: this.state.lastResult, scoreboardTriggered };
    }

    // 7. TEACHER ONLY: Dismiss scoreboard and continue
    dismissScoreboard() {
        this.state.isScoreboardVisible = false;
        // Reset current student's questionsCompleted for next turn
        const student = this.state.students.find(s => s.id === this.state.currentStudentId);
        if (student) student.questionsCompleted = 0;
        this.saveState();
        return { success: true };
    }

    // 8. TEACHER ONLY: Show scoreboard manually
    showScoreboard() {
        this.state.isScoreboardVisible = true;
        this.saveState();
        return { success: true };
    }

    // 9. Update questionsPerStudent setting
    setQuestionsPerStudent(count) {
        const n = parseInt(count, 10);
        if (isNaN(n) || n < 1 || n > 20) {
            return { success: false, error: 'Must be between 1 and 20.' };
        }
        this.state.roundSettings.questionsPerStudent = n;
        this.saveState();
        return { success: true, questionsPerStudent: n };
    }

    // 10. TEACHER ONLY: Student management
    setCurrentStudent(studentId) {
        const student = this.state.students.find(s => s.id === studentId);
        if (student) {
            this.state.currentStudentId = studentId;
            this.saveState();
            return { success: true };
        }
        return { success: false, error: "Student not found" };
    }

    addStudent(name) {
        if (!name || !name.trim()) return { success: false };
        const id = `s_${Date.now()}`;
        const newStudent = {
            id: id,
            name: name.trim(),
            scoreR1: 0,
            scoreR2: 0,
            scoreTB: 0,
            totalScore: 0,
            questionsCompleted: 0
        };
        this.state.students.push(newStudent);
        this.state.currentStudentId = id;
        this.saveState();
        return { success: true, student: newStudent };
    }

    changeRound(roundType) {
        let roundKey = 'round_1';
        let roundTitle = 'ROUND 1 — SPELL IT';

        if (roundType === 'round_2' || roundType === 'ROUND 2 — SPELL & MEANING') {
            roundKey = 'round_2';
            roundTitle = 'ROUND 2 — SPELL & MEANING';
        } else if (roundType === 'tie_breaker' || roundType === 'TIE-BREAKER') {
            roundKey = 'tie_breaker';
            roundTitle = 'TIE-BREAKER CHALLENGE';
        }

        this.state.roundKey = roundKey;
        this.state.currentRound = roundTitle;
        this.state.isScoreboardVisible = false;

        const freshQuestions = wordsLoader.get20Questions(0, this.state.usedWords);
        this.state.questions = freshQuestions;
        const cleanGrid = {};
        freshQuestions.forEach(q => { cleanGrid[q.boxNo] = 'available'; });
        this.state.gridState = cleanGrid;
        this.state.activeQuestion = null;

        this.state.students.forEach(s => { s.questionsCompleted = 0; });

        this.saveState();
        return { success: true };
    }

    setPaused(isPaused) {
        this.state.isPaused = !!isPaused;
        this.saveState();
        return { success: true, isPaused: this.state.isPaused };
    }

    resetGrid() {
        const freshQuestions = wordsLoader.get20Questions(0, this.state.usedWords);
        this.state.questions = freshQuestions;
        const cleanGrid = {};
        freshQuestions.forEach(q => { cleanGrid[q.boxNo] = 'available'; });
        this.state.gridState = cleanGrid;
        this.state.activeQuestion = null;
        this.state.isScoreboardVisible = false;
        this.saveState();
        return { success: true };
    }

    // Full reset: all scores, all state, fresh word pool
    resetEntireCompetition() {
        const savedQuestionsPerStudent = this.state.roundSettings?.questionsPerStudent || 5;
        this.state = this.getInitialState();
        this.state.roundSettings.questionsPerStudent = savedQuestionsPerStudent; // keep setting
        this.saveState();
        return { success: true };
    }

    // Delete ALL audio files in public/audio (only uploaded ones)
    clearUploadedAudio() {
        const audioDir = path.join(__dirname, '../public/audio/uploaded');
        if (fs.existsSync(audioDir)) {
            const files = fs.readdirSync(audioDir);
            files.forEach(f => {
                try { fs.unlinkSync(path.join(audioDir, f)); } catch (e) {}
            });
        }
        return { success: true };
    }
}

module.exports = new GameState();
