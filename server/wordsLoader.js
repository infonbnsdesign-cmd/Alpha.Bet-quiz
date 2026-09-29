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

    get20Questions(seedOffset = 0, excludeWords = []) {
        const available = this.words.filter(w => !excludeWords.includes(w.word.toLowerCase()));
        const pool = available.length >= 20 ? available : this.words;
        
        // Fisher-Yates shuffle for truly fresh and unpredictable question generation
        const copy = [...pool];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        const selected = copy.slice(0, 20);

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
}

module.exports = new WordsLoader();
