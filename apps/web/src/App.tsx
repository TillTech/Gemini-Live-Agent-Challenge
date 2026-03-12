import { FormEvent, useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        webkitAudioContext?: typeof AudioContext;
    }
}

type SpeechRecognitionAlternativeLike = {
    transcript: string;
};

type SpeechRecognitionResultLike = {
    0: SpeechRecognitionAlternativeLike;
    isFinal: boolean;
};

type SpeechRecognitionEventLike = Event & {
    resultIndex: number;
    results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = EventTarget & {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: Event & { error?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
};

type ActionItem = {
    id: string;
    title: string;
    status: 'done' | 'pending';
    domain: string;
    detail: string;
};

type PanelState = {
    id: string;
    label: string;
    value: string;
    detail: string;
    tone: 'stable' | 'warn' | 'critical' | 'boost';
    metric: string;
};

type HeroStat = {
    id: string;
    label: string;
    value: string;
};

type TranscriptEntry = {
    id: string;
    role: 'system' | 'operator' | 'tilly';
    text: string;
    timestamp: string;
};

type SnapshotMeta = {
    engine: 'mock' | 'gemini' | 'live';
    liveReady: boolean;
    lastPrompt: string | null;
    nextSuggestion: string;
};

type Snapshot = {
    summary: string;
    speaking: string;
    actions: ActionItem[];
    panels: PanelState[];
    heroStats: HeroStat[];
    transcript: TranscriptEntry[];
    meta: SnapshotMeta;
};

type ConfigResponse = {
    liveReady: boolean;
    liveSessionReady?: boolean;
    defaultMode: 'auto' | 'mock' | 'gemini' | 'live';
    suggestions: string[];
};

type LiveStreamEvent =
    | { type: 'live_status'; status: 'connected' | 'capturing' | 'processing' | 'speaking' | 'waiting' | 'disconnected' | 'interrupted' }
    | { type: 'input_transcript'; text: string; final: boolean }
    | { type: 'output_transcript'; text: string; final: boolean }
    | { type: 'output_text'; text: string }
    | { type: 'model_audio'; data: string; mimeType: string }
    | { type: 'turn_complete'; inputText: string; outputText: string }
    | { type: 'live_error'; message: string }
    | { type: 'snapshot'; snapshot: Snapshot };

type LiveTransportState = 'idle' | 'connecting' | 'connected' | 'capturing' | 'processing' | 'speaking' | 'waiting' | 'disconnected' | 'interrupted';

type AudioChunk = {
    data: string;
    mimeType: string;
};

const fallbackSnapshot: Snapshot = {
    summary: 'Tilly is standing by for a live operational brief.',
    speaking: 'Ask for a shift rundown, inventory risk, route optimisation, or a quick recovery campaign.',
    actions: [
        {
            id: 'a1',
            title: 'Voice agent primed for first operator instruction',
            status: 'pending',
            domain: 'control',
            detail: 'Use mock mode until Gemini credentials are configured.'
        }
    ],
    panels: [
        { id: 'drivers', label: 'Drivers', value: '4 active', detail: 'All evening drivers visible.', tone: 'stable', metric: 'ETA board online' },
        { id: 'inventory', label: 'Inventory', value: 'Stable', detail: 'Fresh dough threshold monitoring active.', tone: 'stable', metric: '2 live thresholds' },
        { id: 'kitchen', label: 'Kitchen', value: 'Nominal', detail: 'No blocked items yet.', tone: 'stable', metric: '0 blocked items' },
        { id: 'marketing', label: 'Marketing', value: 'Idle', detail: 'No active campaign drafted.', tone: 'boost', metric: 'Reach ready' }
    ],
    heroStats: [
        { id: 'coverage', label: 'Operational Domains', value: '6 live' },
        { id: 'risk', label: 'Critical Risks', value: '1 watch' },
        { id: 'engine', label: 'Agent Engine', value: 'Mock fallback' }
    ],
    transcript: [
        { id: 't1', role: 'system', text: 'Session created. Synthetic hospitality state loaded.', timestamp: new Date().toISOString() },
        { id: 't2', role: 'tilly', text: 'Good morning. I am ready to walk the shift and take action across operations.', timestamp: new Date().toISOString() }
    ],
    meta: {
        engine: 'mock',
        liveReady: false,
        lastPrompt: null,
        nextSuggestion: 'Ask for a quick operational rundown for the main restaurant.'
    }
};

const fallbackConfig: ConfigResponse = {
    liveReady: false,
    defaultMode: 'mock',
    suggestions: [
        'Hey TillTech, give me a quick operational rundown for the main restaurant today. Have all the drivers clocked in for the evening shift?',
        'Okay, send the customer an automated SMS apologizing for the delay and drop 50 loyalty points into their app wallet.',
        'Check the stock levels in the main prep kitchen. How are we looking on fresh dough?',
        'Do a 20% off QR code and push it as a notification to everyone who has our branded mobile app.'
    ]
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const LIVE_AUDIO_FLUSH_SAMPLES = 8192;

function mergeFloat32Chunks(chunks: Float32Array[]) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return merged;
}

function encodeWavToBase64(samples: Float32Array, sampleRate: number) {
    const pcmBuffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(pcmBuffer);

    const writeString = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
        const clipped = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
        offset += 2;
    }

    const bytes = new Uint8Array(pcmBuffer);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
}

export function App() {
    const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
    const [config, setConfig] = useState<ConfigResponse>(fallbackConfig);
    const [status, setStatus] = useState<'connecting' | 'ready' | 'running' | 'offline'>('connecting');
    const [prompt, setPrompt] = useState(fallbackConfig.suggestions[0]);
    const [mode, setMode] = useState<'auto' | 'mock' | 'gemini' | 'live'>('mock');
    const [errorMessage, setErrorMessage] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [interimPrompt, setInterimPrompt] = useState('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [liveTransport, setLiveTransport] = useState<LiveTransportState>('idle');
    const [liveInputTranscript, setLiveInputTranscript] = useState('');
    const [liveOutputTranscript, setLiveOutputTranscript] = useState('');
    const [liveAudioMuted, setLiveAudioMuted] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const liveEventsRef = useRef<EventSource | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
    const sampleRateRef = useRef(24000);
    const pendingAudioChunksRef = useRef<Float32Array[]>([]);
    const pendingSampleCountRef = useRef(0);
    const audioFlushInFlightRef = useRef(false);
    const playbackQueueRef = useRef<AudioChunk[]>([]);
    const currentAudioRef = useRef<HTMLAudioElement | null>(null);
    const liveAudioPlayingRef = useRef(false);

    useEffect(() => {
        Promise.all([
            fetch(`${API_BASE}/api/config`).then((response) => response.json()),
            fetch(`${API_BASE}/api/state`).then((response) => response.json())
        ])
            .then(([configResponse, stateResponse]) => {
                const nextConfig = configResponse as ConfigResponse;
                setConfig(nextConfig);
                setMode(nextConfig.defaultMode);
                setPrompt(nextConfig.suggestions[0] ?? fallbackConfig.suggestions[0]);
                setSnapshot(stateResponse as Snapshot);
                setStatus('ready');
            })
            .catch(() => {
                setStatus('offline');
                setErrorMessage('The local agent backend is offline. Start the server and refresh the page.');
            });
    }, []);

    useEffect(() => {
        return () => {
            recognitionRef.current?.stop();
            window.speechSynthesis.cancel();
            teardownLiveCapture(false);
            closeLiveEventStream();
        };
    }, []);

    useEffect(() => {
        if (liveAudioMuted) {
            playbackQueueRef.current = [];
            currentAudioRef.current?.pause();
            currentAudioRef.current = null;
            liveAudioPlayingRef.current = false;
            if (mode === 'live') {
                setIsSpeaking(false);
            }
            return;
        }

        void playQueuedAudio();
    }, [liveAudioMuted, mode]);

    function openLiveEventStream() {
        if (liveEventsRef.current) {
            return;
        }

        const eventSource = new EventSource(`${API_BASE}/api/live/events`);
        eventSource.onmessage = (event) => {
            const payload = JSON.parse(event.data) as LiveStreamEvent;

            switch (payload.type) {
                case 'live_status':
                    setLiveTransport(payload.status);
                    if (payload.status === 'speaking') {
                        setIsSpeaking(true);
                    }
                    if (payload.status === 'waiting' || payload.status === 'connected' || payload.status === 'disconnected') {
                        setIsSpeaking(false);
                    }
                    return;
                case 'input_transcript':
                    setLiveInputTranscript(payload.text);
                    if (!payload.final) {
                        setInterimPrompt(payload.text);
                    } else {
                        setInterimPrompt('');
                    }
                    return;
                case 'output_transcript':
                    setLiveOutputTranscript(payload.text);
                    return;
                case 'output_text':
                    setLiveOutputTranscript((current) => (payload.text.length > current.length ? payload.text : current));
                    return;
                case 'model_audio':
                    playbackQueueRef.current.push({ data: payload.data, mimeType: payload.mimeType });
                    void playQueuedAudio();
                    return;
                case 'turn_complete':
                    if (payload.inputText) {
                        setPrompt(payload.inputText);
                    }
                    setStatus('running');
                    return;
                case 'live_error':
                    setErrorMessage(payload.message);
                    setLiveTransport('disconnected');
                    return;
                case 'snapshot':
                    setSnapshot(payload.snapshot);
                    setStatus('ready');
                    setLiveInputTranscript('');
                    setInterimPrompt('');
                    return;
            }
        };
        eventSource.onerror = () => {
            setLiveTransport('disconnected');
        };

        liveEventsRef.current = eventSource;
    }

    function closeLiveEventStream() {
        liveEventsRef.current?.close();
        liveEventsRef.current = null;
    }

    async function playQueuedAudio() {
        if (liveAudioMuted || liveAudioPlayingRef.current) {
            return;
        }

        const nextChunk = playbackQueueRef.current.shift();
        if (!nextChunk) {
            setIsSpeaking(false);
            return;
        }

        liveAudioPlayingRef.current = true;
        setIsSpeaking(true);
        const blob = base64ToBlob(nextChunk.data, nextChunk.mimeType);
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            liveAudioPlayingRef.current = false;
            void playQueuedAudio();
        };
        audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            liveAudioPlayingRef.current = false;
            setIsSpeaking(false);
            setErrorMessage('The browser could not play the streamed model audio chunk.');
            void playQueuedAudio();
        };

        try {
            await audio.play();
            setLiveTransport('speaking');
        } catch {
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            liveAudioPlayingRef.current = false;
            setIsSpeaking(false);
            setErrorMessage('Live model audio playback was blocked by the browser. Click the mic first, then try again.');
        }
    }

    async function flushBufferedAudio() {
        if (audioFlushInFlightRef.current || pendingSampleCountRef.current === 0) {
            return;
        }

        const samples = mergeFloat32Chunks(pendingAudioChunksRef.current);
        pendingAudioChunksRef.current = [];
        pendingSampleCountRef.current = 0;
        audioFlushInFlightRef.current = true;

        try {
            await fetch(`${API_BASE}/api/live/audio`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audioBase64: encodeWavToBase64(samples, sampleRateRef.current),
                    mimeType: 'audio/wav'
                })
            });
        } catch {
            setErrorMessage('Failed to send live microphone audio to the backend.');
            setLiveTransport('disconnected');
        } finally {
            audioFlushInFlightRef.current = false;
            if (pendingSampleCountRef.current >= LIVE_AUDIO_FLUSH_SAMPLES) {
                void flushBufferedAudio();
            }
        }
    }

    function appendAudioChunk(channelData: Float32Array) {
        const copy = new Float32Array(channelData.length);
        copy.set(channelData);
        pendingAudioChunksRef.current.push(copy);
        pendingSampleCountRef.current += copy.length;

        if (pendingSampleCountRef.current >= LIVE_AUDIO_FLUSH_SAMPLES) {
            void flushBufferedAudio();
        }
    }

    async function teardownLiveCapture(sendStopSignal: boolean) {
        processorNodeRef.current?.disconnect();
        sourceNodeRef.current?.disconnect();
        processorNodeRef.current = null;
        sourceNodeRef.current = null;

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;

        if (audioContextRef.current) {
            await audioContextRef.current.close().catch(() => undefined);
            audioContextRef.current = null;
        }

        pendingAudioChunksRef.current = [];
        pendingSampleCountRef.current = 0;

        if (sendStopSignal) {
            await fetch(`${API_BASE}/api/live/audio/stop`, { method: 'POST' }).catch(() => undefined);
            setLiveTransport('processing');
        }
    }

    async function startLiveCapture() {
        openLiveEventStream();
        setErrorMessage('');
        setLiveTransport('connecting');

        try {
            await fetch(`${API_BASE}/api/live/session/start`, { method: 'POST' });
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
            const audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);

            sampleRateRef.current = audioContext.sampleRate;
            mediaStreamRef.current = stream;
            audioContextRef.current = audioContext;
            sourceNodeRef.current = source;
            processorNodeRef.current = processor;

            processor.onaudioprocess = (event) => {
                appendAudioChunk(event.inputBuffer.getChannelData(0));
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
            setLiveTransport('capturing');
            setIsListening(true);
            setLiveInputTranscript('');
            setLiveOutputTranscript('');
        } catch (error) {
            setIsListening(false);
            setLiveTransport('disconnected');
            setErrorMessage(error instanceof Error ? error.message : 'Unable to start live microphone capture.');
            await teardownLiveCapture(false);
        }
    }

    async function stopLiveCapture() {
        setIsListening(false);
        await flushBufferedAudio();
        await teardownLiveCapture(true);
    }

    async function submitPrompt(event: FormEvent) {
        event.preventDefault();
        if (!prompt.trim()) {
            return;
        }

        setStatus('running');
        setErrorMessage('');

        try {
            const response = await fetch(`${API_BASE}/api/session/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt, mode })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Agent request failed.');
            }

            setSnapshot(data as Snapshot);
            setStatus('ready');
            setInterimPrompt('');
        } catch (error) {
            setStatus('offline');
            setErrorMessage(error instanceof Error ? error.message : 'Unknown agent error.');
        }
    }

    async function resetScenario() {
        await teardownLiveCapture(false);
        recognitionRef.current?.stop();
        setIsListening(false);
        setLiveInputTranscript('');
        setLiveOutputTranscript('');
        playbackQueueRef.current = [];
        currentAudioRef.current?.pause();
        currentAudioRef.current = null;
        liveAudioPlayingRef.current = false;

        const response = await fetch(`${API_BASE}/api/scenario/reset`, { method: 'POST' });
        const data = await response.json();
        setSnapshot(data as Snapshot);
        setStatus('ready');
        setErrorMessage('');
        setLiveTransport('idle');
    }

    function applySuggestion(value: string) {
        setPrompt(value);
    }

    function toggleSpeechPlayback() {
        if (mode === 'live' && config.liveSessionReady) {
            setLiveAudioMuted((current) => !current);
            return;
        }

        if (isSpeaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(snapshot.speaking);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        setIsSpeaking(true);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }

    function toggleBrowserSpeechRecognition() {
        const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

        if (!Recognition) {
            setErrorMessage('Browser speech recognition is not available in this browser.');
            return;
        }

        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
            setIsListening(false);
            return;
        }

        const recognition = new Recognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-GB';
        recognition.onresult = (event) => {
            let finalText = '';
            let nextInterim = '';

            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = result[0]?.transcript ?? '';
                if (result.isFinal) {
                    finalText += transcript;
                } else {
                    nextInterim += transcript;
                }
            }

            if (finalText.trim()) {
                setPrompt((current) => (current.trim() ? `${current.trim()} ${finalText.trim()}` : finalText.trim()));
            }
            setInterimPrompt(nextInterim.trim());
        };
        recognition.onerror = (event) => {
            setErrorMessage(event.error ? `Speech recognition error: ${event.error}` : 'Speech recognition failed.');
            setIsListening(false);
            recognitionRef.current = null;
        };
        recognition.onend = () => {
            setIsListening(false);
            setInterimPrompt('');
            recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        setErrorMessage('');
        setIsListening(true);
        recognition.start();
    }

    function toggleVoiceCapture() {
        if (mode === 'live' && config.liveSessionReady) {
            if (isListening || liveTransport === 'capturing' || liveTransport === 'connecting') {
                void stopLiveCapture();
                return;
            }

            void startLiveCapture();
            return;
        }

        toggleBrowserSpeechRecognition();
    }

    const availableModes = (['live', 'auto', 'gemini', 'mock'] as const).filter((option) => {
        if (option === 'live') {
            return Boolean(config.liveSessionReady);
        }
        if (option === 'gemini') {
            return config.liveReady;
        }
        return true;
    });

    const liveCaption = liveOutputTranscript || snapshot.speaking;
    const liveStatusLabel =
        liveTransport === 'capturing'
            ? 'Streaming mic audio'
            : liveTransport === 'processing'
                ? 'Processing live turn'
                : liveTransport === 'speaking'
                    ? 'Model audio streaming'
                    : liveTransport === 'waiting'
                        ? 'Listening for next turn'
                        : liveTransport === 'connecting'
                            ? 'Opening live session'
                            : status === 'running'
                                ? 'Processing live turn'
                                : status === 'offline'
                                    ? 'Backend offline'
                                    : snapshot.meta.engine === 'live'
                                        ? 'Live session active'
                                        : snapshot.meta.engine === 'gemini'
                                            ? 'Gemini active'
                                            : 'Mock planner active';

    return (
        <main className="shell">
            <section className="hero">
                <div className="heroCopy">
                    <p className="eyebrow">Live Operations Command Surface</p>
                    <h1>Tilly Live Ops</h1>
                    <p className="lede">
                        A voice-first business agent for hospitality operators. Ask once, keep context, take action, and watch the shift state update in real time.
                    </p>
                    <div className="statRow">
                        {snapshot.heroStats.map((stat) => (
                            <div key={stat.id} className="heroStat">
                                <span>{stat.label}</span>
                                <strong>{stat.value}</strong>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="voiceBar">
                    <div className="voiceStatusRow">
                        <span className={`dot dot-${status === 'offline' ? 'offline' : liveTransport === 'capturing' || liveTransport === 'speaking' ? 'running' : 'ready'}`} />
                        <span>{liveStatusLabel}</span>
                    </div>
                    <span className="chip">{config.liveSessionReady ? 'Gemini Live audio ready' : config.liveReady ? 'Gemini configured' : 'Mock fallback'}</span>
                    <div className={`signalBars signalBars-${liveTransport}`}>
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className="voiceTranscriptCard">
                        <p className="voiceTranscriptLabel">Operator</p>
                        <p>{liveInputTranscript || interimPrompt || 'Start the mic to stream a live spoken turn.'}</p>
                    </div>
                    <div className="voiceTranscriptCard voiceTranscriptCardOutput">
                        <p className="voiceTranscriptLabel">Tilly</p>
                        <p>{liveCaption}</p>
                    </div>
                    <div className="voiceControls">
                        <button type="button" className={isListening ? 'secondaryButton activeState' : 'secondaryButton'} onClick={toggleVoiceCapture}>
                            {mode === 'live' && config.liveSessionReady ? (isListening ? 'Stop live mic' : 'Start live mic') : isListening ? 'Stop mic' : 'Start mic'}
                        </button>
                        <button type="button" className={isSpeaking ? 'secondaryButton activeState' : 'secondaryButton'} onClick={toggleSpeechPlayback}>
                            {mode === 'live' && config.liveSessionReady ? (liveAudioMuted ? 'Unmute model audio' : 'Mute model audio') : isSpeaking ? 'Stop speech' : 'Play response'}
                        </button>
                    </div>
                </div>
            </section>

            <section className="commandDeck">
                <article className="summaryCard summaryCardLarge">
                    <p className="cardLabel">Live Summary</p>
                    <h2>{snapshot.summary}</h2>
                    <p>{mode === 'live' && liveOutputTranscript ? liveOutputTranscript : snapshot.speaking}</p>
                    <div className="metaRow">
                        <span>Last prompt: {snapshot.meta.lastPrompt ?? 'No operator turn yet'}</span>
                        <span>Next move: {snapshot.meta.nextSuggestion}</span>
                    </div>
                </article>

                <form className="composerCard" onSubmit={submitPrompt}>
                    <div className="composerHeader">
                        <p className="cardLabel">Operator Turn</p>
                        <div className="modeSwitch">
                            {availableModes.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    className={option === mode ? 'modeButton active' : 'modeButton'}
                                    onClick={() => setMode(option)}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </div>

                    <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={6}
                        placeholder="Ask Tilly to review, decide, and act across operations."
                    />

                    {interimPrompt ? <p className="interimText">Listening: {interimPrompt}</p> : null}

                    <div className="suggestionList">
                        {config.suggestions.map((entry) => (
                            <button key={entry} type="button" className="suggestionChip" onClick={() => applySuggestion(entry)}>
                                {entry}
                            </button>
                        ))}
                    </div>

                    {errorMessage ? <p className="errorText">{errorMessage}</p> : null}

                    <div className="composerActions">
                        <button type="submit">Send operator turn</button>
                        <button type="button" className="secondaryButton" onClick={() => void resetScenario()}>Reset scenario</button>
                    </div>
                </form>
            </section>

            <section className="stage">
                <aside className="transcriptCard">
                    <p className="cardLabel">Conversation</p>
                    <ul>
                        {snapshot.transcript.map((entry) => (
                            <li key={entry.id} className={`transcriptEntry role-${entry.role}`}>
                                <span className="transcriptRole">{entry.role}</span>
                                <p>{entry.text}</p>
                            </li>
                        ))}
                    </ul>
                </aside>

                <aside className="actionsCard">
                    <p className="cardLabel">Action Timeline</p>
                    <ul>
                        {snapshot.actions.map((action) => (
                            <li key={action.id} className={`${action.status} domain-${action.domain}`}>
                                <div>
                                    <span>{action.title}</span>
                                    <p>{action.detail}</p>
                                </div>
                                <strong>{action.status}</strong>
                            </li>
                        ))}
                    </ul>
                </aside>
            </section>

            <section className="panelGrid">
                {snapshot.panels.map((panel) => (
                    <article key={panel.id} className={`panelCard tone-${panel.tone}`}>
                        <p className="cardLabel">{panel.label}</p>
                        <div className="panelValueRow">
                            <h3>{panel.value}</h3>
                            <span className="metricChip">{panel.metric}</span>
                        </div>
                        <p>{panel.detail}</p>
                    </article>
                ))}
            </section>
        </main>
    );
}
