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

// Public assets
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// --- AUDIO SERVING ---
// 1. External audio library (Alpha.bet face 2)
const externalAudioPath = path.resolve(__dirname, '../../Alpha.bet face 2/audio');
if (fs.existsSync(externalAudioPath)) {
    console.log(`[Server] Found external audio library at ${externalAudioPath}`);
    app.use('/audio', express.static(externalAudioPath));
}
// 2. Local uploaded audio (takes priority via Express order)
const uploadedAudioPath = path.join(publicPath, 'audio/uploaded');
fs.mkdirSync(uploadedAudioPath, { recursive: true });
app.use('/audio/uploaded', express.static(uploadedAudioPath));

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
    if (!code) {
        return res.status(400).send('Competition code required');
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
            return res.json({ success: true });
        }
        return res.status(404).json({ success: false, error: 'File not found.' });
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
            // Auto-trigger full-screen scoreboard if limit reached
            if (result.scoreboardTriggered) {
                const currentStudent = comp.state.students.find(s => s.id === comp.state.currentStudentId);
                io.to(`comp_${comp.code}`).emit('show_scoreboard', {
                    students: currentStudent ? [currentStudent] : [],
                    currentStudentId: comp.state.currentStudentId,
                    round: comp.state.currentRound,
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
        comp.dismissScoreboard();
        broadcastState(comp);
    });

    socket.on('teacher_show_scoreboard', () => {
        const comp = getComp();
        if (!comp) return;
        comp.showScoreboard();
        broadcastState(comp);
        const currentStudent = comp.state.students.find(s => s.id === comp.state.currentStudentId);
        io.to(`comp_${comp.code}`).emit('show_scoreboard', {
            students: currentStudent ? [currentStudent] : [],
            currentStudentId: comp.state.currentStudentId,
            round: comp.state.currentRound
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