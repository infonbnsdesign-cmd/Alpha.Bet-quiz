const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

class WordsLoader {
    constructor() {
        this.words = [];
        this.loadDefaultWords();
    }

    loadDefaultWords() {
        try {
            const jsonPath = path.join(__dirname, '../data/default_words.json');
            if (fs.existsSync(jsonPath)) {
                const raw = fs.readFileSync(jsonPath, 'utf8');
                this.words = JSON.parse(raw);
                console.log(`[WordsLoader] Loaded ${this.words.length} default words from JSON.`);
                return;
            }
        } catch (e) {
            console.error('[WordsLoader] Error loading default_words.json:', e);
        }

        // Fallback words if file is missing
        this.words = [
            { word: "Beautiful", meaning: "pleasing the senses or mind aesthetically" },
            { word: "Abundance", meaning: "a very large quantity of something" },
            { word: "Courage", meaning: "the ability to do something that frightens one" },
            { word: "Knowledge", meaning: "facts, information, and skills acquired through experience" },
            { word: "Victory", meaning: "an act of defeating an enemy or opponent in a competition" }
        ];
    }

    clearWords() {
        this.words = [];
        const jsonPath = path.join(__dirname, '../data/default_words.json');
        try {
            fs.writeFileSync(jsonPath, JSON.stringify([], null, 2), 'utf8');
        } catch (e) {
            console.error('[WordsLoader] Error clearing default_words.json:', e);
        }
        console.log('[WordsLoader] Cleared all words from database.');
        return { success: true };
    }

    get20Questions(seedOffset = 0, excludeWords = []) {
        if (!this.words || this.words.length === 0) {
            return Array.from({ length: 20 }, (_, index) => {
                const num = index + 1;
                const pad = num < 10 ? `0${num}` : `${num}`;
                return {
                    id: `q_${num}_${Date.now()}`,
                    boxNo: num,
                    boxLabel: pad,
                    word: `Word ${num}`,
                    meaning: `Please upload word bank in Control Panel`,
                    audioFile: `word_${num}.mp3`
                };
            });
        }

        const available = this.words.filter(w => !excludeWords.includes(w.word.toLowerCase()));
        const pool = available.length >= 20 ? available : this.words;
        
        // Fisher-Yates shuffle for truly fresh and unpredictable question generation
        const copy = [...pool];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        
        const selected = [];
        for (let i = 0; i < 20; i++) {
            selected.push(copy[i % copy.length]);
        }

        return selected.map((item, index) => {
            const num = index + 1;
            const pad = num < 10 ? `0${num}` : `${num}`;
            return {
                id: `q_${num}_${Date.now()}`,
                boxNo: num,
                boxLabel: pad,
                word: item.word,
                meaning: item.meaning || '',
                audioFile: `${item.word.toLowerCase()}.mp3`
            };
        });
    }

    parseExcel(buffer) {
        try {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = xlsx.utils.sheet_to_json(worksheet);

            const parsed = [];
            for (const row of rows) {
                const word = row['Words'] || row['words'] || row['Word'] || row['word'] || row['WORD'];
                const meaning = row['Meanings'] || row['meanings'] || row['Meaning'] || row['meaning'] || row['MEANING'] || '';
                if (word && String(word).trim()) {
                    parsed.push({
                        word: String(word).trim(),
                        meaning: String(meaning).trim()
                    });
                }
            }

            if (parsed.length > 0) {
                this.words = parsed;
                const jsonPath = path.join(__dirname, '../data/default_words.json');
                fs.writeFileSync(jsonPath, JSON.stringify(this.words, null, 2), 'utf8');
                console.log(`[WordsLoader] Successfully updated word bank with ${parsed.length} custom words.`);
                return { success: true, count: parsed.length };
            }
            return { success: false, error: 'No valid word rows found in sheet.' };
        } catch (err) {
            console.error('[WordsLoader] Error parsing Excel:', err);
            return { success: false, error: err.message };
        }
    }

    parseStudentsExcel(buffer) {
        try {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Method 1: Check object rows with column headers
            const objRows = xlsx.utils.sheet_to_json(worksheet);
            const names = [];
            const headerKeywords = ['name', 'student', 'participant', 'candidate'];
            
            if (objRows.length > 0) {
                for (const row of objRows) {
                    let foundName = null;
                    for (const key of Object.keys(row)) {
                        if (headerKeywords.some(kw => key.toLowerCase().includes(kw))) {
                            const val = String(row[key]).trim();
                            if (val && isNaN(val)) {
                                foundName = val;
                                break;
                            }
                        }
                    }
                    if (!foundName) {
                        for (const key of Object.keys(row)) {
                            const val = String(row[key]).trim();
                            if (val && isNaN(val) && val.length > 1) {
                                foundName = val;
                                break;
                            }
                        }
                    }
                    if (foundName && !names.includes(foundName)) {
                        names.push(foundName);
                    }
                }
            }

            // Method 2: Raw 2D array parsing fallback (for single-column or unheadered sheets)
            if (names.length === 0) {
                const rawRows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
                const skipKeywords = ['student name', 'name', 'student', 'students', 'participant', 'participants', 's.no', 'sno', 'no', '#', 'sl no', 'serial no'];
                for (const row of rawRows) {
                    if (!Array.isArray(row)) continue;
                    for (const cell of row) {
                        if (cell !== undefined && cell !== null) {
                            const val = String(cell).trim();
                            if (val && !skipKeywords.includes(val.toLowerCase()) && isNaN(val) && val.length > 1) {
                                if (!names.includes(val)) {
                                    names.push(val);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            if (names.length > 0) {
                return { success: true, count: names.length, names };
            }
            return { success: false, error: 'No valid student names found in the Excel sheet.' };
        } catch (err) {
            console.error('[WordsLoader] Error parsing Students Excel:', err);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new WordsLoader();
