const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const competitionManager = require('./competitionManager');
const wordsLoader = require('./wordsLoader');

const app = express();
app.use(cors());
app.use(express.json());

// Public assets — with caching for static files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

// --- AUDIO SERVING & LOOKUP (CACHED FOR SPEED) ---
const externalAudioPath = path.resolve(__dirname, '../../Alpha.bet face 2/audio');
const uploadedAudioPath = path.join(publicPath, 'audio/uploaded');
fs.mkdirSync(uploadedAudioPath, { recursive: true });

const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];

// ========== IN-MEMORY AUDIO CACHE ==========
// Maps normalized word name -> absolute file path
// Built once at startup, refreshed only on upload/delete
let audioCache = new Map();

function buildAudioCache() {
    const startTime = Date.now();
    const newCache = new Map();
    const searchDirs = [
        uploadedAudioPath,                    // highest priority
        path.join(publicPath, 'audio'),       // local audio folder
        externalAudioPath                      // external audio bank
    ];

    // Scan in REVERSE priority order so higher-priority dirs overwrite
    for (let i = searchDirs.length - 1; i >= 0; i--) {
        const dir = searchDirs[i];
        if (!dir || !fs.existsSync(dir)) continue;
        try {
            scanDirRecursive(dir, newCache);
        } catch (e) {
            console.warn(`[AudioCache] Error scanning ${dir}:`, e.message);
        }
    }

    audioCache = newCache;
    console.log(`[AudioCache] Built cache with ${audioCache.size} audio files in ${Date.now() - startTime}ms`);
}

function scanDirRecursive(dir, cache) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanDirRecursive(fullPath, cache);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (AUDIO_EXTS.includes(ext)) {
                const normalizedName = path.basename(entry.name, ext)
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, '_');
                cache.set(normalizedName, fullPath);
            }
        }
    }
}

// Build cache once at startup
buildAudioCache();

// Fast cached lookup — O(1) Map lookup instead of scanning thousands of files
function findAudioFileForWord(word) {
    if (!word) return null;
    const clean = String(word).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return audioCache.get(clean) || null;
}

// Rebuild cache after uploads/deletes
function refreshAudioCache() {
    buildAudioCache();
}

// API: Audio lookup — now instant via cache
app.get('/api/audio-lookup/:word', (req, res) => {
    const word = req.params.word;
    const filePath = findAudioFileForWord(word);
    if (filePath && fs.existsSync(filePath)) {
        res.set({
            'Cache-Control': 'public, max-age=86400',
            'X-Audio-Source': 'cached-lookup'
        });
        return res.sendFile(filePath);
    }
    return res.status(404).send('Audio not found');
});

// Serve direct /audio/:filename requests with cached fallback
app.get('/audio/:filename', (req, res, next) => {
    const rawName = req.params.filename;
    const wordName = path.basename(rawName, path.extname(rawName));
    const filePath = findAudioFileForWord(wordName);
    if (filePath && fs.existsSync(filePath)) {
        res.set({ 'Cache-Control': 'public, max-age=86400' });
        return res.sendFile(filePath);
    }
    next();
});

app.use('/audio/uploaded', express.static(uploadedAudioPath, { maxAge: '1d' }));
if (fs.existsSync(externalAudioPath)) {
    app.use('/audio', express.static(externalAudioPath, { maxAge: '1d' }));
}

// --- MULTER CONFIGS ---
// Word bank Excel upload (memory)
const excelUpload = multer({ storage: multer.memoryStorage() });

// Audio file upload (saved to public/audio/uploaded/<word>.mp3)
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadedAudioPath);
    },
    filename: (req, file, cb) => {
        // Sanitise filename: lowercase, strip non-word chars
        const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
        const base = path.basename(file.originalname, path.extname(file.originalname))
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_');
        cb(null, base + ext);
    }
});
const audioUpload = multer({
    storage: audioStorage,
    fileFilter: (req, file, cb) => {
        const ok = /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.originalname);
        cb(ok ? null : new Error('Only audio files are allowed.'), ok);
    },
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// --- COMPETITION CODE ROUTES ---
// All panel routes now require a competition code
function requireCompetition(req, res, next) {
    const code = req.params.code;
    if (!code || code.includes('.') || !/^[A-Za-z0-9_-]+$/.test(code)) {
        return res.status(404).send('Invalid or missing competition code');
    }
    req.competition = competitionManager.getCompetition(code.toUpperCase());
    next();
}

// Landing page - create/join competition
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Create new competition
app.post('/api/competitions', (req, res) => {
    const customCode = req.body?.code?.toUpperCase();
    const result = competitionManager.createCompetition(customCode);
    if (result.success) {
        res.json(result);
    } else {
        res.status(400).json(result);
    }
});

// List all competitions
app.get('/api/competitions', (req, res) => {
    res.json({ competitions: competitionManager.listCompetitions() });
});

// Delete competition
app.delete('/api/competitions/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    const result = competitionManager.deleteCompetition(code);
    if (result.success) {
        // Notify all clients in this competition
        io.to(`comp_${code}`).emit('competition_reset');
    }
    res.json(result);
});

// Get competition info
app.get('/api/competitions/:code', requireCompetition, (req, res) => {
    res.json({ success: true, competition: req.competition.getState('control') });
});

// Panel routes with competition code
app.get('/student/:code', requireCompetition, (req, res) => res.sendFile(path.join(publicPath, 'student.html')));
app.get('/control/:code', requireCompetition, (req, res) => res.sendFile(path.join(publicPath, 'control.html')));
app.get('/display/:code', requireCompetition, (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/split/:code', requireCompetition, (req, res) => res.sendFile(path.join(publicPath, 'split.html')));

// API: Upload custom Excel word bank
app.post('/api/competitions/:code/upload-words', requireCompetition, excelUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
    const result = wordsLoader.parseExcel(req.file.buffer);
    if (result.success) {
        req.competition.resetGrid();
        broadcastState(req.competition);
        return res.json({ success: true, count: result.count });
    }
    return res.status(400).json({ success: false, error: result.error });
});

// API: Clear all words from database
app.post('/api/competitions/:code/clear-words', requireCompetition, (req, res) => {
    req.competition.clearAllWords();
    broadcastState(req.competition);
    return res.json({ 
        success: true, 
        message: 'All words have been cleared. You can now upload fresh new words.' 
    });
});

// API: Upload custom Excel student list
app.post('/api/competitions/:code/upload-students', requireCompetition, excelUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
    const replaceExisting = req.body.replaceExisting === 'true' || req.body.replaceExisting === true;
    const result = wordsLoader.parseStudentsExcel(req.file.buffer);
    if (result.success) {
        req.competition.importStudents(result.names, replaceExisting);
        broadcastState(req.competition);
        return res.json({ 
            success: true, 
            count: result.count, 
            totalStudents: req.competition.state.students.length 
        });
    }
    return res.status(400).json({ success: false, error: result.error });
});

// API: Upload a single audio file for a specific word
app.post('/api/competitions/:code/upload-audio', requireCompetition, audioUpload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file uploaded.' });
    const finalPath = `/audio/uploaded/${req.file.filename}`;
    console.log(`[Audio] Competition ${req.competition.code}: Uploaded ${req.file.filename} → ${finalPath}`);
    refreshAudioCache();
    return res.json({
        success: true,
        filename: req.file.filename,
        url: finalPath,
        word: path.basename(req.file.filename, path.extname(req.file.filename))
    });
});

// API: Upload multiple audio files at once
app.post('/api/competitions/:code/upload-audio-bulk', requireCompetition, audioUpload.array('audios', 50), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'No audio files uploaded.' });
    }
    const uploaded = req.files.map(f => ({
        filename: f.filename,
        url: `/audio/uploaded/${f.filename}`,
        word: path.basename(f.filename, path.extname(f.filename))
    }));
    console.log(`[Audio] Competition ${req.competition.code}: Bulk uploaded ${uploaded.length} audio files.`);
    refreshAudioCache();
    return res.json({ success: true, count: uploaded.length, files: uploaded });
});

// API: List uploaded audio files
app.get('/api/competitions/:code/audio-files', requireCompetition, (req, res) => {
    try {
        const files = fs.readdirSync(uploadedAudioPath)
            .filter(f => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f))
            .map(f => ({
                filename: f,
                word: path.basename(f, path.extname(f)),
                url: `/audio/uploaded/${f}`
            }));
        res.json({ success: true, files });
    } catch (e) {
        res.json({ success: true, files: [] });
    }
});

// API: Delete specific uploaded audio file
app.delete('/api/competitions/:code/audio-files/:filename', requireCompetition, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadedAudioPath, filename);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            refreshAudioCache();
            return res.json({ success: true });
        }
        return res.status(404).json({ success: false, error: 'File not found.' });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// API: Clear ALL uploaded audio files
app.post('/api/competitions/:code/clear-uploaded-audio', requireCompetition, (req, res) => {
    try {
        const files = fs.readdirSync(uploadedAudioPath);
        let deleted = 0;
        for (const f of files) {
            const ext = path.extname(f).toLowerCase();
            if (AUDIO_EXTS.includes(ext)) {
                try {
                    fs.unlinkSync(path.join(uploadedAudioPath, f));
                    deleted++;
                } catch (e) {}
            }
        }
        refreshAudioCache();
        console.log(`[Audio] Competition ${req.competition.code}: Cleared ${deleted} uploaded audio files.`);
        return res.json({ success: true, deleted });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// API: Reset entire competition
app.post('/api/competitions/:code/reset', requireCompetition, (req, res) => {
    console.log(`[API] Competition ${req.competition.code}: Full competition reset requested`);
    req.competition.resetEntireCompetition();
    broadcastState(req.competition);
    io.to(`comp_${req.competition.code}`).emit('competition_reset');
    res.json({ success: true });
});

// API: Change round
app.post('/api/competitions/:code/change-round', requireCompetition, (req, res) => {
    const roundType = req.body?.roundType || 'round_1';
    console.log(`[API] Competition ${req.competition.code}: Change round requested to: ${roundType}`);
    const result = req.competition.changeRound(roundType);
    if (result.success) {
        broadcastState(req.competition);
        io.to(`comp_${req.competition.code}`).emit('play_sound', { sound: 'round_change' });
        res.json({ success: true, round: req.competition.state.currentRound });
    } else {
        res.status(400).json({ success: false, error: result.error });
    }
});

// --- SOCKET.IO ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

function broadcastState(competition) {
    const code = competition.code;
    io.to(`comp_${code}_control`).emit('state_update', competition.getState('control'));
    io.to(`comp_${code}_student`).emit('state_update', competition.getState('student'));
    io.to(`comp_${code}_display`).emit('state_update', competition.getState('display'));
    io.to(`comp_${code}_generic`).emit('state_update', competition.getState('display'));
}

io.on('connection', (socket) => {
    let clientRole = 'generic';
    let competitionCode = null;

    socket.on('register_role', ({ role, code }) => {
        clientRole = role || 'generic';
        competitionCode = code?.toUpperCase();
        
        if (!competitionCode) {
            socket.emit('action_error', { message: 'Competition code required' });
            return;
        }

        const competition = competitionManager.getCompetition(competitionCode);
        
        // Join competition-specific rooms
        socket.join(`comp_${competitionCode}`);
        socket.join(`comp_${competitionCode}_${clientRole}`);
        
        console.log(`[Socket] ${socket.id} joined competition ${competitionCode} as ${clientRole}`);
        socket.emit('state_update', competition.getState(clientRole));
    });

    // Helper to get competition for this socket
    function getComp() {
        if (!competitionCode) return null;
        return competitionManager.getCompetition(competitionCode);
    }

    // ---- STUDENT ACTIONS ----
    socket.on('student_select_question', ({ boxNo }) => {
        const comp = getComp();
        if (!comp) return socket.emit('action_error', { message: 'Invalid competition' });
        
        console.log(`[Action] Competition ${comp.code}: Student selecting question box #${boxNo}`);
        const result = comp.selectQuestion(boxNo);
        if (result.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'select', boxNo });
        } else {
            socket.emit('action_error', { message: result.error });
        }
    });

    socket.on('student_submit_answer', ({ answer }) => {
        const comp = getComp();
        if (!comp) return socket.emit('action_error', { message: 'Invalid competition' });
        
        console.log(`[Action] Competition ${comp.code}: Student submitted answer: "${answer}"`);
        const result = comp.submitStudentAnswer(answer);
        if (result.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'submit' });
        } else {
            socket.emit('action_error', { message: result.error });
        }
    });

    // ---- TEACHER ACTIONS ----
    socket.on('teacher_play_audio', () => {
        const comp = getComp();
        if (!comp) return;
        
        const result = comp.playAudio();
        if (result.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('audio_trigger', {
                word: result.word,
                audioFile: result.audioFile
            });
        }
    });

    // Student requests audio replay (after teacher has played it at least once)
    socket.on('student_request_audio', () => {
        const comp = getComp();
        if (!comp) return;
        if (!comp.state.activeQuestion || !comp.state.activeQuestion.hasAudioPlayed) return;
        // Send audio_trigger only back to this specific student socket
        socket.emit('audio_trigger', {
            word: comp.state.activeQuestion.word,
            audioFile: comp.state.activeQuestion.audioFile
        });
    });

    socket.on('teacher_override_result', ({ newResult }) => {
        const comp = getComp();
        if (!comp) return;
        const result = comp.overrideResult(newResult);
        if (result.success) broadcastState(comp);
    });

    socket.on('teacher_mark_meaning', ({ result }) => {
        const comp = getComp();
        if (!comp) return;
        const res = comp.markMeaning(result);
        if (res.success) broadcastState(comp);
    });

    socket.on('teacher_confirm_question', () => {
        const comp = getComp();
        if (!comp) return;
        
        const result = comp.confirmAndFinishQuestion();
        if (result.success) {
            broadcastState(comp);
            if (result.lastResult) {
                const s = result.lastResult.isSpellingCorrect ? 'correct' : 'wrong';
                io.to(`comp_${comp.code}`).emit('play_sound', { sound: s });
            }
            // Auto-trigger full-screen scoreboard if limit reached (e.g. 5 questions)
            if (result.scoreboardTriggered) {
                console.log(`[Scoreboard] Competition ${comp.code}: Questions limit reached (${comp.state.roundSettings?.questionsPerStudent || 5} questions). Showing scoreboard on student & display panels.`);
                io.to(`comp_${comp.code}`).emit('show_scoreboard', {
                    students: comp.state.students,
                    currentStudentId: comp.state.currentStudentId,
                    round: comp.state.currentRound,
                    isScoreboardVisible: true,
                    autoTriggered: true
                });
                io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'round_change' });
            }
        } else {
            socket.emit('action_error', { message: result.error });
        }
    });

    socket.on('teacher_dismiss_scoreboard', () => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Scoreboard] Competition ${comp.code}: Teacher dismissed scoreboard`);
        comp.dismissScoreboard();
        broadcastState(comp);
        io.to(`comp_${comp.code}`).emit('hide_scoreboard');
    });

    socket.on('teacher_show_scoreboard', () => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Scoreboard] Competition ${comp.code}: Teacher broadcast scoreboard to all panels`);
        comp.showScoreboard();
        broadcastState(comp);
        io.to(`comp_${comp.code}`).emit('show_scoreboard', {
            students: comp.state.students,
            currentStudentId: comp.state.currentStudentId,
            round: comp.state.currentRound,
            isScoreboardVisible: true
        });
    });

    socket.on('teacher_set_questions_per_student', ({ count }) => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Action] Competition ${comp.code}: Teacher set questionsPerStudent: ${count}`);
        const result = comp.setQuestionsPerStudent(count);
        if (result.success) broadcastState(comp);
        else socket.emit('action_error', { message: result.error });
    });

    socket.on('teacher_toggle_student_typing', ({ enabled }) => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Action] Competition ${comp.code}: Teacher set studentTypingEnabled: ${enabled}`);
        comp.setStudentTyping(enabled);
        broadcastState(comp);
    });

    socket.on('teacher_switch_student', ({ studentId }) => {
        const comp = getComp();
        if (!comp) return;
        const res = comp.setCurrentStudent(studentId);
        if (res.success) broadcastState(comp);
    });

    socket.on('teacher_add_student', ({ name }) => {
        const comp = getComp();
        if (!comp) return;
        const res = comp.addStudent(name);
        if (res.success) broadcastState(comp);
    });

    socket.on('teacher_change_round', ({ roundType }) => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Action] Competition ${comp.code}: Teacher changing round to: ${roundType}`);
        const res = comp.changeRound(roundType);
        if (res.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'round_change' });
        }
    });

    socket.on('teacher_set_paused', ({ isPaused }) => {
        const comp = getComp();
        if (!comp) return;
        const res = comp.setPaused(isPaused);
        if (res.success) broadcastState(comp);
    });

    socket.on('teacher_reset_grid', () => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Action] Competition ${comp.code}: Teacher resetting question grid with 20 fresh words`);
        const res = comp.resetGrid();
        if (res.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'round_change' });
        }
    });

    socket.on('teacher_reset_all', () => {
        const comp = getComp();
        if (!comp) return;
        console.log(`[Action] Competition ${comp.code}: FULL COMPETITION RESET & NEW COMPETITION START`);
        const res = comp.resetEntireCompetition();
        if (res.success) {
            broadcastState(comp);
            io.to(`comp_${comp.code}`).emit('competition_reset');
            io.to(`comp_${comp.code}`).emit('play_sound', { sound: 'round_change' });
        }
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`   ALPHA.BET 2026 COMPETITION SERVER ACTIVE      `);
    console.log(`   Local URL:    http://localhost:${PORT}        `);
    console.log(`   Landing:      http://localhost:${PORT}/       `);
    console.log(`   Student:      http://localhost:${PORT}/student/<CODE>`);
    console.log(`   Teacher:      http://localhost:${PORT}/control/<CODE>`);
    console.log(`   Display/OBS:  http://localhost:${PORT}/display/<CODE>`);
    console.log(`   Simulation:   http://localhost:${PORT}/split/<CODE>  `);
    console.log(`=================================================`);
});