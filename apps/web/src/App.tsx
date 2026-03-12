import { FormEvent, useEffect, useRef, useState, useCallback } from 'react';

declare global {
    interface Window {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        webkitAudioContext?: typeof AudioContext;
    }
}

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = { 0: SpeechRecognitionAlternativeLike; isFinal: boolean };
type SpeechRecognitionEventLike = Event & { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = EventTarget & {
    continuous: boolean; interimResults: boolean; lang: string;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: Event & { error?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void; stop: () => void;
};

type ActionItem = { id: string; title: string; status: 'done' | 'pending'; domain: string; detail: string };
type PanelState = { id: string; label: string; value: string; detail: string; tone: 'stable' | 'warn' | 'critical' | 'boost'; metric: string };
type HeroStat = { id: string; label: string; value: string };
type TranscriptEntry = { id: string; role: 'system' | 'operator' | 'tilly'; text: string; timestamp: string };
type SnapshotMeta = { engine: 'mock' | 'gemini' | 'live'; liveReady: boolean; lastPrompt: string | null; nextSuggestion: string };
type Snapshot = { summary: string; speaking: string; actions: ActionItem[]; panels: PanelState[]; heroStats: HeroStat[]; transcript: TranscriptEntry[]; meta: SnapshotMeta };
type ConfigResponse = { liveReady: boolean; liveSessionReady?: boolean; defaultMode: 'auto' | 'mock' | 'gemini' | 'live'; suggestions: string[] };

type LiveStreamEvent =
    | { type: 'live_status'; status: string }
    | { type: 'input_transcript'; text: string; final: boolean }
    | { type: 'output_transcript'; text: string; final: boolean }
    | { type: 'output_text'; text: string }
    | { type: 'model_audio'; data: string; mimeType: string }
    | { type: 'turn_complete'; inputText: string; outputText: string }
    | { type: 'live_error'; message: string }
    | { type: 'snapshot'; snapshot: Snapshot };

type AudioChunk = { data: string; mimeType: string };

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const FLUSH_SAMPLES = 4096;

const DEMO_SCRIPT = [
    { prompt: "Morning TillTech. Give me a quick operational rundown — who's clocked in, any delivery issues, and how's inventory looking?", delay: 2800 },
    { prompt: "That dough level is concerning. Halt garlic bread prep to save the dough for pizzas and push a loaded fries promo to make up margin.", delay: 3200 },
    { prompt: "Good call. Send that promo as a push notification to our app users now.", delay: 2500 },
    { prompt: "One last thing — Sarah was late again. Note that down and optimise the remaining delivery routes around the traffic.", delay: 3000 }
];

const ICONS: Record<string, string> = { drivers: '🚗', inventory: '📦', kitchen: '🍳', marketing: '📣', staff: '👥', logistics: '🗺️' };

const fallbackSnap: Snapshot = {
    summary: 'Tilly is standing by for a live operational brief.',
    speaking: 'Click the orb or type a command to start talking to your business.',
    actions: [{ id: 'a0', title: 'Ready for first instruction', status: 'pending', domain: 'control', detail: 'Send a prompt or click Run Demo to see the full experience.' }],
    panels: [
        { id: 'drivers', label: 'Drivers', value: '4 active', detail: 'All evening drivers visible.', tone: 'stable', metric: 'ETA online' },
        { id: 'inventory', label: 'Inventory', value: 'Stable', detail: 'Dough threshold active.', tone: 'stable', metric: '2 thresholds' },
        { id: 'kitchen', label: 'Kitchen', value: 'Nominal', detail: 'No blocked items.', tone: 'stable', metric: '0 blocked' },
        { id: 'marketing', label: 'Marketing', value: 'Idle', detail: 'No active campaigns.', tone: 'boost', metric: 'Reach ready' },
        { id: 'staff', label: 'Staffing', value: 'On track', detail: 'Attendance clear.', tone: 'stable', metric: '1 flag' },
        { id: 'logistics', label: 'Logistics', value: 'Normal', detail: 'Default route planning.', tone: 'stable', metric: '45 min avg' }
    ],
    heroStats: [
        { id: 'cov', label: 'Domains', value: '6 live' },
        { id: 'risk', label: 'Risks', value: '1 watch' },
        { id: 'eng', label: 'Engine', value: 'Ready' }
    ],
    transcript: [
        { id: 't0', role: 'system', text: 'Session ready. Synthetic hospitality state loaded.', timestamp: new Date().toISOString() },
        { id: 't1', role: 'tilly', text: 'Good morning. I am ready to walk the shift — ask me anything or click Run Demo.', timestamp: new Date().toISOString() }
    ],
    meta: { engine: 'mock', liveReady: false, lastPrompt: null, nextSuggestion: 'Ask for a shift rundown.' }
};

const fallbackCfg: ConfigResponse = { liveReady: false, defaultMode: 'mock', suggestions: ['Operational rundown', 'Check stock levels', 'Push a promo', 'Optimise routes'] };

// ── Helpers ────────────────────────────────────
function mergeF32(chunks: Float32Array[]) { const total = chunks.reduce((s, c) => s + c.length, 0); const m = new Float32Array(total); let o = 0; for (const c of chunks) { m.set(c, o); o += c.length; } return m; }

const TARGET_SR = 16000;

function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const newLen = Math.round(samples.length / ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
        const srcIdx = i * ratio;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, samples.length - 1);
        const frac = srcIdx - lo;
        out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
    }
    return out;
}

function encodePCM16(samples: Float32Array): string {
    const buf = new ArrayBuffer(samples.length * 2);
    const v = new DataView(buf);
    for (let i = 0; i < samples.length; i++) {
        const c = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
    }
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}
function b64toBlob(b64: string, mime: string) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type: mime }); }

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Component ──────────────────────────────────
export function App() {
    const [snap, setSnap] = useState<Snapshot>(fallbackSnap);
    const [cfg, setCfg] = useState<ConfigResponse>(fallbackCfg);
    const [status, setStatus] = useState<'connect' | 'ok' | 'busy' | 'off'>('connect');
    const [prompt, setPrompt] = useState('');
    const [mode, setMode] = useState<'auto' | 'mock' | 'gemini' | 'live'>('mock');
    const [err, setErr] = useState('');
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [speaking, setSpeaking] = useState(false);
    const [demoRunning, setDemoRunning] = useState(false);
    const [demoStep, setDemoStep] = useState(-1);
    const [flashPanels, setFlashPanels] = useState<Set<string>>(new Set());

    // Live state
    const [liveState, setLiveState] = useState<string>('idle');
    const [liveIn, setLiveIn] = useState('');
    const [liveOut, setLiveOut] = useState('');
    const [liveMuted, setLiveMuted] = useState(false);

    // Refs
    const recRef = useRef<SpeechRecognitionLike | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const procRef = useRef<ScriptProcessorNode | null>(null);
    const srRef = useRef(24000);
    const bufRef = useRef<Float32Array[]>([]);
    const bufCountRef = useRef(0);
    const flushingRef = useRef(false);
    const qRef = useRef<AudioChunk[]>([]);
    const curAudioRef = useRef<HTMLAudioElement | null>(null);
    const playingRef = useRef(false);
    const demoCancelRef = useRef(false);
    const railScrollRef = useRef<HTMLDivElement | null>(null);
    const prevSnapRef = useRef<Snapshot>(fallbackSnap);

    // ── Init ──
    useEffect(() => {
        Promise.all([
            fetch(`${API}/api/config`).then(r => r.json()),
            fetch(`${API}/api/state`).then(r => r.json())
        ]).then(([c, s]) => {
            const config = c as ConfigResponse;
            setCfg(config);
            setMode(config.defaultMode === 'live' ? 'live' : config.defaultMode === 'gemini' ? 'auto' : 'mock');
            setSnap(s as Snapshot);
            setStatus('ok');
        }).catch(() => { setStatus('off'); setErr('Backend offline. Start the server and refresh.'); });
        return () => { recRef.current?.stop(); window.speechSynthesis.cancel(); teardown(false); closeES(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Flash panels on change
    useEffect(() => {
        const changed = new Set<string>();
        for (const p of snap.panels) {
            const prev = prevSnapRef.current.panels.find(x => x.id === p.id);
            if (prev && (prev.value !== p.value || prev.tone !== p.tone)) changed.add(p.id);
        }
        if (changed.size > 0) {
            setFlashPanels(changed);
            setTimeout(() => setFlashPanels(new Set()), 700);
        }
        prevSnapRef.current = snap;
    }, [snap]);

    // Auto-scroll rail
    useEffect(() => {
        railScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [snap.actions]);

    // ── SSE ──
    function openES() {
        if (esRef.current) return;
        const es = new EventSource(`${API}/api/live/events`);
        es.onmessage = (ev) => {
            const p = JSON.parse(ev.data) as LiveStreamEvent;
            if (p.type === 'live_status') { setLiveState(p.status); if (p.status === 'speaking') setSpeaking(true); if (['waiting', 'connected', 'disconnected'].includes(p.status)) setSpeaking(false); }
            else if (p.type === 'input_transcript') { setLiveIn(p.text); p.final ? setInterim('') : setInterim(p.text); }
            else if (p.type === 'output_transcript') setLiveOut(p.text);
            else if (p.type === 'output_text') setLiveOut(cur => p.text.length > cur.length ? p.text : cur);
            else if (p.type === 'model_audio') { qRef.current.push({ data: p.data, mimeType: p.mimeType }); void playQ(); }
            else if (p.type === 'turn_complete') { if (p.inputText) setPrompt(p.inputText); setStatus('busy'); }
            else if (p.type === 'live_error') { setErr(p.message); setLiveState('disconnected'); }
            else if (p.type === 'snapshot') { setSnap(p.snapshot); setStatus('ok'); setLiveIn(''); setInterim(''); }
        };
        es.onerror = () => setLiveState('disconnected');
        esRef.current = es;
    }
    function closeES() { esRef.current?.close(); esRef.current = null; }

    // ── Audio Playback (raw PCM from Gemini Live) ──
    async function playQ() {
        if (liveMuted || playingRef.current) return;
        const c = qRef.current.shift(); if (!c) { setSpeaking(false); return; }
        playingRef.current = true; setSpeaking(true);
        try {
            // Decode base64 PCM to Int16 samples
            const bin = atob(c.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            // Convert to Float32
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
            // Determine output sample rate from mimeType (e.g. audio/pcm;rate=24000)
            const rateMatch = c.mimeType.match(/rate=(\d+)/);
            const outSr = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
            // Create AudioContext and play
            const playCtx = new (window.AudioContext ?? window.webkitAudioContext!)({ sampleRate: outSr });
            const abuf = playCtx.createBuffer(1, float32.length, outSr);
            abuf.getChannelData(0).set(float32);
            const src = playCtx.createBufferSource();
            src.buffer = abuf;
            src.connect(playCtx.destination);
            src.onended = () => { playCtx.close().catch(() => {}); playingRef.current = false; void playQ(); };
            src.start();
            setLiveState('speaking');
        } catch (e) {
            console.error('Audio playback failed:', e);
            playingRef.current = false; setSpeaking(false); void playQ();
        }
    }

    // ── Mic ──
    async function flushBuf() {
        if (flushingRef.current || bufCountRef.current === 0) return;
        const samples = mergeF32(bufRef.current); bufRef.current = []; bufCountRef.current = 0; flushingRef.current = true;
        const pcm16 = downsample(samples, srRef.current, TARGET_SR);
        try { await fetch(`${API}/api/live/audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: encodePCM16(pcm16), mimeType: `audio/pcm;rate=${TARGET_SR}` }) }); }
        catch { setErr('Audio send failed.'); setLiveState('disconnected'); }
        finally { flushingRef.current = false; if (bufCountRef.current >= FLUSH_SAMPLES) void flushBuf(); }
    }

    function pushAudio(data: Float32Array) { const c = new Float32Array(data.length); c.set(data); bufRef.current.push(c); bufCountRef.current += c.length; if (bufCountRef.current >= FLUSH_SAMPLES) void flushBuf(); }

    async function teardown(sendStop: boolean) {
        procRef.current?.disconnect(); srcRef.current?.disconnect(); procRef.current = null; srcRef.current = null;
        streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
        if (ctxRef.current) { await ctxRef.current.close().catch(() => undefined); ctxRef.current = null; }
        bufRef.current = []; bufCountRef.current = 0;
        if (sendStop) { await fetch(`${API}/api/live/audio/stop`, { method: 'POST' }).catch(() => undefined); setLiveState('processing'); }
    }

    async function startLive() {
        openES(); setErr(''); setLiveState('connecting');
        try {
            await fetch(`${API}/api/live/session/start`, { method: 'POST' });
            const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            const Ctor = window.AudioContext ?? window.webkitAudioContext; const ctx = new Ctor();
            const src = ctx.createMediaStreamSource(s); const proc = ctx.createScriptProcessor(4096, 1, 1);
            srRef.current = ctx.sampleRate; streamRef.current = s; ctxRef.current = ctx; srcRef.current = src; procRef.current = proc;
            proc.onaudioprocess = (e) => pushAudio(e.inputBuffer.getChannelData(0));
            src.connect(proc); proc.connect(ctx.destination);
            setLiveState('capturing'); setListening(true); setLiveIn(''); setLiveOut('');
        } catch (e) { setListening(false); setLiveState('disconnected'); setErr(e instanceof Error ? e.message : 'Mic failed.'); await teardown(false); }
    }

    async function stopLive() { setListening(false); await flushBuf(); await teardown(true); }

    // ── Submit ──
    const sendPromptDirect = async (text: string, modeOverride?: string) => {
        if (!text.trim()) return;
        setStatus('busy'); setErr('');
        try {
            const res = await fetch(`${API}/api/session/respond`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: text, mode: modeOverride ?? mode })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.');
            setSnap(data as Snapshot);
            setStatus('ok'); setInterim('');
        } catch (e) { setStatus('off'); setErr(e instanceof Error ? e.message : 'Error.'); }
    };
    const sendPromptRef = useRef(sendPromptDirect);
    sendPromptRef.current = sendPromptDirect;

    function handleSubmit(ev: FormEvent) { ev.preventDefault(); void sendPromptRef.current(prompt); setPrompt(''); }

    // Reset state without touching demo flags
    async function _resetState() {
        await teardown(false); recRef.current?.stop(); setListening(false);
        setLiveIn(''); setLiveOut(''); qRef.current = []; curAudioRef.current?.pause(); curAudioRef.current = null; playingRef.current = false;
        const res = await fetch(`${API}/api/scenario/reset`, { method: 'POST' });
        const snapData = await res.json() as Snapshot;
        setSnap(snapData);
        setStatus('ok'); setErr(''); setLiveState('idle');
    }

    async function resetScenario() {
        demoCancelRef.current = true; setDemoRunning(false); setDemoStep(-1);
        await _resetState();
    }

    // ── Auto Demo ──
    async function runDemo() {
        demoCancelRef.current = false;
        // Reset state first WITHOUT killing demo flags
        await _resetState();
        setDemoRunning(true); setDemoStep(0);
        await sleep(600);

        for (let i = 0; i < DEMO_SCRIPT.length; i++) {
            if (demoCancelRef.current) break;
            setDemoStep(i);
            setPrompt(DEMO_SCRIPT[i].prompt);
            await sleep(1500); // Show the prompt visually
            if (demoCancelRef.current) break;
            setPrompt('');
            await sendPromptRef.current(DEMO_SCRIPT[i].prompt, 'mock');
            if (demoCancelRef.current) break;
            await sleep(DEMO_SCRIPT[i].delay);
        }
        setDemoRunning(false); setDemoStep(-1);
    }

    // ── Voice ──
    function toggleSpeech() {
        if (mode === 'live' && cfg.liveSessionReady) { setLiveMuted(c => !c); return; }
        if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
        const u = new SpeechSynthesisUtterance(snap.speaking);
        u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
        setSpeaking(true); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    }

    function toggleBrowserMic() {
        const R = window.SpeechRecognition ?? window.webkitSpeechRecognition;
        if (!R) { setErr('Speech recognition not available.'); return; }
        if (listening && recRef.current) { recRef.current.stop(); recRef.current = null; setListening(false); return; }
        const rec = new R(); rec.continuous = false; rec.interimResults = true; rec.lang = 'en-GB';
        let finalText = '';
        rec.onresult = (ev) => { let fin = '', int = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0]?.transcript ?? ''; ev.results[i].isFinal ? (fin += t) : (int += t); } if (fin.trim()) { finalText = fin.trim(); setPrompt(fin.trim()); } setInterim(int.trim()); };
        rec.onerror = (e) => { setErr(e.error ? `Mic: ${e.error}` : 'Mic failed.'); setListening(false); recRef.current = null; };
        rec.onend = () => {
            setListening(false); setInterim(''); recRef.current = null;
            // Auto-submit when speech recognition finishes
            if (finalText.trim()) { void sendPromptRef.current(finalText); setPrompt(''); }
        };
        recRef.current = rec; setErr(''); setListening(true); rec.start();
    }

    function toggleVoice() {
        if (mode === 'live' && cfg.liveSessionReady) { if (listening || liveState === 'capturing' || liveState === 'connecting') { void stopLive(); return; } void startLive(); return; }
        toggleBrowserMic();
    }

    // ── Derived ──
    const orbState = listening || liveState === 'capturing' ? 'listening' : status === 'busy' || liveState === 'processing' ? 'processing' : speaking || liveState === 'speaking' ? 'speaking' : 'idle';
    const orbTag = orbState === 'listening' ? '● Listening' : orbState === 'processing' ? '◌ Thinking' : orbState === 'speaking' ? '◉ Speaking' : '○ Click to talk';
    const dotClass = status === 'off' ? 'offline' : status === 'busy' || liveState === 'capturing' || liveState === 'speaking' ? 'running' : '';
    const modes = (['live', 'auto', 'mock'] as const).filter(m => { if (m === 'live') return Boolean(cfg.liveSessionReady); return true; });
    const displayText = liveOut || snap.speaking;

    return (
        <main className="shell">
            {/* ── Top Bar ── */}
            <header className="topBar">
                <div className="topBarLeft">
                    <div className="topBarLogo">Tilly <span>Live Ops</span></div>
                    <span className={`statusDot ${dotClass}`} />
                    <span className="statusLabel">{demoRunning ? `Demo step ${demoStep + 1}/${DEMO_SCRIPT.length}` : snap.meta.engine}</span>
                </div>
                <div className="topBarRight">
                    <button className={`demoBtn ${demoRunning ? 'running' : ''}`} onClick={demoRunning ? () => { demoCancelRef.current = true; } : () => void runDemo()} disabled={status === 'off'}>
                        {demoRunning ? '■ Stop' : '▶ Run Demo'}
                    </button>
                    <div className="modeSwitch">
                        {modes.map(m => <button key={m} className={`modeBtn ${m === mode ? 'active' : ''}`} onClick={() => setMode(m)}>{m}</button>)}
                    </div>
                    <button className="resetBtn" onClick={() => void resetScenario()}>Reset</button>
                </div>
            </header>

            {/* ── Stage ── */}
            <section className="stage">
                {/* Left — Panels */}
                <div className="panelCol">
                    {snap.panels.map(p => (
                        <article key={p.id} className={`pCard tone-${p.tone} ${flashPanels.has(p.id) ? 'flash' : ''}`}>
                            <div className="pLabel"><span className="pIcon">{ICONS[p.id] ?? '📊'}</span> {p.label}</div>
                            <div className="pRow">
                                <span className="pVal">{p.value}</span>
                                <span className="pMetric">{p.metric}</span>
                            </div>
                            <div className="pDetail">{p.detail}</div>
                        </article>
                    ))}
                </div>

                {/* Centre — Orb */}
                <div className="centre">
                    <div className="chips">
                        {snap.heroStats.map(s => (
                            <div key={s.id} className="statChip">
                                <span className="statChipL">{s.label}</span>
                                <span className="statChipV">{s.value}</span>
                            </div>
                        ))}
                    </div>

                    <div className="orbWrap" onClick={toggleVoice}>
                        <div className="halo" />
                        <div className="ring ring1" />
                        <div className="ring ring2" />
                        <div className="ring ring3" />
                        <div className={`orb ${orbState}`} />
                    </div>
                    <div className={`orbTag ${orbState !== 'idle' ? 'on' : ''}`}>{orbTag}</div>

                    <div className="liveText">
                        {(liveIn || interim) && (
                            <div className="bubble op">
                                <div className="bubbleRole">Operator</div>
                                <div className="bubbleText">{liveIn || interim}</div>
                            </div>
                        )}
                        {demoRunning && demoStep >= 0 && prompt && (
                            <div className="bubble op">
                                <div className="bubbleRole">Operator</div>
                                <div className="bubbleText">{prompt}</div>
                            </div>
                        )}
                        <div className="bubble tilly">
                            <div className="bubbleRole">Tilly</div>
                            <div className="bubbleText">{displayText}</div>
                        </div>
                        {snap.summary !== snap.speaking && <div className="summaryLine">{snap.summary}</div>}
                    </div>
                </div>

                {/* Right — Actions + Transcript */}
                <aside className="rail">
                    <div className="railTitle">Action Timeline</div>
                    <div className="railScroll" ref={railScrollRef}>
                        {snap.actions.map((a, i) => (
                            <div key={a.id} className={`aCard ${i === 0 && snap.actions.length > 1 ? 'fresh' : ''}`} style={{ animationDelay: `${i * 80}ms` }}>
                                <div className="aHead">
                                    <span className="aTitle">{a.title}</span>
                                    <span className={`aBadge ${a.status}`}>{a.status === 'done' ? '✓' : '⏳'}</span>
                                </div>
                                <div className="aDetail">{a.detail}</div>
                                <div className="aDomain">{a.domain}</div>
                            </div>
                        ))}
                    </div>
                    <div className="railSection">Conversation</div>
                    <div className="railScroll">
                        {snap.transcript.slice().reverse().map(t => (
                            <div key={t.id} className={`tEntry r-${t.role}`}>
                                <span className="tRole">{t.role}</span>
                                <div className="tText">{t.text}</div>
                            </div>
                        ))}
                    </div>
                </aside>
            </section>

            {/* ── Composer ── */}
            <form className="composer" onSubmit={handleSubmit}>
                <button type="button" className={`iconBtn ${listening ? 'on' : ''}`} onClick={toggleVoice} title="Mic">🎤</button>
                <button type="button" className={`iconBtn ${speaking ? 'speaking' : ''}`} onClick={toggleSpeech} title="Audio">{speaking ? '🔊' : '🔈'}</button>
                <input className="cInput" type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask Tilly to review, decide, and act…" disabled={demoRunning} />
                <div className="chipRow">
                    {cfg.suggestions.map(s => <button key={s} type="button" className="chip" onClick={() => setPrompt(s)}>{s}</button>)}
                </div>
                <button type="submit" className="sendBtn" disabled={status === 'busy' || !prompt.trim() || demoRunning}>
                    {status === 'busy' ? '⏳' : 'Send'}
                </button>
                {err && <span className="errMsg">{err}</span>}
            </form>
        </main>
    );
}
