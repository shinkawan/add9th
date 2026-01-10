/**
 * Cyber-Deck OS v1.0.84
 * Core Audio Engine
 */

class CyberDeckPlayer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.audioElement = document.getElementById('audio-player');
        this.visualizerCanvas = document.getElementById('visualizer');
        this.canvasCtx = this.visualizerCanvas.getContext('2d');

        this.playPauseBtn = document.getElementById('play-pause');
        this.volumeSlider = document.getElementById('volume');
        this.lofiSlider = document.getElementById('lofi');

        this.isPlaying = false;
        this.lofiNode = null;
        this.noiseNode = null;

        // Long press handling
        this.pressTimer = null;
        this.seekInterval = null;
        this.isSeeking = false;
        this.pressThreshold = 300; // ms

        // DB setup
        this.dbName = "CyberDeckDB";
        this.dbVersion = 1;
        this.db = null;

        // Initial demo playlist (Hardcoded assets)
        this.playlist = [
            { name: "初恋", artist: "LOCAL_TAPE", url: "hatsukoi.mp3" },
            { name: "お菓子な恋人", artist: "LOCAL_TAPE", url: "okashina_koibito.mp3" },
            { name: "火星人の唄", artist: "LOCAL_TAPE", url: "kaseijin_no_uta.mp3" }
        ];
        this.currentTrackIndex = 0;

        this.init();
    }

    async init() {
        // Initialize DB and load saved tapes
        await this.initDB();
        await this.loadPersistedTapes();

        this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.volumeSlider.addEventListener('input', (e) => {
            this.audioElement.volume = e.target.value;
        });

        // Error handling for audio element
        this.audioElement.addEventListener('error', (e) => {
            const error = this.audioElement.error;
            let msg = "LOAD ERROR";
            if (error) {
                switch (error.code) {
                    case 1: msg = "ABORTED"; break;
                    case 2: msg = "NETWORK ERROR"; break;
                    case 3: msg = "DECODE ERROR"; break;
                    case 4: msg = "SRC NOT SUPPORTED"; break;
                }
            }
            console.error("Audio Error:", msg, error);
            const trackEl = document.getElementById('track-name');
            trackEl.textContent = msg + ": " + (this.playlist[this.currentTrackIndex]?.name || "UNKNOWN");
        });

        // File loading logic
        const loadTapeBtn = document.getElementById('load-tape');
        const fileInput = document.getElementById('file-input');

        loadTapeBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        const nextBtn = document.getElementById('next');
        const prevBtn = document.getElementById('prev');

        nextBtn.addEventListener('pointerdown', (e) => this.handlePressStart(e, 1));
        nextBtn.addEventListener('pointerup', (e) => this.handlePressEnd(e, 1));
        nextBtn.addEventListener('pointerleave', (e) => this.handlePressEnd(e, 1));

        prevBtn.addEventListener('pointerdown', (e) => this.handlePressStart(e, -1));
        prevBtn.addEventListener('pointerup', (e) => this.handlePressEnd(e, -1));
        prevBtn.addEventListener('pointerleave', (e) => this.handlePressEnd(e, -1));

        // Handle window resize for visualizer
        window.addEventListener('resize', () => this.resizeCanvas());
        this.resizeCanvas();

        this.loadTrack(0);
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("tapes")) {
                    db.createObjectStore("tapes", { keyPath: "id", autoIncrement: true });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e);
        });
    }

    async loadPersistedTapes() {
        if (!this.db) return;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(["tapes"], "readonly");
            const store = transaction.objectStore("tapes");
            const request = store.getAll();

            request.onsuccess = (e) => {
                const tapes = e.target.result;
                tapes.forEach(tape => {
                    // Create URL from stored Blob
                    const url = URL.createObjectURL(tape.blob);
                    this.playlist.push({
                        name: tape.name,
                        artist: "USER_IMPORT",
                        url: url,
                        isPersisted: true
                    });
                });
                console.log(`LOADED ${tapes.length} PERSISTED TAPES`);
                resolve();
            };
        });
    }

    async saveTapeToDB(name, blob) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["tapes"], "readwrite");
            const store = transaction.objectStore("tapes");
            const request = store.add({ name, blob, timestamp: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject();
        });
    }

    resizeCanvas() {
        this.visualizerCanvas.width = this.visualizerCanvas.clientWidth;
        this.visualizerCanvas.height = this.visualizerCanvas.clientHeight;
    }

    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.setupNodes();
        }
    }

    setupNodes() {
        this.source = this.audioContext.createMediaElementSource(this.audioElement);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;

        // Lo-fi Filter (Lowpass)
        this.lofiNode = this.audioContext.createBiquadFilter();
        this.lofiNode.type = 'lowpass';
        this.lofiNode.frequency.value = 20000;

        // White Noise Generation (Tape Hiss)
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        this.noiseSource = this.audioContext.createBufferSource();
        this.noiseSource.buffer = noiseBuffer;
        this.noiseSource.loop = true;

        this.noiseGain = this.audioContext.createGain();
        this.noiseGain.gain.value = 0;

        this.noiseSource.connect(this.noiseGain);
        this.noiseGain.connect(this.analyser);

        // Connect nodes
        this.source.connect(this.lofiNode);
        this.lofiNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        this.noiseSource.start();
        this.setupLofiListener();
        this.draw();
    }

    setupLofiListener() {
        this.lofiSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            // Lowpass frequency
            const freq = 20000 - (val * 19200);
            this.lofiNode.frequency.setTargetAtTime(freq, this.audioContext.currentTime, 0.1);

            // Tape hiss gain
            this.noiseGain.gain.setTargetAtTime(val * 0.05, this.audioContext.currentTime, 0.1);
        });
    }

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const name = file.name.replace(/\.[^/.]+$/, "").toUpperCase();

        try {
            // Save to IndexedDB for persistence
            await this.saveTapeToDB(name, file);

            const url = URL.createObjectURL(file);
            const newTrack = { name: name, artist: "USER_IMPORT", url: url };

            this.playlist.push(newTrack);
            this.loadTrack(this.playlist.length - 1);
            this.currentTrackIndex = this.playlist.length - 1;

            if (!this.isPlaying) this.togglePlay();
            console.log("TAPE PERSISTED TO SYSTEM STORAGE");
        } catch (err) {
            console.error("Save Error:", err);
            alert("STORAGE FULL OR ERROR: COULD NOT PERSIST TAPE");
        }
    }

    nextTrack() {
        if (this.playlist.length === 0) return;
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        this.loadTrack(this.currentTrackIndex);
        if (this.isPlaying) this.audioElement.play();
    }

    prevTrack() {
        if (this.playlist.length === 0) return;
        this.currentTrackIndex = (this.currentTrackIndex - 1 + this.playlist.length) % this.playlist.length;
        this.loadTrack(this.currentTrackIndex);
        if (this.isPlaying) this.audioElement.play();
    }

    handlePressStart(e, direction) {
        e.preventDefault();
        this.pressTimer = setTimeout(() => {
            this.startSeeking(direction);
        }, this.pressThreshold);
    }

    handlePressEnd(e, direction) {
        e.preventDefault();
        if (this.pressTimer) {
            clearTimeout(this.pressTimer);
            this.pressTimer = null;
        }

        if (this.isSeeking) {
            this.stopSeeking();
        } else if (e.type === 'pointerup') {
            // It was a short press
            if (direction === 1) this.nextTrack();
            else this.prevTrack();
        }
    }

    startSeeking(direction) {
        if (this.playlist.length === 0) return;
        this.isSeeking = true;
        this.initAudioContext();

        const trackEl = document.getElementById('track-name');
        const originalText = this.playlist[this.currentTrackIndex].name;

        if (direction === 1) {
            // Fast Forward
            trackEl.textContent = ">> FAST_FORWARD >>";
            this.audioElement.playbackRate = 3.0;
            if (this.audioElement.paused) this.audioElement.play();
        } else {
            // Rewind
            trackEl.textContent = "<< REWINDING <<";
            this.audioElement.playbackRate = 1.0;
            this.audioElement.muted = true; // Mute during rewind to avoid glitchy sound

            this.seekInterval = setInterval(() => {
                this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 0.5);
                if (this.audioElement.currentTime === 0) {
                    this.stopSeeking();
                }
            }, 50);
        }

        document.querySelector('.cassette-body').classList.add('playing');
        document.querySelector('.cassette-body').style.animationDuration = direction === 1 ? '0.2s' : '0.2s';
    }

    stopSeeking() {
        this.isSeeking = false;
        if (this.seekInterval) {
            clearInterval(this.seekInterval);
            this.seekInterval = null;
        }

        this.audioElement.playbackRate = 1.0;
        this.audioElement.muted = false;

        const track = this.playlist[this.currentTrackIndex];
        this.updateDisplay(track);

        if (!this.isPlaying) {
            this.audioElement.pause();
            document.querySelector('.cassette-body').classList.remove('playing');
        }
        document.querySelector('.cassette-body').style.animationDuration = '';
    }

    loadTrack(index) {
        if (index < 0 || index >= this.playlist.length) return;
        const track = this.playlist[index];
        console.log("Loading track:", track.name, "URL:", track.url.substring(0, 30) + "...");
        this.audioElement.src = track.url;
        this.updateDisplay(track);
    }

    updateDisplay(track = null) {
        const trackEl = document.getElementById('track-name');
        const artistEl = document.getElementById('artist-name');

        if (track) {
            trackEl.textContent = track.name;
            artistEl.textContent = track.artist;
        } else {
            trackEl.textContent = "NO TAPE INSERTED";
            artistEl.textContent = "WAITING FOR INPUT...";
        }
    }

    togglePlay() {
        if (this.playlist.length === 0) {
            alert("INSERT TAPE FIRST");
            return;
        }
        this.initAudioContext();

        if (this.isPlaying) {
            this.audioElement.pause();
            this.playPauseBtn.textContent = '▶';
            document.querySelector('.cassette-body').classList.remove('playing');
        } else {
            this.audioContext.resume();
            this.audioElement.play();
            this.playPauseBtn.textContent = '||';
            document.querySelector('.cassette-body').classList.add('playing');
        }
        this.isPlaying = !this.isPlaying;
    }

    draw() {
        requestAnimationFrame(() => this.draw());

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        const width = this.visualizerCanvas.width;
        const height = this.visualizerCanvas.height;

        this.canvasCtx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            // Neon gradient
            const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, '#ff00ff');
            gradient.addColorStop(1, '#00f3ff');

            this.canvasCtx.fillStyle = gradient;
            this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);

            // Glow effect
            this.canvasCtx.shadowBlur = 10;
            this.canvasCtx.shadowColor = '#00f3ff';

            x += barWidth + 1;
        }
    }
}

// Initial boot sequence
window.addEventListener('load', () => {
    console.log("CYBER-DECK OS LOADED...");
    new CyberDeckPlayer();
});
