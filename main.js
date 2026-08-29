/**
 * Cyber-Deck OS v1.0.94
 * Core Audio Engine & Cyberpunk Deck Controller
 */

class CyberDeckPlayer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.masterGain = null;
        this.bassNode = null;
        this.lofiNode = null;
        this.noiseSource = null;
        this.noiseGain = null;
        this.warbleDelay = null;
        this.warbleLfo = null;
        this.warbleGain = null;

        this.audioElement = document.getElementById('audio-player');
        this.visualizerCanvas = document.getElementById('visualizer');
        this.canvasCtx = this.visualizerCanvas.getContext('2d');

        // DOM elements
        this.playPauseBtn = document.getElementById('play-pause');
        this.prevBtn = document.getElementById('prev');
        this.nextBtn = document.getElementById('next');
        this.volumeSlider = document.getElementById('volume');
        this.bassSlider = document.getElementById('bass');
        this.lofiSlider = document.getElementById('lofi');
        this.warbleSlider = document.getElementById('warble');
        this.seekBar = document.getElementById('seek-bar');
        this.seekProgress = document.getElementById('seek-progress');
        this.currentTimeEl = document.getElementById('current-time');
        this.totalTimeEl = document.getElementById('total-time');
        this.trackNameEl = document.getElementById('track-name');
        this.artistNameEl = document.getElementById('artist-name');
        this.tapeLabelEl = document.getElementById('tape-label');
        this.cassetteBody = document.getElementById('cassette-body');
        this.leftTapePack = document.getElementById('tape-pack-left');
        this.rightTapePack = document.getElementById('tape-pack-right');

        // Visualizer Modes: 'BARS', 'WAVE', 'VU'
        this.visModes = ['BARS', 'WAVE', 'VU'];
        this.currentVisModeIndex = 0;
        this.visModeBtn = document.getElementById('vis-mode-btn');

        // LEDs
        this.powerLed = document.getElementById('power-led');
        this.tapeLed = document.getElementById('tape-led');
        this.stereoLed = document.getElementById('stereo-led');
        this.peakLed = document.getElementById('peak-led');
        this.statusTextEl = document.getElementById('status-text');

        // Modals
        this.tapeRackModal = document.getElementById('tape-rack-modal');
        this.tapeRackBtn = document.getElementById('tape-rack-btn');
        this.rackCloseBtn = document.getElementById('rack-close-btn');
        this.rackBackdrop = document.getElementById('rack-backdrop');
        this.rackListEl = document.getElementById('rack-list');
        this.rackCountEl = document.getElementById('rack-count');
        this.rackImportBtn = document.getElementById('rack-import-btn');

        this.shortcutsModal = document.getElementById('shortcuts-modal');
        this.shortcutsHint = document.getElementById('shortcuts-hint');
        this.shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');
        this.shortcutsBackdrop = document.getElementById('shortcuts-backdrop');

        // Player state
        this.isPlaying = false;
        this.isUserSeeking = false;
        this.isLongPressSeeking = false;
        this.wasPlayingBeforeSeek = false;
        this.pressTimer = null;
        this.seekInterval = null;
        this.pressThreshold = 350; // ms
        this.wakeLock = null;
        this.isMuted = false;
        this.previousVolume = 0.7;

        // DB setup
        this.dbName = "CyberDeckDB";
        this.dbVersion = 1;
        this.db = null;

        // Playlist
        this.playlist = [
            { name: "初恋", artist: "DEMO_TAPE", url: "hatsukoi.m4a", isPersisted: false },
            { name: "お菓子な恋人", artist: "DEMO_TAPE", url: "okashina_koibito.m4a", isPersisted: false },
            { name: "火星人の唄", artist: "DEMO_TAPE", url: "kaseijin_no_uta.m4a", isPersisted: false }
        ];
        this.currentTrackIndex = 0;

        this.init();
    }

    async init() {
        // Set initial volume on audio element
        if (this.volumeSlider) {
            this.audioElement.volume = parseFloat(this.volumeSlider.value);
            this.updateSliderLabel('vol-val', `${Math.round(this.volumeSlider.value * 100)}%`);
        }

        // Initialize DB and load saved tapes
        await this.initDB();
        await this.loadPersistedTapes();

        // Bind main player events
        this.setupAudioListeners();
        this.setupControlListeners();
        this.setupKeyboardShortcuts();
        this.setupModals();
        this.setupMediaSession();

        // Canvas setup
        window.addEventListener('resize', () => this.resizeCanvas());
        this.resizeCanvas();

        // Wake Lock & Visibility
        document.addEventListener('visibilitychange', async () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible' && this.isPlaying) {
                await this.requestWakeLock();
            }
        });

        // Load initial track
        this.loadTrack(0);

        // PWA Setup
        this.registerServiceWorker();

        // Start visualizer animation loop
        this.draw();
    }

    // =========================================================================
    // DATABASE (IndexedDB)
    // =========================================================================
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
                this.renderTapeRack();
                resolve();
            };
            request.onerror = () => resolve();
        });
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

        if (!track.isPersisted || !track.id) {
            this.setStatusMessage("システムテープは保護されています", 3000);
            alert("システムテープは削除できません（保護）");
            return;
        }

        if (!confirm(`テープを削除しますか？\n[${track.name}]`)) return;

        try {
            await this.deleteTapeFromDB(track.id);
            this.playlist.splice(this.currentTrackIndex, 1);

            if (this.currentTrackIndex >= this.playlist.length) {
                this.currentTrackIndex = Math.max(0, this.playlist.length - 1);
            }

            if (this.playlist.length > 0) {
                this.loadTrack(this.currentTrackIndex);
                if (this.isPlaying) this.audioElement.play();
            } else {
                this.audioElement.pause();
                this.updateDisplay(null);
            }

            this.renderTapeRack();
            this.setStatusMessage("テープを削除しました", 3000);
        } catch (err) {
            console.error("Delete Error:", err);
            this.setStatusMessage("削除エラーが発生しました", 3000);
        }
    }

    // =========================================================================
    // AUDIO GRAPH (Web Audio API)
    // =========================================================================
    initAudioContext() {
        if (this.audioContext) return;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
        this.setupAudioNodes();
    }

    setupAudioNodes() {
        // Master Gain
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = parseFloat(this.volumeSlider.value);

        // Media Source
        this.source = this.audioContext.createMediaElementSource(this.audioElement);

        // Analyser
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;

        // 1. Bass Boost Node (Low Shelf Filter)
        this.bassNode = this.audioContext.createBiquadFilter();
        this.bassNode.type = 'lowshelf';
        this.bassNode.frequency.value = 150; // Hz
        this.bassNode.gain.value = parseFloat(this.bassSlider.value);

        // 2. Lo-Fi Lowpass Node
        this.lofiNode = this.audioContext.createBiquadFilter();
        this.lofiNode.type = 'lowpass';
        this.lofiNode.frequency.value = 20000;

        // 3. Tape Warble (Pitch Flutter with Delay & LFO)
        this.warbleDelay = this.audioContext.createDelay(0.1);
        this.warbleDelay.delayTime.value = 0.005; // 5ms baseline

        this.warbleGain = this.audioContext.createGain();
        this.warbleGain.gain.value = 0; // 0 depth by default

        this.warbleLfo = this.audioContext.createOscillator();
        this.warbleLfo.type = 'sine';
        this.warbleLfo.frequency.value = 1.2; // 1.2 Hz wow rate
        this.warbleLfo.connect(this.warbleGain);
        this.warbleGain.connect(this.warbleDelay.delayTime);
        this.warbleLfo.start();

        // 4. Tape Hiss (White Noise Generator)
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
        this.noiseSource.start();

        // Graph Routing:
        // Source -> Bass -> Lo-Fi -> Warble Delay -> Analyser -> Master Gain -> Destination
        this.source.connect(this.bassNode);
        this.bassNode.connect(this.lofiNode);
        this.lofiNode.connect(this.warbleDelay);
        this.warbleDelay.connect(this.analyser);
        this.analyser.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);

        // Setup audio effect slider callbacks
        this.setupEffectListeners();
    }

    setupEffectListeners() {
        // Bass Boost
        this.bassSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.updateSliderLabel('bass-val', `+${val}dB`);
            if (this.bassNode && this.audioContext) {
                this.bassNode.gain.setTargetAtTime(val, this.audioContext.currentTime, 0.05);
            }
        });

        // Lo-Fi Lowpass & Noise
        this.lofiSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.updateSliderLabel('lofi-val', `${Math.round(val * 100)}%`);
            if (this.lofiNode && this.noiseGain && this.audioContext) {
                const freq = 20000 - (val * 19000); // 20kHz down to 1kHz
                this.lofiNode.frequency.setTargetAtTime(freq, this.audioContext.currentTime, 0.05);
                this.noiseGain.gain.setTargetAtTime(val * 0.045, this.audioContext.currentTime, 0.05);
            }
        });

        // Warble (Flutter)
        this.warbleSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.updateSliderLabel('warble-val', `${Math.round(val * 100)}%`);
            if (this.warbleGain && this.audioContext) {
                const depth = val * 0.003; // up to 3ms modulation
                this.warbleGain.gain.setTargetAtTime(depth, this.audioContext.currentTime, 0.05);
            }
        });
    }

    updateSliderLabel(elementId, text) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = text;
    }

    // =========================================================================
    // EVENT LISTENERS & SYNCHRONIZATION
    // =========================================================================
    setupAudioListeners() {
        // Play state sync
        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true;
            this.playPauseBtn.textContent = '||';
            this.cassetteBody.classList.add('playing');
            if (this.stereoLed) this.stereoLed.classList.add('active');
            if (this.tapeLed) this.tapeLed.classList.add('active');
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
            this.requestWakeLock();
            this.setStatusMessage("再生中 // AUDIO_OUTPUT_ACTIVE");
        });

        this.audioElement.addEventListener('pause', () => {
            if (!this.isLongPressSeeking) {
                this.isPlaying = false;
                this.playPauseBtn.textContent = '▶';
                this.cassetteBody.classList.remove('playing');
                if (this.stereoLed) this.stereoLed.classList.remove('active');
                if (this.peakLed) this.peakLed.classList.remove('active');
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
                this.releaseWakeLock();
                this.setStatusMessage("一時停止中 // STANDBY");
            }
        });

        this.audioElement.addEventListener('ended', () => {
            this.nextTrack(true);
        });

        // Time updates & Seek Progress
        this.audioElement.addEventListener('timeupdate', () => {
            const cur = this.audioElement.currentTime;
            const dur = this.audioElement.duration || 0;

            if (this.currentTimeEl) this.currentTimeEl.textContent = this.formatTime(cur);
            if (this.totalTimeEl && dur > 0) this.totalTimeEl.textContent = this.formatTime(dur);

            // Update seek bar if user is not actively dragging it
            if (!this.isUserSeeking && dur > 0) {
                const percent = (cur / dur) * 100;
                if (this.seekBar) this.seekBar.value = percent;
                if (this.seekProgress) this.seekProgress.style.width = `${percent}%`;
            }

            // Update dynamic cassette tape thickness
            this.updateTapeSpools(cur, dur);
        });

        this.audioElement.addEventListener('loadedmetadata', () => {
            const dur = this.audioElement.duration || 0;
            if (this.totalTimeEl) this.totalTimeEl.textContent = this.formatTime(dur);
            if (this.seekBar) this.seekBar.value = 0;
            if (this.seekProgress) this.seekProgress.style.width = '0%';
            this.updateTapeSpools(0, dur);
        });

        // Error handling
        this.audioElement.addEventListener('error', () => {
            const err = this.audioElement.error;
            let msg = "LOAD ERROR";
            if (err) {
                switch (err.code) {
                    case 1: msg = "再生中断"; break;
                    case 2: msg = "通信エラー"; break;
                    case 3: msg = "デコード失敗"; break;
                    case 4: msg = "未対応形式"; break;
                }
            }
            console.error("Audio Error:", msg, err);
            if (this.trackNameEl) {
                this.trackNameEl.textContent = `${msg}: ` + (this.playlist[this.currentTrackIndex]?.name || "UNKNOWN");
            }
            this.setStatusMessage(`エラー: ${msg}`, 4000);
        });
    }

    setupControlListeners() {
        // Play / Pause
        this.playPauseBtn.addEventListener('click', () => this.togglePlay());

        // Volume control with smooth gain sync
        this.volumeSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.audioElement.volume = val;
            this.updateSliderLabel('vol-val', `${Math.round(val * 100)}%`);
            if (this.masterGain && this.audioContext) {
                this.masterGain.gain.setTargetAtTime(val, this.audioContext.currentTime, 0.05);
            }
        });

        // Seek Bar (User Progress Drag & Jump)
        if (this.seekBar) {
            this.seekBar.addEventListener('input', (e) => {
                this.isUserSeeking = true;
                const percent = parseFloat(e.target.value);
                if (this.seekProgress) this.seekProgress.style.width = `${percent}%`;
                const dur = this.audioElement.duration || 0;
                if (dur > 0 && this.currentTimeEl) {
                    const targetTime = (percent / 100) * dur;
                    this.currentTimeEl.textContent = this.formatTime(targetTime);
                }
            });

            this.seekBar.addEventListener('change', (e) => {
                const percent = parseFloat(e.target.value);
                const dur = this.audioElement.duration || 0;
                if (dur > 0) {
                    this.audioElement.currentTime = (percent / 100) * dur;
                }
                this.isUserSeeking = false;
            });
        }

        // File Input & Load Tape
        const loadTapeBtn = document.getElementById('load-tape');
        const deleteTapeBtn = document.getElementById('delete-tape');
        const fileInput = document.getElementById('file-input');

        loadTapeBtn.addEventListener('click', () => fileInput.click());
        deleteTapeBtn.addEventListener('click', () => this.deleteCurrentTrack());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Visualizer Mode Toggle
        if (this.visModeBtn) {
            this.visModeBtn.addEventListener('click', () => this.toggleVisMode());
        }

        // Long Press Seek on Prev / Next Buttons with Pointer Capture
        this.setupLongPressSeek(this.nextBtn, 1);
        this.setupLongPressSeek(this.prevBtn, -1);
    }

    setupLongPressSeek(btn, direction) {
        if (!btn) return;

        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            btn.setPointerCapture(e.pointerId);
            this.pressTimer = setTimeout(() => {
                this.startSeeking(direction);
            }, this.pressThreshold);
        });

        const cancelPress = (e) => {
            if (this.pressTimer) {
                clearTimeout(this.pressTimer);
                this.pressTimer = null;
            }

            if (this.isLongPressSeeking) {
                this.stopSeeking();
            } else if (e.type === 'pointerup') {
                // Regular short press
                if (direction === 1) this.nextTrack();
                else this.prevTrack();
            }
        };

        btn.addEventListener('pointerup', cancelPress);
        btn.addEventListener('pointercancel', cancelPress);
    }

    startSeeking(direction) {
        if (this.playlist.length === 0) return;
        this.isLongPressSeeking = true;
        this.wasPlayingBeforeSeek = !this.audioElement.paused;
        this.initAudioContext();

        const track = this.playlist[this.currentTrackIndex];
        if (!track) return;

        if (direction === 1) {
            // Fast Forward (3x speed)
            this.trackNameEl.textContent = `>> 早送り中 >>`;
            this.audioElement.playbackRate = 3.0;
            if (this.audioElement.paused) this.audioElement.play().catch(() => {});
        } else {
            // Rewind
            this.trackNameEl.textContent = `<< 巻き戻し中 <<`;
            this.audioElement.playbackRate = 1.0;
            this.audioElement.muted = true;

            this.seekInterval = setInterval(() => {
                this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 0.7);
                if (this.audioElement.currentTime === 0) {
                    this.stopSeeking();
                }
            }, 60);
        }

        this.cassetteBody.classList.add('playing');
        this.cassetteBody.style.animationDuration = '0.3s';
        this.setStatusMessage(direction === 1 ? "FAST FORWARD (3X)" : "REWIND ACTIVE");
    }

    stopSeeking() {
        this.isLongPressSeeking = false;
        if (this.seekInterval) {
            clearInterval(this.seekInterval);
            this.seekInterval = null;
        }

        this.audioElement.playbackRate = 1.0;
        this.audioElement.muted = false;

        const track = this.playlist[this.currentTrackIndex];
        this.updateDisplay(track);

        // BUG FIX: Restore previous play/pause state correctly
        if (!this.wasPlayingBeforeSeek) {
            this.audioElement.pause();
            this.isPlaying = false;
            this.playPauseBtn.textContent = '▶';
            this.cassetteBody.classList.remove('playing');
        } else {
            this.isPlaying = true;
            this.playPauseBtn.textContent = '||';
        }

        this.cassetteBody.style.animationDuration = '';
        this.setStatusMessage("システム正常 // リンク完了");
    }

    // =========================================================================
    // VISUALIZER MODES & DRAW LOOP
    // =========================================================================
    toggleVisMode() {
        this.currentVisModeIndex = (this.currentVisModeIndex + 1) % this.visModes.length;
        const mode = this.visModes[this.currentVisModeIndex];
        if (this.visModeBtn) this.visModeBtn.textContent = `VIS: [${mode}]`;
        this.setStatusMessage(`VISUALIZER: ${mode} MODE`, 2000);
    }

    resizeCanvas() {
        if (!this.visualizerCanvas) return;
        this.visualizerCanvas.width = this.visualizerCanvas.clientWidth || 600;
        this.visualizerCanvas.height = this.visualizerCanvas.clientHeight || 180;
    }

    draw() {
        requestAnimationFrame(() => this.draw());

        if (!this.analyser || !this.visualizerCanvas) return;

        const mode = this.visModes[this.currentVisModeIndex];
        const width = this.visualizerCanvas.width;
        const height = this.visualizerCanvas.height;

        this.canvasCtx.clearRect(0, 0, width, height);

        if (mode === 'BARS') {
            this.drawBars(width, height);
        } else if (mode === 'WAVE') {
            this.drawWave(width, height);
        } else if (mode === 'VU') {
            this.drawVU(width, height);
        }
    }

    drawBars(width, height) {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        // Peak detection for PEAK LED
        let maxVal = 0;
        const barWidth = (width / bufferLength) * 2.4;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const val = dataArray[i];
            if (val > maxVal) maxVal = val;

            const barHeight = (val / 255) * height;

            // Cyberpunk Neon Gradient
            const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, '#ff00ff');
            gradient.addColorStop(0.6, '#00f3ff');
            gradient.addColorStop(1, '#ffe600');

            this.canvasCtx.fillStyle = gradient;
            this.canvasCtx.shadowBlur = 8;
            this.canvasCtx.shadowColor = '#00f3ff';

            this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1.5;
        }

        // Flash PEAK LED when near max
        if (this.peakLed) {
            if (maxVal > 235 && this.isPlaying) {
                this.peakLed.classList.add('active');
            } else {
                this.peakLed.classList.remove('active');
            }
        }
    }

    drawWave(width, height) {
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteTimeDomainData(dataArray);

        this.canvasCtx.lineWidth = 2.5;
        this.canvasCtx.strokeStyle = '#39ff14';
        this.canvasCtx.shadowBlur = 10;
        this.canvasCtx.shadowColor = '#39ff14';

        this.canvasCtx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;

            if (i === 0) {
                this.canvasCtx.moveTo(x, y);
            } else {
                this.canvasCtx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        this.canvasCtx.lineTo(width, height / 2);
        this.canvasCtx.stroke();
    }

    drawVU(width, height) {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        let sumL = 0;
        let sumR = 0;
        const half = Math.floor(bufferLength / 2);

        for (let i = 0; i < half; i++) sumL += dataArray[i];
        for (let i = half; i < bufferLength; i++) sumR += dataArray[i];

        const avgL = (sumL / half) / 255;
        const avgR = (sumR / (bufferLength - half)) / 255;

        // Draw Dual Stereo VU Bars
        const meterHeight = 18;
        const meterY1 = height * 0.35;
        const meterY2 = height * 0.65;
        const padding = 40;
        const meterWidth = width - (padding * 2);

        // Left Channel
        this.canvasCtx.fillStyle = 'rgba(0, 243, 255, 0.15)';
        this.canvasCtx.fillRect(padding, meterY1, meterWidth, meterHeight);
        this.canvasCtx.fillStyle = avgL > 0.85 ? '#ff2a5f' : '#00f3ff';
        this.canvasCtx.shadowBlur = 10;
        this.canvasCtx.shadowColor = this.canvasCtx.fillStyle;
        this.canvasCtx.fillRect(padding, meterY1, meterWidth * avgL, meterHeight);

        // Right Channel
        this.canvasCtx.fillStyle = 'rgba(255, 0, 255, 0.15)';
        this.canvasCtx.fillRect(padding, meterY2, meterWidth, meterHeight);
        this.canvasCtx.fillStyle = avgR > 0.85 ? '#ff2a5f' : '#ff00ff';
        this.canvasCtx.shadowBlur = 10;
        this.canvasCtx.shadowColor = this.canvasCtx.fillStyle;
        this.canvasCtx.fillRect(padding, meterY2, meterWidth * avgR, meterHeight);

        // Channel Labels
        this.canvasCtx.font = '10px Orbitron, monospace';
        this.canvasCtx.fillStyle = '#888899';
        this.canvasCtx.fillText('CH-L', 10, meterY1 + 13);
        this.canvasCtx.fillText('CH-R', 10, meterY2 + 13);
    }

    // =========================================================================
    // DYNAMIC TAPE SPOOLS
    // =========================================================================
    updateTapeSpools(currentTime, duration) {
        if (!this.leftTapePack || !this.rightTapePack) return;

        const ratio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
        const minSize = 34; // px (empty spool radius)
        const maxSize = 74; // px (full spool radius)

        // Left spool empties, Right spool fills
        const leftSize = minSize + (maxSize - minSize) * (1 - ratio);
        const rightSize = minSize + (maxSize - minSize) * ratio;

        this.leftTapePack.style.width = `${leftSize}px`;
        this.leftTapePack.style.height = `${leftSize}px`;

        this.rightTapePack.style.width = `${rightSize}px`;
        this.rightTapePack.style.height = `${rightSize}px`;
    }

    // =========================================================================
    // TRACK & PLAYLIST MANAGEMENT
    // =========================================================================
    loadTrack(index) {
        if (index < 0 || index >= this.playlist.length) return;
        this.currentTrackIndex = index;
        const track = this.playlist[index];

        this.audioElement.src = track.url;
        this.updateDisplay(track);
        this.updateMediaSessionMetadata(track);
        this.renderTapeRack();
    }

    updateDisplay(track) {
        if (track) {
            if (this.trackNameEl) this.trackNameEl.textContent = track.name;
            if (this.artistNameEl) this.artistNameEl.textContent = track.artist;
            if (this.tapeLabelEl) this.tapeLabelEl.textContent = track.name;
            const tapeTag = document.getElementById('tape-status-tag');
            if (tapeTag) tapeTag.textContent = `TAPE: [${track.isPersisted ? 'USER' : 'SYSTEM'}]`;
        } else {
            if (this.trackNameEl) this.trackNameEl.textContent = "テープ未挿入";
            if (this.artistNameEl) this.artistNameEl.textContent = "入力を待機中...";
            if (this.tapeLabelEl) this.tapeLabelEl.textContent = "NO TAPE";
        }
    }

    togglePlay() {
        if (this.playlist.length === 0) {
            this.setStatusMessage("テープを挿入してください", 3000);
            return;
        }

        this.initAudioContext();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        if (this.audioElement.paused) {
            this.audioElement.play().catch(e => console.error("Playback failed:", e));
        } else {
            this.audioElement.pause();
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

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const name = file.name.replace(/\.[^/.]+$/, "").toUpperCase();

        try {
            const id = await this.saveTapeToDB(name, file);
            const url = URL.createObjectURL(file);
            const newTrack = { name: name, artist: "USER_IMPORT", url: url, isPersisted: true, id: id };

            this.playlist.push(newTrack);
            this.currentTrackIndex = this.playlist.length - 1;
            this.playTrack(this.currentTrackIndex);
            this.renderTapeRack();
            this.setStatusMessage(`新テープ読込完了: ${name}`, 3500);
        } catch (err) {
            console.error("Save Error:", err);
            alert("保存エラー: 容量不足または無効なファイル形式です");
        }
    }

    // =========================================================================
    // TAPE RACK MODAL (PLAYLIST DRAWER)
    // =========================================================================
    setupModals() {
        // Tape Rack open/close
        if (this.tapeRackBtn) {
            this.tapeRackBtn.addEventListener('click', () => this.toggleTapeRack(true));
        }
        if (this.rackCloseBtn) {
            this.rackCloseBtn.addEventListener('click', () => this.toggleTapeRack(false));
        }
        if (this.rackBackdrop) {
            this.rackBackdrop.addEventListener('click', () => this.toggleTapeRack(false));
        }
        if (this.rackImportBtn) {
            this.rackImportBtn.addEventListener('click', () => {
                const fileInput = document.getElementById('file-input');
                if (fileInput) fileInput.click();
            });
        }

        // Shortcuts modal open/close
        if (this.shortcutsHint) {
            this.shortcutsHint.addEventListener('click', () => this.toggleShortcuts(true));
        }
        if (this.shortcutsCloseBtn) {
            this.shortcutsCloseBtn.addEventListener('click', () => this.toggleShortcuts(false));
        }
        if (this.shortcutsBackdrop) {
            this.shortcutsBackdrop.addEventListener('click', () => this.toggleShortcuts(false));
        }
    }

    toggleTapeRack(show) {
        if (!this.tapeRackModal) return;
        if (show) {
            this.renderTapeRack();
            this.tapeRackModal.classList.remove('hidden');
        } else {
            this.tapeRackModal.classList.add('hidden');
        }
    }

    toggleShortcuts(show) {
        if (!this.shortcutsModal) return;
        if (show) {
            this.shortcutsModal.classList.remove('hidden');
        } else {
            this.shortcutsModal.classList.add('hidden');
        }
    }

    renderTapeRack() {
        if (!this.rackListEl) return;
        this.rackListEl.innerHTML = '';

        this.playlist.forEach((track, idx) => {
            const item = document.createElement('div');
            item.className = `rack-item ${idx === this.currentTrackIndex ? 'active' : ''}`;

            item.innerHTML = `
                <div class="rack-item-info">
                    <span class="rack-item-name">${idx + 1}. ${track.name}</span>
                    <span class="rack-item-meta">${track.artist}</span>
                </div>
                <span class="rack-item-badge ${track.isPersisted ? 'badge-user' : 'badge-system'}">
                    ${track.isPersisted ? 'USER' : 'SYSTEM'}
                </span>
            `;

            item.addEventListener('click', () => {
                this.playTrack(idx);
                this.toggleTapeRack(false);
            });

            this.rackListEl.appendChild(item);
        });

        if (this.rackCountEl) {
            this.rackCountEl.textContent = `TOTAL TAPES: ${this.playlist.length}`;
        }
    }

    playTrack(index) {
        if (index < 0 || index >= this.playlist.length) return;
        this.initAudioContext();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.loadTrack(index);
        this.audioElement.play().catch(e => console.error("Playback failed:", e));
    }

    // =========================================================================
    // KEYBOARD SHORTCUTS
    // =========================================================================
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Ignore if active in input elements
            if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.prevTrack();
                    } else {
                        this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 5);
                        this.setStatusMessage("SEEK: -5s", 1500);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.nextTrack();
                    } else {
                        const dur = this.audioElement.duration || 0;
                        this.audioElement.currentTime = Math.min(dur, this.audioElement.currentTime + 5);
                        this.setStatusMessage("SEEK: +5s", 1500);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustVolume(0.05);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustVolume(-0.05);
                    break;
                case 'KeyM':
                    e.preventDefault();
                    this.toggleMute();
                    break;
                case 'KeyV':
                    e.preventDefault();
                    this.toggleVisMode();
                    break;
                case 'KeyT':
                    e.preventDefault();
                    const isHidden = this.tapeRackModal.classList.contains('hidden');
                    this.toggleTapeRack(isHidden);
                    break;
                case 'Escape':
                    this.toggleTapeRack(false);
                    this.toggleShortcuts(false);
                    break;
            }
        });
    }

    adjustVolume(delta) {
        let val = parseFloat(this.volumeSlider.value) + delta;
        val = Math.max(0, Math.min(1, val));
        this.volumeSlider.value = val;
        this.audioElement.volume = val;
        this.updateSliderLabel('vol-val', `${Math.round(val * 100)}%`);
        if (this.masterGain && this.audioContext) {
            this.masterGain.gain.setTargetAtTime(val, this.audioContext.currentTime, 0.05);
        }
        this.setStatusMessage(`VOLUME: ${Math.round(val * 100)}%`, 1500);
    }

    toggleMute() {
        if (this.isMuted) {
            this.volumeSlider.value = this.previousVolume;
            this.adjustVolume(0);
            this.isMuted = false;
            this.setStatusMessage("UNMUTED", 1500);
        } else {
            this.previousVolume = parseFloat(this.volumeSlider.value);
            this.volumeSlider.value = 0;
            this.adjustVolume(0);
            this.isMuted = true;
            this.setStatusMessage("MUTED", 1500);
        }
    }

    // =========================================================================
    // UTILITIES & SYSTEM
    // =========================================================================
    formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    setStatusMessage(text, duration = 0) {
        if (!this.statusTextEl) return;
        this.statusTextEl.textContent = text;

        if (this.statusResetTimer) clearTimeout(this.statusResetTimer);
        if (duration > 0) {
            this.statusResetTimer = setTimeout(() => {
                this.statusTextEl.textContent = "システム正常 // リンク完了";
            }, duration);
        }
    }

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
            navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
            navigator.mediaSession.setActionHandler('seekbackward', () => {
                this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 10);
            });
            navigator.mediaSession.setActionHandler('seekforward', () => {
                const dur = this.audioElement.duration || 0;
                this.audioElement.currentTime = Math.min(dur, this.audioElement.currentTime + 10);
            });
        }
    }

    updateMediaSessionMetadata(track) {
        if ('mediaSession' in navigator && track) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.name,
                artist: track.artist,
                album: "Cyber-Deck 1984",
                artwork: [
                    { src: 'logo.png', sizes: '96x96', type: 'image/png' },
                    { src: 'logo.png', sizes: '128x128', type: 'image/png' },
                    { src: 'logo.png', sizes: '192x192', type: 'image/png' },
                    { src: 'logo.png', sizes: '512x512', type: 'image/png' }
                ]
            });
        }
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => {});
            } catch (err) {
                console.warn("WakeLock error:", err);
            }
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            await this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW REGISTERED:', reg.scope))
                    .catch(err => console.warn('SW REGISTRATION FAILED:', err));
            });
        }
    }
}

// System Boot
window.addEventListener('load', () => {
    console.log("CYBER-DECK OS LOADED...");
    window.player = new CyberDeckPlayer();
});
