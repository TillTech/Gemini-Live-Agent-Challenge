import { FormEvent, useEffect, useRef, useState } from 'react';

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



const ICONS: Record<string, string> = {
    delivery_drivers: '🚗', distribution: '🚛', logistics: '🗺️',
    store_stock: '📦', warehouse_stock: '🏭', supplier_orders: '🔄', costings: '💷', wastage: '🗑️',
    kitchen_flow: '🍳', kitchen_stations: '📍',
    promotions: '🏷️', push_notifications: '📲', email_campaigns: '📧', sms_campaigns: '💬',
    loyalty: '⭐', engagement: '🎮',
    customer_comms: '💌',
    rotas: '📅', attendance: '⏱️', staff_stations: '🧑‍🍳', performance: '📈',
    payments: '💳', reports: '📊', accounts: '🧾'
};

const PANEL_GROUPS: { label: string; icon: string; ids: string[] }[] = [
    { label: 'Delivery & Logistics', icon: '🚚', ids: ['delivery_drivers', 'distribution', 'logistics'] },
    { label: 'Inventory & Stock', icon: '📦', ids: ['store_stock', 'warehouse_stock', 'supplier_orders', 'costings', 'wastage'] },
    { label: 'Kitchen', icon: '🍳', ids: ['kitchen_flow', 'kitchen_stations'] },
    { label: 'Marketing & Campaigns', icon: '📣', ids: ['promotions', 'push_notifications', 'email_campaigns', 'sms_campaigns'] },
    { label: 'Loyalty & Engagement', icon: '💰', ids: ['loyalty', 'engagement'] },
    { label: 'Customer Service', icon: '👥', ids: ['customer_comms'] },
    { label: 'Staffing & HR', icon: '👷', ids: ['rotas', 'attendance', 'staff_stations', 'performance'] },
    { label: 'Accounting & Reports', icon: '📊', ids: ['payments', 'reports', 'accounts'] },
];

const fallbackSnap: Snapshot = {
    summary: 'Tilly is standing by for a live operational brief.',
    speaking: 'Click the orb or type a command to start talking to your business.',
    actions: [{ id: 'a0', title: 'Ready for first instruction', status: 'pending', domain: 'control', detail: 'Send a prompt or click Run Demo to see the full experience.' }],
    panels: [
        { id: 'delivery_drivers', label: 'Delivery Drivers', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'distribution', label: 'Distribution', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'logistics', label: 'Logistics Overview', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'store_stock', label: 'Store Stock', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'warehouse_stock', label: 'Warehouse Stock', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'supplier_orders', label: 'Supplier Orders', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'costings', label: 'Costings', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'wastage', label: 'Wastage', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'kitchen_flow', label: 'Kitchen Flow', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'kitchen_stations', label: 'Stations', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'promotions', label: 'Promotions', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'push_notifications', label: 'Push Notifications', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'email_campaigns', label: 'Email Campaigns', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'sms_campaigns', label: 'SMS Campaigns', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'loyalty', label: 'Loyalty', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'engagement', label: 'Games & Incentives', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'customer_comms', label: 'Customer Comms', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'rotas', label: 'Rotas & Schedules', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'attendance', label: 'Attendance', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'staff_stations', label: 'Staff Stations', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'performance', label: 'Performance', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'payments', label: 'Payments', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'reports', label: 'Reports', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
        { id: 'accounts', label: 'Accounts', value: '—', detail: 'Awaiting data', tone: 'stable', metric: '—' },
    ],
    heroStats: [
        { id: 'cov', label: 'Domains', value: '8 areas • 24 panels' },
        { id: 'risk', label: 'Risks', value: '—' },
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
    const [flashPanels, setFlashPanels] = useState<Set<string>>(new Set());
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('tilly-theme') as 'dark' | 'light') ?? 'dark');
    const [activeViz, setActiveViz] = useState<{id: string; tool: string; ts: number; args: Record<string, string>}[]>([]);
    const seenActionIds = useRef<Set<string>>(new Set());

    // Live state
    const [liveState, setLiveState] = useState<string>('idle');
    const [liveIn, setLiveIn] = useState('');
    const [liveOut, setLiveOut] = useState('');
    const [liveMuted, setLiveMuted] = useState(false);
    const [liveTx, setLiveTx] = useState<{id: string; role: 'operator' | 'tilly'; text: string}[]>([]);

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
    const playCtxRef = useRef<AudioContext | null>(null);
    const playNextTimeRef = useRef(0);
    const playingRef = useRef(false);
    const speakEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const railScrollRef = useRef<HTMLDivElement | null>(null);
    const prevSnapRef = useRef<Snapshot>(fallbackSnap);
    const stoppedRef = useRef(false);

    // ── Theme init ──
    useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

    // ── Init ──
    useEffect(() => {
        Promise.all([
            fetch(`${API}/api/config`).then(r => r.json()),
            fetch(`${API}/api/scenario/reset`, { method: 'POST' }).then(r => r.json())
        ]).then(([c, s]) => {
            const config = c as ConfigResponse;
            setCfg(config);
            setMode('live');
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
            // Auto-expand accordion groups containing changed panels
            const groupsToOpen = new Set<string>();
            for (const g of PANEL_GROUPS) {
                if (g.ids.some(id => changed.has(id))) groupsToOpen.add(g.label);
            }
            if (groupsToOpen.size > 0) {
                setExpandedGroups(prev => new Set([...prev, ...groupsToOpen]));
            }
        }
        prevSnapRef.current = snap;
    }, [snap]);

    // Auto-scroll rail
    useEffect(() => {
        railScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [snap.actions]);

    // Auto-clear old viz cards
    useEffect(() => {
        if (activeViz.length === 0) return;
        const timer = setTimeout(() => {
            const now = Date.now();
            setActiveViz(prev => prev.filter(v => now - v.ts < 8000));
        }, 8000);
        return () => clearTimeout(timer);
    }, [activeViz]);

    // ── SSE ──
    function openES() {
        if (esRef.current) return;
        const es = new EventSource(`${API}/api/live/events`);
        es.onmessage = (ev) => {
            const p = JSON.parse(ev.data) as LiveStreamEvent;
            if (p.type === 'live_status') {
                setLiveState(p.status);
                if (p.status === 'speaking') setSpeaking(true);
                if (p.status === 'disconnected') setSpeaking(false);
            }
            else if (p.type === 'input_transcript') { if (p.final) { setLiveIn(p.text); setInterim(''); setLiveTx(prev => [...prev, { id: `i${Date.now()}`, role: 'operator', text: p.text }]); } else { setInterim(p.text); } }
            else if (p.type === 'output_transcript') { setLiveOut(p.text); if (p.final) { setLiveTx(prev => [...prev, { id: `o${Date.now()}`, role: 'tilly', text: p.text }]); } }
            else if (p.type === 'output_text') setLiveOut(cur => p.text.length > cur.length ? p.text : cur);
            else if (p.type === 'model_audio') { qRef.current.push({ data: p.data, mimeType: p.mimeType }); playQ(); }
            else if (p.type === 'turn_complete') {
                if (p.inputText) setLiveTx(prev => [...prev, { id: `i${Date.now()}`, role: 'operator', text: p.inputText }]);
                if (p.outputText) setLiveTx(prev => [...prev, { id: `o${Date.now()}`, role: 'tilly', text: p.outputText }]);
            }
            else if (p.type === 'live_error') { setErr(p.message); setLiveState('disconnected'); }
            else if (p.type === 'snapshot') {
                // Detect new actions for viz
                const newActions = p.snapshot.actions.filter(a => !seenActionIds.current.has(a.id));
                for (const a of newActions) {
                    seenActionIds.current.add(a.id);
                    // Map action to tool via title then domain
                    let tool = '';
                    const t = a.title.toLowerCase();
                    if (t.includes('push') || t.includes('qr')) tool = 'send_marketing_push';
                    else if (t.includes('reorder') || t.includes('supplier')) tool = 'reorder_supplier_item';
                    else if (t.includes('route') || t.includes('optimi')) tool = 'optimise_driver_routes';
                    else if (t.includes('email campaign')) tool = 'send_email_campaign';
                    else if (t.includes('sms campaign')) tool = 'send_sms_campaign';
                    else if (t.includes('report')) tool = 'generate_report';
                    else if (t.includes('distribution')) tool = 'check_distribution_status';
                    else if (t.includes('warehouse')) tool = 'check_warehouse_stock';
                    else if (t.includes('costing')) tool = 'check_costings';
                    else if (t.includes('wastage')) tool = 'check_wastage';
                    else if (t.includes('kitchen station')) tool = 'check_kitchen_stations';
                    else if (t.includes('engagement') || t.includes('game')) tool = 'check_engagement';
                    else if (t.includes('rota') || t.includes('schedule')) tool = 'check_rotas';
                    else if (t.includes('staff station')) tool = 'check_staff_stations';
                    else if (t.includes('performance')) tool = 'check_performance';
                    else if (t.includes('payment')) tool = 'check_payments';
                    else if (t.includes('account')) tool = 'check_accounts';
                    else {
                        const domainMap: Record<string, string> = {
                            delivery_drivers: 'check_driver_status', customer_comms: 'send_customer_apology',
                            loyalty: 'add_loyalty_points', store_stock: 'check_inventory_status',
                            kitchen_flow: 'halt_kitchen_item', promotions: 'draft_promo',
                            attendance: 'record_attendance_note', logistics: 'optimise_driver_routes',
                            push_notifications: 'send_marketing_push', supplier_orders: 'reorder_supplier_item',
                            distribution: 'check_distribution_status', warehouse_stock: 'check_warehouse_stock',
                            costings: 'check_costings', wastage: 'check_wastage',
                            kitchen_stations: 'check_kitchen_stations', email_campaigns: 'send_email_campaign',
                            sms_campaigns: 'send_sms_campaign', engagement: 'check_engagement',
                            rotas: 'check_rotas', staff_stations: 'check_staff_stations',
                            performance: 'check_performance', payments: 'check_payments',
                            reports: 'generate_report', accounts: 'check_accounts',
                        };
                        tool = domainMap[a.domain] ?? '';
                    }
                    if (tool) setActiveViz(prev => [...prev, { id: a.id, tool, ts: Date.now(), args: (a as any).args ?? {} }]);
                }
                setSnap(p.snapshot); setStatus('ok');
            }
        };
        es.onerror = () => setLiveState('disconnected');
        esRef.current = es;
    }
    function closeES() { esRef.current?.close(); esRef.current = null; }

    // ── Audio Playback (raw PCM from Gemini Live) ──
    function getPlayCtx(sampleRate: number) {
        if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
            playCtxRef.current = new (window.AudioContext ?? window.webkitAudioContext!)({ sampleRate });
            playNextTimeRef.current = 0;
        }
        return playCtxRef.current;
    }

    function drainAudioQ() {
        qRef.current = [];
        playingRef.current = false;
        playNextTimeRef.current = 0;
        if (playCtxRef.current && playCtxRef.current.state !== 'closed') {
            playCtxRef.current.close().catch(() => {});
            playCtxRef.current = null;
        }
        setSpeaking(false);
    }

    function playQ() {
        if (liveMuted) return;
        const c = qRef.current.shift();
        if (!c) {
            playingRef.current = false;
            // Debounce: only mark as not speaking if no new audio arrives within 3s
            if (!speakEndTimer.current) {
                speakEndTimer.current = setTimeout(() => {
                    speakEndTimer.current = null;
                    if (!playingRef.current) setSpeaking(false);
                }, 3000);
            }
            return;
        }
        // Cancel any pending "stop speaking" timer
        if (speakEndTimer.current) { clearTimeout(speakEndTimer.current); speakEndTimer.current = null; }
        playingRef.current = true; setSpeaking(true);
        try {
            const bin = atob(c.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
            const rateMatch = c.mimeType.match(/rate=(\d+)/);
            const outSr = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
            const ctx = getPlayCtx(outSr);
            const abuf = ctx.createBuffer(1, float32.length, outSr);
            abuf.getChannelData(0).set(float32);
            const src = ctx.createBufferSource();
            src.buffer = abuf;
            src.connect(ctx.destination);
            // Schedule seamlessly after last chunk
            const now = ctx.currentTime;
            const startAt = Math.max(now, playNextTimeRef.current);
            playNextTimeRef.current = startAt + abuf.duration;
            src.onended = () => { void playQ(); };
            src.start(startAt);
        } catch (e) {
            console.error('Audio playback failed:', e);
            playingRef.current = false; setSpeaking(false); void playQ();
        }
    }

    // ── Mic ──
    async function flushBuf() {
        if (stoppedRef.current || flushingRef.current || bufCountRef.current === 0) return;
        const samples = mergeF32(bufRef.current); bufRef.current = []; bufCountRef.current = 0; flushingRef.current = true;
        const pcm16 = downsample(samples, srRef.current, TARGET_SR);
        try { await fetch(`${API}/api/live/audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: encodePCM16(pcm16), mimeType: `audio/pcm;rate=${TARGET_SR}` }) }); }
        catch { setErr('Audio send failed.'); setLiveState('disconnected'); }
        finally { flushingRef.current = false; if (!stoppedRef.current && bufCountRef.current >= FLUSH_SAMPLES) void flushBuf(); }
    }

    function pushAudio(data: Float32Array) { if (stoppedRef.current) return; const c = new Float32Array(data.length); c.set(data); bufRef.current.push(c); bufCountRef.current += c.length; if (bufCountRef.current >= FLUSH_SAMPLES) void flushBuf(); }

    async function teardown(sendStop: boolean) {
        stoppedRef.current = true;
        if (procRef.current) { procRef.current.onaudioprocess = null; procRef.current.disconnect(); }
        srcRef.current?.disconnect(); procRef.current = null; srcRef.current = null;
        flushingRef.current = false;
        streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
        if (ctxRef.current) { await ctxRef.current.close().catch(() => undefined); ctxRef.current = null; }
        bufRef.current = []; bufCountRef.current = 0;
        if (sendStop) { await fetch(`${API}/api/live/audio/stop`, { method: 'POST' }).catch(() => undefined); setLiveState('processing'); }
    }

    async function startLive() {
        openES(); setErr(''); setLiveState('connecting'); stoppedRef.current = false;
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

    async function stopLive() {
        setListening(false);
        // 1. IMMEDIATELY tell the server to close the Gemini session (non-blocking)
        //    This stops Gemini from generating any more audio output
        fetch(`${API}/api/live/session/close`, { method: 'POST' }).catch(() => {});
        // 2. Kill audio playback instantly (stops the voice)
        drainAudioQ();
        // 3. Tear down the mic/audio context
        await teardown(false);
        setLiveState('idle');
        setLiveIn(''); setLiveOut(''); setInterim('');
    }

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

    // Reset
    async function resetScenario() {
        await teardown(false); recRef.current?.stop(); setListening(false);
        setLiveIn(''); setLiveOut(''); drainAudioQ(); setLiveTx([]);
        await fetch(`${API}/api/live/session/close`, { method: 'POST' }).catch(() => {});
        const res = await fetch(`${API}/api/scenario/reset`, { method: 'POST' });
        const snapData = await res.json() as Snapshot;
        setSnap(snapData);
        setStatus('ok'); setErr(''); setLiveState('idle'); setInterim('');
        setActiveViz([]); seenActionIds.current.clear();
    }

    // ── Voice ──
    function toggleSpeech() {
        if (speaking) { drainAudioQ(); return; }
        if (liveMuted) { setLiveMuted(false); return; }
        setLiveMuted(true); drainAudioQ();
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
        if (listening || liveState === 'capturing' || liveState === 'connecting') {
            drainAudioQ();
            void stopLive();
            return;
        }
        void startLive();
    }

    // Determine the real conversational state
    const isLive = listening || ['capturing', 'connected', 'waiting', 'speaking', 'interrupted', 'processing'].includes(liveState);
    // Processing = user has spoken (liveIn is set), Tilly hasn't started her audio response yet
    const isProcessing = isLive && !speaking && liveIn.length > 0 && liveState === 'waiting';
    // Acting = server is executing tools after a completed turn
    const isActing = liveState === 'processing';
    const orbState = speaking ? 'speaking' : isActing ? 'acting' : isProcessing ? 'processing' : isLive ? 'listening' : 'idle';
    const orbTag = orbState === 'speaking' ? '◉ Tilly is speaking' : orbState === 'acting' ? '⚡ Taking action' : orbState === 'processing' ? '◌ Processing' : orbState === 'listening' ? '● Listening' : '○ Click to talk';
    const dotClass = status === 'off' ? 'offline' : isLive ? 'running' : '';
    const statusText = !isLive ? 'Ready' : speaking ? 'Speaking' : isActing ? 'Acting' : isProcessing ? 'Processing' : 'Listening';

    return (
        <main className="shell">
            {/* ── Top Bar ── */}
            <header className="topBar">
                <div className="topBarLeft">
                    <div className="topBarLogo">Tilly <span>Live Ops</span></div>
                    <span className={`statusDot ${dotClass}`} />
                    <span className="statusLabel">{statusText}</span>
                </div>
                <div className="topBarRight">
                    <button className="resetBtn" onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem('tilly-theme', next); }} title="Toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
                    <button className="resetBtn" onClick={() => void resetScenario()}>Reset</button>
                </div>
            </header>

            {/* ── Stage ── */}
            <section className="stage">
                {/* Left — Panels */}
                <div className="panelCol">
                    {PANEL_GROUPS.map(group => {
                        const isOpen = expandedGroups.has(group.label);
                        const groupPanels = group.ids.map(id => snap.panels.find(p => p.id === id)).filter(Boolean) as PanelState[];
                        const hasActivity = groupPanels.some(p => p.value !== '—');
                        const hasFlash = groupPanels.some(p => flashPanels.has(p.id));
                        return (
                            <div key={group.label} className={`panelGroup ${isOpen ? 'open' : ''} ${hasFlash ? 'groupFlash' : ''}`}>
                                <button
                                    className={`panelGroupHeader ${hasActivity ? 'active' : ''}`}
                                    onClick={() => setExpandedGroups(prev => {
                                        const next = new Set(prev);
                                        if (next.has(group.label)) next.delete(group.label);
                                        else next.add(group.label);
                                        return next;
                                    })}
                                >
                                    <span className="pgIcon">{group.icon}</span>
                                    <span className="pgLabel">{group.label}</span>
                                    {hasActivity && <span className="pgDot" />}
                                    <span className={`pgChevron ${isOpen ? 'open' : ''}`}>›</span>
                                </button>
                                <div className={`panelGroupBody ${isOpen ? 'open' : ''}`}>
                                    {groupPanels.map(p => (
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
                            </div>
                        );
                    })}
                </div>

                {/* Centre — Orb + Action Stage */}
                <div className={`centre ${isLive ? 'active' : ''}`}>
                    <div className="orbSpacer" />
                    <div className="orbArea">
                        <div className="orbWrap" onClick={toggleVoice}>
                            <div className="halo" />
                            <div className="ring ring1" />
                            <div className="ring ring2" />
                            <div className="ring ring3" />
                            <div className={`orb ${orbState}`} />
                        </div>
                        <div className={`orbTag ${orbState !== 'idle' ? 'on' : ''}`}>{orbTag}</div>
                    </div>
                    <div className="orbSpacer" />

                    {/* Action Visualization Stage */}
                    {isLive && activeViz.length > 0 && (
                        <div className="actionStage">
                            {activeViz.map((v, vi) => {
                                const age = Date.now() - v.ts;
                                const exiting = age > 7000;
                                switch (v.tool) {
                                    case 'check_driver_status':
                                        return (
                                            <div key={v.id} className={`vizCard viz-drivers ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🚗</span>
                                                    <span className="vizTitle">Driver Status Scan</span>
                                                    <span className="vizStatus">Live</span>
                                                </div>
                                                <div className="driverList">
                                                    {[
                                                        { name: 'Marcus K.', status: 'ok', eta: 'On time', route: 'Route A' },
                                                        { name: 'Jade W.', status: 'delayed', eta: '+15 min', route: 'Route B' },
                                                        { name: 'Tom H.', status: 'ok', eta: 'On time', route: 'Route C' },
                                                        { name: 'Priya S.', status: 'ok', eta: 'On time', route: 'Route D' },
                                                    ].map((d, i) => (
                                                        <div key={d.name} className="driverRow" style={{ animationDelay: `${200 + i * 120}ms` }}>
                                                            <span className={`driverDot ${d.status}`} />
                                                            <span className="driverName">{d.name}</span>
                                                            <span className="driverEta">{d.eta}</span>
                                                            <span className="driverRoute">{d.route}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_inventory_status':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📦</span>
                                                    <span className="vizTitle">Stock Level Scan</span>
                                                    <span className="vizStatus">Alert</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'Fresh Dough', pct: 18, level: 'critical', val: '20 ptns' },
                                                        { label: 'Cheese', pct: 72, level: 'healthy', val: '8.2 kg' },
                                                        { label: 'Pepperoni', pct: 55, level: 'healthy', val: '4.8 kg' },
                                                        { label: 'Dark Beans', pct: 30, level: 'low', val: '3 bags' },
                                                        { label: 'Paper Roll', pct: 45, level: 'low', val: '6 rolls' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'halt_kitchen_item':
                                        return (
                                            <div key={v.id} className={`vizCard viz-kitchen ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🍳</span>
                                                    <span className="vizTitle">Kitchen Override</span>
                                                    <span className="vizStatus">Blocked</span>
                                                </div>
                                                <div className="kitchenItem">
                                                    <span style={{ fontSize: '1.4rem' }}>🚫</span>
                                                    <span className="kitchenItemName">{v.args.item || 'Menu item'}</span>
                                                    <span className="kitchenStamp">HALTED</span>
                                                </div>
                                                <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                                                    {v.args.detail || `${v.args.item || 'Item'} prep paused to protect throughput.`}
                                                </div>
                                            </div>
                                        );
                                    case 'draft_promo':
                                        return (
                                            <div key={v.id} className={`vizCard viz-promo ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📣</span>
                                                    <span className="vizTitle">Campaign Builder</span>
                                                    <span className="vizStatus">Drafting</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoHeadline">{v.args.campaign || v.args.item || 'Promotion'}</div>
                                                    <div className="promoOffer">{v.args.pct ? `${v.args.pct} OFF` : 'OFFER STAGED'}</div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">Campaign draft</span>
                                                        {v.args.item && <span className="promoTag">{v.args.item}</span>}
                                                        <span className="promoTag">In-app</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'send_marketing_push':
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📱</span>
                                                    <span className="vizTitle">Push Broadcast</span>
                                                    <span className="vizStatus">Sent</span>
                                                </div>
                                                <div className="pushPhone">
                                                    <div className="pushNotif">
                                                        <div className="pushApp">TillTech App</div>
                                                        <div className="pushText">{v.args.pct ? `${v.args.pct} off ` : ''}{v.args.item || v.args.campaign || 'Special offer'} — {v.args.code ? `Use code ${v.args.code}` : 'Limited time only'}</div>
                                                    </div>
                                                </div>
                                                <div className="pushRecipients">{v.args.recipients || '1,200'}</div>
                                                <div className="pushRecLabel">Recipients reached</div>
                                            </div>
                                        );
                                    case 'send_customer_apology':
                                        return (
                                            <div key={v.id} className={`vizCard viz-sms ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">💬</span>
                                                    <span className="vizTitle">SMS Dispatch</span>
                                                    <span className="vizStatus">Delivered</span>
                                                </div>
                                                <div className="smsBubble">
                                                    <div className="smsText">Hi, we're sorry your order is running a little late. Your driver is on the way and we've added bonus loyalty points to say thanks for your patience! 🙏</div>
                                                </div>
                                                <div className="smsTo">To: Customer #4829 → +44 7*** ***82</div>
                                            </div>
                                        );
                                    case 'add_loyalty_points':
                                        return (
                                            <div key={v.id} className={`vizCard viz-loyalty ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">⭐</span>
                                                    <span className="vizTitle">Loyalty Credit</span>
                                                    <span className="vizStatus">Applied</span>
                                                </div>
                                                <div className="loyaltyWallet">
                                                    <div>
                                                        <div className="loyaltyPoints">+{v.args.points || '250'}</div>
                                                        <div className="loyaltyLabel">Bonus points added</div>
                                                    </div>
                                                    <div style={{ flex: 1, textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                                                        Customer wallet updated
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'record_attendance_note':
                                        return (
                                            <div key={v.id} className={`vizCard viz-staff ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">👥</span>
                                                    <span className="vizTitle">Staff Log</span>
                                                    <span className="vizStatus">Recorded</span>
                                                </div>
                                                <div className="staffRow">
                                                    <div className="staffAvatar">👤</div>
                                                    <div className="staffInfo">
                                                        <div className="staffName">{v.args.name || 'Staff member'}</div>
                                                        <div className="staffTime">{v.args.time ? `${v.args.time} late` : 'Late arrival recorded'}</div>
                                                    </div>
                                                    <span className="staffFlag">{v.args.time ? `${v.args.time} late` : 'Late'}</span>
                                                </div>
                                            </div>
                                        );
                                    case 'reorder_supplier_item':
                                        return (
                                            <div key={v.id} className={`vizCard viz-supplier ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📋</span>
                                                    <span className="vizTitle">Supplier Order</span>
                                                    <span className="vizStatus">Drafted</span>
                                                </div>
                                                <div className="supplierOrder">
                                                    <div className="supplierItem">{v.args.item || 'Stock item'}</div>
                                                    <div className="supplierMeta">
                                                        <span>Reorder placed</span>
                                                        <span>•</span>
                                                        <span>Primary supplier</span>
                                                    </div>
                                                    <span className="supplierTag">PO Ready</span>
                                                </div>
                                            </div>
                                        );
                                    case 'optimise_driver_routes':
                                        return (
                                            <div key={v.id} className={`vizCard viz-routes ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🗺️</span>
                                                    <span className="vizTitle">Route Optimiser</span>
                                                    <span className="vizStatus">Optimised</span>
                                                </div>
                                                <div className="routeCompare">
                                                    <div className="routeBox" style={{ animationDelay: '200ms' }}>
                                                        <div className="routeLabel">Before</div>
                                                        <div className="routeTime before">68 min</div>
                                                    </div>
                                                    <div className="routeBox" style={{ animationDelay: '400ms' }}>
                                                        <div className="routeLabel">After</div>
                                                        <div className="routeTime after">23 min</div>
                                                    </div>
                                                </div>
                                                <div className="routeSaved">⚡ {v.args.time || '45 minutes'} saved across active routes</div>
                                            </div>
                                        );
                                    case 'check_distribution_status':
                                        return (
                                            <div key={v.id} className={`vizCard viz-drivers ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🚛</span>
                                                    <span className="vizTitle">Distribution Fleet</span>
                                                    <span className="vizStatus">Live</span>
                                                </div>
                                                <div className="driverList">
                                                    {[
                                                        { name: 'Van 01', status: 'ok', eta: 'En route', route: 'Warehouse → Store 3' },
                                                        { name: 'Van 02', status: 'ok', eta: 'Loading', route: 'Central Kitchen' },
                                                        { name: 'Van 03', status: 'delayed', eta: '+25 min', route: 'Warehouse → Store 7' },
                                                    ].map((d, i) => (
                                                        <div key={d.name} className="driverRow" style={{ animationDelay: `${200 + i * 120}ms` }}>
                                                            <span className={`driverDot ${d.status}`} />
                                                            <span className="driverName">{d.name}</span>
                                                            <span className="driverEta">{d.eta}</span>
                                                            <span className="driverRoute">{d.route}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_warehouse_stock':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🏭</span>
                                                    <span className="vizTitle">Warehouse Stock</span>
                                                    <span className="vizStatus">Checked</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'Flour (bulk)', pct: 82, level: 'healthy', val: '14 sacks' },
                                                        { label: 'Tomato Sauce', pct: 65, level: 'healthy', val: '40 tins' },
                                                        { label: 'Cheese (bulk)', pct: 22, level: 'critical', val: '8 kg' },
                                                        { label: 'Packaging', pct: 48, level: 'low', val: '200 units' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_costings':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">💷</span>
                                                    <span className="vizTitle">Costings</span>
                                                    <span className="vizStatus">Analysed</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: v.args.item || 'Loaded Fries', pct: 68, level: 'healthy', val: 'GP 68%' },
                                                        { label: 'Food cost', pct: 28, level: 'low', val: '£1.12' },
                                                        { label: 'Packaging', pct: 8, level: 'healthy', val: '£0.15' },
                                                        { label: 'Sell price', pct: 100, level: 'healthy', val: '£4.95' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_wastage':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🗑️</span>
                                                    <span className="vizTitle">Wastage Report</span>
                                                    <span className="vizStatus">Today</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'Prep waste', pct: 15, level: 'healthy', val: '2.1 kg' },
                                                        { label: 'Expired stock', pct: 35, level: 'low', val: '£18.40' },
                                                        { label: 'Customer returns', pct: 8, level: 'healthy', val: '3 items' },
                                                        { label: 'Daily target', pct: 58, level: 'low', val: '58% used' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_kitchen_stations':
                                        return (
                                            <div key={v.id} className={`vizCard viz-staff ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🍳</span>
                                                    <span className="vizTitle">Kitchen Stations</span>
                                                    <span className="vizStatus">Live</span>
                                                </div>
                                                <div className="driverList">
                                                    {[
                                                        { name: 'Grill', status: 'ok', eta: 'Marcus K.', route: 'Active' },
                                                        { name: 'Fryer', status: 'ok', eta: 'Jade W.', route: 'Active' },
                                                        { name: 'Expediting', status: 'ok', eta: 'Tom H.', route: 'Active' },
                                                        { name: 'Prep', status: 'delayed', eta: 'Unstaffed', route: 'Gap' },
                                                    ].map((d, i) => (
                                                        <div key={d.name} className="driverRow" style={{ animationDelay: `${200 + i * 120}ms` }}>
                                                            <span className={`driverDot ${d.status}`} />
                                                            <span className="driverName">{d.name}</span>
                                                            <span className="driverEta">{d.eta}</span>
                                                            <span className="driverRoute">{d.route}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'send_email_campaign':
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📧</span>
                                                    <span className="vizTitle">Email Campaign</span>
                                                    <span className="vizStatus">Sent</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoHeadline">{v.args.campaign || v.args.subject || 'Email Campaign'}</div>
                                                    <div className="promoOffer">📬 DISPATCHED</div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">Email</span>
                                                        <span className="promoTag">4,200 recipients</span>
                                                        <span className="promoTag">Mailing list</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'send_sms_campaign':
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">💬</span>
                                                    <span className="vizTitle">SMS Campaign</span>
                                                    <span className="vizStatus">Sent</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoHeadline">{v.args.campaign || v.args.message || 'SMS Blast'}</div>
                                                    <div className="promoOffer">📱 DISPATCHED</div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">SMS</span>
                                                        <span className="promoTag">2,800 recipients</span>
                                                        <span className="promoTag">Customer DB</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'check_engagement':
                                        return (
                                            <div key={v.id} className={`vizCard viz-loyalty ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🎮</span>
                                                    <span className="vizTitle">Games & Incentives</span>
                                                    <span className="vizStatus">Active</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'Scratch & Win', pct: 78, level: 'healthy', val: '312 plays' },
                                                        { label: 'Prizes claimed', pct: 22, level: 'healthy', val: '68' },
                                                        { label: 'Conversion rate', pct: 45, level: 'low', val: '45%' },
                                                        { label: 'Revenue uplift', pct: 62, level: 'healthy', val: '+£840' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_rotas':
                                        return (
                                            <div key={v.id} className={`vizCard viz-staff ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📅</span>
                                                    <span className="vizTitle">Rotas & Schedules</span>
                                                    <span className="vizStatus">Checked</span>
                                                </div>
                                                <div className="driverList">
                                                    {[
                                                        { name: 'Morning', status: 'ok', eta: '4 staff', route: 'Covered ✓' },
                                                        { name: 'Afternoon', status: 'ok', eta: '5 staff', route: 'Covered ✓' },
                                                        { name: 'Evening', status: 'delayed', eta: '2 staff', route: '1 Gap ⚠' },
                                                        { name: 'Close', status: 'ok', eta: '2 staff', route: 'Covered ✓' },
                                                    ].map((d, i) => (
                                                        <div key={d.name} className="driverRow" style={{ animationDelay: `${200 + i * 120}ms` }}>
                                                            <span className={`driverDot ${d.status}`} />
                                                            <span className="driverName">{d.name}</span>
                                                            <span className="driverEta">{d.eta}</span>
                                                            <span className="driverRoute">{d.route}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_staff_stations':
                                        return (
                                            <div key={v.id} className={`vizCard viz-staff ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📍</span>
                                                    <span className="vizTitle">Staff Stations</span>
                                                    <span className="vizStatus">Live</span>
                                                </div>
                                                <div className="driverList">
                                                    {[
                                                        { name: 'Till 1', status: 'ok', eta: 'Sarah M.', route: 'Front of house' },
                                                        { name: 'Till 2', status: 'ok', eta: 'Alex K.', route: 'Front of house' },
                                                        { name: 'Kitchen', status: 'ok', eta: 'Marcus K.', route: 'Back of house' },
                                                        { name: 'Drive-thru', status: 'delayed', eta: 'Unstaffed', route: 'Gap' },
                                                    ].map((d, i) => (
                                                        <div key={d.name} className="driverRow" style={{ animationDelay: `${200 + i * 120}ms` }}>
                                                            <span className={`driverDot ${d.status}`} />
                                                            <span className="driverName">{d.name}</span>
                                                            <span className="driverEta">{d.eta}</span>
                                                            <span className="driverRoute">{d.route}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_performance':
                                        return (
                                            <div key={v.id} className={`vizCard viz-staff ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📈</span>
                                                    <span className="vizTitle">Performance</span>
                                                    <span className="vizStatus">Reviewed</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: v.args.name || 'Overall', pct: 85, level: 'healthy', val: '85%' },
                                                        { label: 'Punctuality', pct: 72, level: 'low', val: '72%' },
                                                        { label: 'Speed', pct: 91, level: 'healthy', val: '91%' },
                                                        { label: 'Consistency', pct: 68, level: 'low', val: '68%' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'check_payments':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">💳</span>
                                                    <span className="vizTitle">Payment Status</span>
                                                    <span className="vizStatus">Live</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'Card (Stripe)', pct: 92, level: 'healthy', val: '£2,840' },
                                                        { label: 'Cash', pct: 15, level: 'healthy', val: '£420' },
                                                        { label: 'Apple Pay', pct: 38, level: 'healthy', val: '£1,120' },
                                                        { label: 'Failures', pct: 2, level: 'healthy', val: '0 today' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    case 'generate_report':
                                        return (
                                            <div key={v.id} className={`vizCard viz-routes ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📊</span>
                                                    <span className="vizTitle">Report Generator</span>
                                                    <span className="vizStatus">Ready</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoHeadline">{v.args.type || 'Sales Summary'}</div>
                                                    <div className="promoOffer">📄 GENERATED</div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">Today's data</span>
                                                        <span className="promoTag">Auto-compiled</span>
                                                        <span className="promoTag">PDF ready</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'check_accounts':
                                        return (
                                            <div key={v.id} className={`vizCard viz-inventory ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <div className="vizHead">
                                                    <span className="vizIcon">🧾</span>
                                                    <span className="vizTitle">Accounts Overview</span>
                                                    <span className="vizStatus">Checked</span>
                                                </div>
                                                <div className="stockBars">
                                                    {[
                                                        { label: 'VAT return', pct: 85, level: 'healthy', val: '£3,200 due' },
                                                        { label: 'Outstanding', pct: 22, level: 'healthy', val: '2 invoices' },
                                                        { label: 'This month', pct: 72, level: 'healthy', val: '£28,400' },
                                                        { label: 'Margin', pct: 64, level: 'low', val: '64% avg' },
                                                    ].map((s, i) => (
                                                        <div key={s.label} className="stockRow" style={{ animationDelay: `${200 + i * 100}ms` }}>
                                                            <span className="stockLabel">{s.label}</span>
                                                            <div className="stockBarTrack">
                                                                <div className={`stockBarFill ${s.level}`} style={{ width: `${s.pct}%`, animationDelay: `${300 + i * 100}ms` }} />
                                                            </div>
                                                            <span className="stockVal">{s.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    default:
                                        return null;
                                }
                            })}
                        </div>
                    )}
                </div>

                {/* Right — Actions */}
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
                </aside>
            </section>


            {err && <span className="errMsg" style={{ padding: '0.5rem 1rem' }}>{err}</span>}
        </main>
    );
}
