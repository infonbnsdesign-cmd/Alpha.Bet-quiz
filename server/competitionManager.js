const fs = require('fs');
const path = require('path');
const GameState = require('./gameState');

const COMPETITIONS_DIR = path.join(__dirname, '../data/competitions');

class CompetitionManager {
    constructor() {
        this.competitions = new Map();
        this.ensureCompetitionsDir();
        this.loadAllCompetitions();
    }

    ensureCompetitionsDir() {
        if (!fs.existsSync(COMPETITIONS_DIR)) {
            fs.mkdirSync(COMPETITIONS_DIR, { recursive: true });
        }
    }

    loadAllCompetitions() {
        try {
            const files = fs.readdirSync(COMPETITIONS_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const code = file.replace('.json', '');
                    if (!this.competitions.has(code)) {
                        const comp = new Competition(code);
                        this.competitions.set(code, comp);
                    }
                }
            }
            console.log(`[CompetitionManager] Loaded ${this.competitions.size} competitions from disk.`);
        } catch (e) {
            console.warn('[CompetitionManager] Could not load competitions from disk:', e.message);
        }
    }

    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    getCompetition(code) {
        if (!this.competitions.has(code)) {
            const comp = new Competition(code);
            this.competitions.set(code, comp);
        }
        return this.competitions.get(code);
    }

    createCompetition(customCode = null) {
        const code = customCode || this.generateCode();
        if (this.competitions.has(code)) {
            return { success: false, error: 'Code already exists' };
        }
        const comp = new Competition(code);
        this.competitions.set(code, comp);
        return { success: true, code, competition: comp };
    }

    deleteCompetition(code) {
        const comp = this.competitions.get(code);
        if (comp) {
            comp.destroy();
            this.competitions.delete(code);
            return { success: true };
        }
        return { success: false, error: 'Competition not found' };
    }

    listCompetitions() {
        return Array.from(this.competitions.entries()).map(([code, comp]) => ({
            code,
            name: comp.state.competitionName,
            round: comp.state.currentRound,
            students: comp.state.students.length,
            createdAt: comp.createdAt
        }));
    }
}

class Competition {
    constructor(code) {
        this.code = code;
        this.stateFile = path.join(COMPETITIONS_DIR, `${code}.json`);
        this.createdAt = Date.now();
        this.state = this.getInitialState();
        this.loadState();
    }

    getInitialState() {
        const wordsLoader = require('./wordsLoader');
        const questions = wordsLoader.get20Questions();
        const gridState = {};
        questions.forEach(q => {
            gridState[q.boxNo] = 'available';
        });

        return {
            competitionName: `ALPHA.bet 2026 - ${this.code}`,
            competitionCode: this.code,
            isPaused: false,
            isScoreboardVisible: false,
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
                questionsPerStudent: 5,
                studentTypingEnabled: true
            }
        };
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const data = fs.readFileSync(this.stateFile, 'utf8');
                const parsed = JSON.parse(data);
                if (parsed && parsed.questions && parsed.gridState) {
                    if (parsed.isScoreboardVisible === undefined) parsed.isScoreboardVisible = false;
                    if (!parsed.roundSettings) parsed.roundSettings = { questionsPerStudent: 5, studentTypingEnabled: true };
                    if (parsed.roundSettings.studentTypingEnabled === undefined) parsed.roundSettings.studentTypingEnabled = true;
                    this.state = parsed;
                    console.log(`[Competition ${this.code}] Restored state from disk.`);
                    return;
                }
            }
        } catch (e) {
            console.warn(`[Competition ${this.code}] Could not load saved state:`, e.message);
        }
        this.saveState();
    }

    saveState() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (e) {
            console.error(`[Competition ${this.code}] Error saving state:`, e);
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
            competitionCode: this.state.competitionCode,
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

    markMeaning(result) {
        if (!this.state.activeQuestion) return { success: false };
        this.state.activeQuestion.meaningResult = result;
        this.saveState();
        return { success: true, meaningResult: result };
    }

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

        const questionsPerStudent = this.state.roundSettings.questionsPerStudent || 5;
        let scoreboardTriggered = false;
        if (student && student.questionsCompleted >= questionsPerStudent) {
            this.state.isScoreboardVisible = true;
            scoreboardTriggered = true;
        }

        this.saveState();
        return { success: true, lastResult: this.state.lastResult, scoreboardTriggered };
    }

    dismissScoreboard() {
        this.state.isScoreboardVisible = false;
        const student = this.state.students.find(s => s.id === this.state.currentStudentId);
        if (student) student.questionsCompleted = 0;
        this.saveState();
        return { success: true };
    }

    showScoreboard() {
        this.state.isScoreboardVisible = true;
        this.saveState();
        return { success: true };
    }

    setQuestionsPerStudent(count) {
        const n = parseInt(count, 10);
        if (isNaN(n) || n < 1 || n > 20) {
            return { success: false, error: 'Must be between 1 and 20.' };
        }
        this.state.roundSettings.questionsPerStudent = n;
        this.saveState();
        return { success: true, questionsPerStudent: n };
    }

    setStudentTyping(enabled) {
        if (!this.state.roundSettings) this.state.roundSettings = {};
        this.state.roundSettings.studentTypingEnabled = !!enabled;
        this.saveState();
        return { success: true, studentTypingEnabled: this.state.roundSettings.studentTypingEnabled };
    }

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

    importStudents(namesList, replaceExisting = false) {
        if (!Array.isArray(namesList) || namesList.length === 0) {
            return { success: false, error: 'No student names provided.' };
        }

        const newStudents = namesList.map((name, index) => ({
            id: `s_${Date.now()}_${index}`,
            name: name.trim(),
            scoreR1: 0,
            scoreR2: 0,
            scoreTB: 0,
            totalScore: 0,
            questionsCompleted: 0
        }));

        if (replaceExisting) {
            this.state.students = newStudents;
        } else {
            const existingNames = this.state.students.map(s => s.name.toLowerCase());
            for (const s of newStudents) {
                if (!existingNames.includes(s.name.toLowerCase())) {
                    this.state.students.push(s);
                    existingNames.push(s.name.toLowerCase());
                }
            }
        }

        if (this.state.students.length > 0) {
            const exists = this.state.students.some(s => s.id === this.state.currentStudentId);
            if (!exists) {
                this.state.currentStudentId = this.state.students[0].id;
            }
        }

        this.saveState();
        return { success: true, count: this.state.students.length };
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

        const wordsLoader = require('./wordsLoader');
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
        const wordsLoader = require('./wordsLoader');
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

    resetEntireCompetition() {
        const savedQuestionsPerStudent = this.state.roundSettings?.questionsPerStudent || 5;
        const savedTyping = this.state.roundSettings?.studentTypingEnabled !== undefined ? this.state.roundSettings.studentTypingEnabled : true;
        this.state = this.getInitialState();
        this.state.roundSettings.questionsPerStudent = savedQuestionsPerStudent;
        this.state.roundSettings.studentTypingEnabled = savedTyping;
        this.saveState();
        return { success: true };
    }

    clearAllWords() {
        const wordsLoader = require('./wordsLoader');
        wordsLoader.clearWords();
        this.state.questions = wordsLoader.get20Questions();
        this.state.gridState = {};
        this.state.questions.forEach(q => {
            this.state.gridState[q.boxNo] = 'available';
        });
        this.state.usedWords = [];
        this.state.activeQuestion = null;
        this.saveState();
        return { success: true };
    }

    destroy() {
        try {
            if (fs.existsSync(this.stateFile)) {
                fs.unlinkSync(this.stateFile);
            }
        } catch (e) {}
    }
}

module.exports = new CompetitionManager();