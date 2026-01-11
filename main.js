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

        // iOS background audio workaround components
        this.iosSilentAudio = null;
        this.iosStreamDest = null;

        // DB setup
        this.dbName = "CyberDeckDB";
        this.dbVersion = 1;
        this.db = null;

        // Initial demo playlist (Hardcoded assets)
        this.playlist = [
            { name: "初恋", artist: "DEMO_TAPE", url: "hatsukoi.mp3" },
            { name: "お菓子な恋人", artist: "DEMO_TAPE", url: "okashina_koibito.mp3" },
            { name: "火星人の唄", artist: "DEMO_TAPE", url: "kaseijin_no_uta.mp3" }
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
            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(e.target.value, this.audioContext.currentTime, 0.1);
            }
        });

        // Error handling for audio element
        this.audioElement.addEventListener('error', (e) => {
            const error = this.audioElement.error;
            let msg = "LOAD ERROR";
            if (error) {
                switch (error.code) {
                    case 1: msg = "中断"; break;
                    case 2: msg = "通信エラー"; break;
                    case 3: msg = "変換エラー"; break;
                    case 4: msg = "未対応形式"; break;
                }
            }
            console.error("Audio Error:", msg, error);
            const trackEl = document.getElementById('track-name');
            trackEl.textContent = msg + ": " + (this.playlist[this.currentTrackIndex]?.name || "UNKNOWN");
        });

        // State Synchronization
        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true;
            this.playPauseBtn.textContent = '||';
            document.querySelector('.cassette-body').classList.add('playing');
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
        });

        this.audioElement.addEventListener('pause', () => {
            this.isPlaying = false;
            this.playPauseBtn.textContent = '▶';
            document.querySelector('.cassette-body').classList.remove('playing');
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
        });

        this.audioElement.addEventListener('ended', () => {
            this.nextTrack(true);
        });

        // File loading logic
        const loadTapeBtn = document.getElementById('load-tape');
        const deleteTapeBtn = document.getElementById('delete-tape');
        const fileInput = document.getElementById('file-input');

        loadTapeBtn.addEventListener('click', () => fileInput.click());
        deleteTapeBtn.addEventListener('click', () => this.deleteCurrentTrack());
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

        // AudioContext state monitoring for resume (iOS safety)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.audioContext && this.audioContext.state === 'interrupted') {
                this.audioContext.resume();
            }
        });

        this.setupMediaSession();
        this.loadTrack(0);

        // Global interaction listener for iOS safety
        const pokeAudio = () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            if (this.isIOS() && this.iosSilentAudio && this.isPlaying && this.iosSilentAudio.paused) {
                this.iosSilentAudio.play().catch(() => { });
            }
        };
        document.addEventListener('click', pokeAudio);
        document.addEventListener('touchstart', pokeAudio);

        // PWA Setup
        this.registerServiceWorker();
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
                        isPersisted: true,
                        id: tape.id
                    });
                });
                console.log(`LOADED ${tapes.length} PERSISTED TAPES`);
                resolve();
            };
        });
    }

    async deleteTapeFromDB(id) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["tapes"], "readwrite");
            const store = transaction.objectStore("tapes");
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

    async deleteCurrentTrack() {
        if (this.currentTrackIndex < 0 || this.currentTrackIndex >= this.playlist.length) return;

        const track = this.playlist[this.currentTrackIndex];

        // Only allow deleting persisted tracks (USER_IMPORT)
        if (!track.isPersisted || !track.id) {
            alert("システムテープは削除できません（保護）");
            return;
        }

        if (!confirm(`テープを削除しますか？: ${track.name}`)) return;

        try {
            await this.deleteTapeFromDB(track.id);

            // Remove from playlist
            this.playlist.splice(this.currentTrackIndex, 1);

            // Adjust index if necessary
            if (this.currentTrackIndex >= this.playlist.length) {
                this.currentTrackIndex = 0;
            }

            // Load new track or empty state
            if (this.playlist.length > 0) {
                this.loadTrack(this.currentTrackIndex);
                if (this.isPlaying) this.audioElement.play();
            } else {
                this.audioElement.pause();
                this.updateDisplay(null);
            }

            console.log("TAPE DELETED");
        } catch (err) {
            console.error("Delete Error:", err);
            alert("ERROR DELETING TAPE");
        }
    }

    async saveTapeToDB(name, blob) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["tapes"], "readwrite");
            const store = transaction.objectStore("tapes");
            const request = store.add({ name, blob, timestamp: Date.now() });
            request.onsuccess = (e) => resolve(e.target.result);
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
        // Create Master Gain for global volume control
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.volumeSlider.value; // Initialize with slider value

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

        // Connect noise graph (Noise -> Gain -> Analyser -> Master -> Dest)
        this.noiseSource.connect(this.noiseGain);
        this.noiseGain.connect(this.analyser);

        // Connect music graph
        this.source.connect(this.lofiNode);
        this.lofiNode.connect(this.analyser);

        // Connect final output to Master Gain then Destination
        this.analyser.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);

        // iOS Background Audio Hack: Route through MediaStream to a sacrificial audio element
        if (this.isIOS()) {
            this.setupIOSBackgroundAudio();
        }

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
            const id = await this.saveTapeToDB(name, file);

            const url = URL.createObjectURL(file);
            const newTrack = { name: name, artist: "USER_IMPORT", url: url, isPersisted: true, id: id };

            this.playlist.push(newTrack);
            this.loadTrack(this.playlist.length - 1);
            this.currentTrackIndex = this.playlist.length - 1;

            if (!this.isPlaying) this.togglePlay();
            console.log("TAPE PERSISTED TO SYSTEM STORAGE");
        } catch (err) {
            console.error("Save Error:", err);
            alert("容量不足またはエラー：保存できませんでした");
        }
    }

    nextTrack(forcePlay = false) {
        if (this.playlist.length === 0) return;
        const wasPlaying = forcePlay || !this.audioElement.paused;
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        this.loadTrack(this.currentTrackIndex);
        if (wasPlaying) {
            this.audioElement.play().catch(e => console.error("Auto-play failed:", e));
        }
    }

    prevTrack() {
        if (this.playlist.length === 0) return;
        const wasPlaying = !this.audioElement.paused;
        this.currentTrackIndex = (this.currentTrackIndex - 1 + this.playlist.length) % this.playlist.length;
        this.loadTrack(this.currentTrackIndex);
        if (wasPlaying) {
            this.audioElement.play().catch(e => console.error("Auto-play failed:", e));
        }
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
            trackEl.textContent = ">> 早送り中 >>";
            this.audioElement.playbackRate = 3.0;
            if (this.audioElement.paused) this.audioElement.play();
        } else {
            // Rewind
            trackEl.textContent = "<< 巻き戻し中 <<";
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
        this.updateMediaSessionMetadata(track);
    }

    updateDisplay(track = null) {
        const trackEl = document.getElementById('track-name');
        const artistEl = document.getElementById('artist-name');

        if (track) {
            trackEl.textContent = track.name;
            artistEl.textContent = track.artist;
        } else {
            trackEl.textContent = "テープ未挿入";
            artistEl.textContent = "入力を待機中...";
        }
    }

    togglePlay() {
        if (this.playlist.length === 0) {
            alert("テープを挿入してください");
            return;
        }
        this.initAudioContext();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        if (this.audioElement.paused) {
            this.audioElement.play().catch(e => console.error("Playback failed:", e));
            if (this.isIOS() && this.iosSilentAudio) {
                this.iosSilentAudio.play().catch(e => console.error("iOS Silent Audio failed:", e));
            }
        } else {
            this.audioElement.pause();
            if (this.isIOS() && this.iosSilentAudio) {
                this.iosSilentAudio.pause();
            }
        }
    }

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                this.audioElement.play();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.audioElement.pause();
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
            navigator.mediaSession.setActionHandler('seekbackward', () => {
                this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 10);
            });
            navigator.mediaSession.setActionHandler('seekforward', () => {
                this.audioElement.currentTime = Math.min(this.audioElement.duration, this.audioElement.currentTime + 10);
            });
        }
    }

    updateMediaSessionMetadata(track) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.name,
                artist: track.artist,
                artwork: [
                    { src: 'logo.png', sizes: '96x96', type: 'image/png' },
                    { src: 'logo.png', sizes: '128x128', type: 'image/png' },
                    { src: 'logo.png', sizes: '192x192', type: 'image/png' },
                    { src: 'logo.png', sizes: '256x256', type: 'image/png' },
                    { src: 'logo.png', sizes: '384x384', type: 'image/png' },
                    { src: 'logo.png', sizes: '512x512', type: 'image/png' },
                ]
            });
        }
    }

    draw() {
        requestAnimationFrame(() => this.draw());

        if (!this.analyser) return;

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

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW REGISTERED', reg.scope))
                    .catch(err => console.log('SW REGISTRATION FAILED', err));
            });
        }
    }

    // iOS Specific Background Audio Workaround
    setupIOSBackgroundAudio() {
        try {
            this.iosStreamDest = this.audioContext.createMediaStreamDestination();
            this.masterGain.connect(this.iosStreamDest);

            // Create hidden audio element to "consume" the stream and keep AC alive
            this.iosSilentAudio = document.createElement('audio');
            this.iosSilentAudio.style.display = 'none';
            document.body.appendChild(this.iosSilentAudio);

            this.iosSilentAudio.srcObject = this.iosStreamDest.stream;

            console.log("iOS BACKGROUND AUDIO PAYLOAD ARMED");
        } catch (e) {
            console.error("iOS Audio Hack Failed:", e);
        }
    }

    isIOS() {
        return [
            'iPad Simulator', 'iPhone Simulator', 'iPod Simulator',
            'iPad', 'iPhone', 'iPod'
        ].includes(navigator.platform)
            || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    }
}

// Initial boot sequence
window.addEventListener('load', () => {
    console.log("CYBER-DECK OS LOADED...");
    window.player = new CyberDeckPlayer();
});
