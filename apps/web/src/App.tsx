import { KeyboardEvent, useEffect, useRef, useState } from 'react';

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

type ActionItem = { id: string; title: string; status: 'done' | 'pending' | 'draft'; domain: string; detail: string; args?: Record<string, string> };
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
type WidgetStatePayload = { tool: string; title: string; summary: string; facts: string[]; args: Record<string, string> };

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const FLUSH_SAMPLES = 2048;



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
    const [err, setErr] = useState('');
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [speaking, setSpeaking] = useState(false);
    const [flashPanels, setFlashPanels] = useState<Set<string>>(new Set());
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('tilly-theme') as 'dark' | 'light') ?? 'dark');
    const [activeViz, setActiveViz] = useState<{id: string; tool: string; ts: number; args: Record<string, string>}[]>([]);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [showComposer, setShowComposer] = useState(false);
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
    const scheduledSourcesRef = useRef(0);
    const speakEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const micSinkRef = useRef<GainNode | null>(null);
    const railScrollRef = useRef<HTMLDivElement | null>(null);
    const promptInputRef = useRef<HTMLInputElement | null>(null);
    const prevSnapRef = useRef<Snapshot>(fallbackSnap);
    const stoppedRef = useRef(false);
    const widgetSyncSeqRef = useRef(0);
    const widgetSyncClientIdRef = useRef(`client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const dismissedCheckToolsRef = useRef<Set<string>>(new Set());
    const esReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const esManualCloseRef = useRef(false);
    const greetPendingRef = useRef(false);

    const domainToolMap: Record<string, string> = {
        delivery_drivers: 'check_driver_status', customer_comms: 'send_customer_apology',
        loyalty: 'add_loyalty_points', store_stock: 'check_inventory_status',
        kitchen_flow: 'halt_kitchen_item', promotions: 'draft_promo',
        attendance: 'record_attendance_note', logistics: 'optimise_driver_routes',
        push_notifications: 'send_marketing_push', supplier_orders: 'reorder_supplier_item',
        distribution: 'check_distribution_status', warehouse_stock: 'check_warehouse_stock',
        costings: 'check_costings', wastage: 'check_wastage',
        kitchen_stations: 'check_kitchen_stations', email_campaigns: 'dispatch_email_campaign',
        sms_campaigns: 'dispatch_sms_campaign', engagement: 'check_engagement',
        rotas: 'check_rotas', staff_stations: 'check_staff_stations',
        performance: 'check_performance', payments: 'check_payments',
        reports: 'generate_report', accounts: 'check_accounts',
    };

    function resolveActionTool(action: ActionItem) {
        const t = action.title.toLowerCase();
        if (t.includes('push') || t.includes('qr')) return action.status === 'draft' ? 'draft_marketing_push' : 'dispatch_marketing_push';
        if (t.includes('reorder') || t.includes('supplier')) return 'reorder_supplier_item';
        if (t.includes('route') || t.includes('optimi')) return 'optimise_driver_routes';
        if (t.includes('email campaign')) return action.status === 'draft' ? 'draft_email_campaign' : 'dispatch_email_campaign';
        if (t.includes('sms campaign')) return action.status === 'draft' ? 'draft_sms_campaign' : 'dispatch_sms_campaign';
        if (t.includes('report')) return 'generate_report';
        if (t.includes('distribution')) return 'check_distribution_status';
        if (t.includes('warehouse')) return 'check_warehouse_stock';
        if (t.includes('costing')) return 'check_costings';
        if (t.includes('wastage')) return 'check_wastage';
        if (t.includes('kitchen station')) return 'check_kitchen_stations';
        if (t.includes('engagement') || t.includes('game')) return 'check_engagement';
        if (t.includes('rota') || t.includes('schedule')) return 'check_rotas';
        if (t.includes('staff station')) return 'check_staff_stations';
        if (t.includes('performance')) return 'check_performance';
        if (t.includes('payment')) return 'check_payments';
        if (t.includes('account')) return 'check_accounts';
        if (t.includes('clear') || t.includes('widget')) return 'clear_ui_widgets';
        return domainToolMap[action.domain] ?? '';
    }

    function isCheckTool(tool: string) {
        return tool.startsWith('check_');
    }

    function buildWidgetStatePayload(tool: string, args: Record<string, string>): WidgetStatePayload {
        switch (tool) {
            case 'check_driver_status':
                return {
                    tool,
                    title: 'Driver Status Scan',
                    summary: '4 drivers tracked, 1 delayed route.',
                    facts: [
                        'Marcus K. on Route A - on time',
                        'Jade W. on Route B - 15 minutes delayed',
                        'Tom H. on Route C - on time',
                        'Priya S. on Route D - on time'
                    ],
                    args
                };
            case 'check_inventory_status':
                return {
                    tool,
                    title: 'Stock Level Scan',
                    summary: 'Fresh Dough is below threshold at 20 portions.',
                    facts: [
                        'Fresh Dough: 20 portions (critical)',
                        'Cheese: 8.2 kg',
                        'Pepperoni: 4.8 kg',
                        'Dark Beans: 3 bags',
                        'Paper Roll: 6 rolls'
                    ],
                    args
                };
            case 'halt_kitchen_item':
                return {
                    tool,
                    title: 'Kitchen Override',
                    summary: `${args.item || 'Menu item'} prep halted.`,
                    facts: [args.detail || `${args.item || 'Menu item'} paused to protect throughput.`],
                    args
                };
            default: {
                const entries = Object.entries(args).filter(([, value]) => Boolean(value));
                return {
                    tool,
                    title: tool,
                    summary: entries.length > 0 ? entries.map(([k, v]) => `${k}: ${v}`).join(' | ') : 'Widget visible',
                    facts: entries.map(([k, v]) => `${k}: ${v}`),
                    args
                };
            }
        }
    }

    function buildVisibleWidgetPayload(items = activeViz) {
        return items.map((viz) => buildWidgetStatePayload(viz.tool, viz.args));
    }

    async function syncVisibleWidgets(items = activeViz) {
        const tools = items.map((viz) => viz.tool);
        const widgets = buildVisibleWidgetPayload(items);
        widgetSyncSeqRef.current += 1;
        const seq = widgetSyncSeqRef.current;
        try {
            await fetch(`${API}/api/live/ui/widgets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tools, widgets, seq, clientId: widgetSyncClientIdRef.current })
            });
        } catch {
            // Best-effort sync; next state update will retry.
        }
        return seq;
    }

    function upsertVizCard(
        tool: string,
        args: Record<string, string> = {},
        options?: { reorder?: boolean; allowResurrectDismissedCheck?: boolean }
    ) {
        if (!tool) return;
        const id = `viz-${tool}`;
        if (
            isCheckTool(tool) &&
            options?.allowResurrectDismissedCheck === false &&
            dismissedCheckToolsRef.current.has(tool)
        ) {
            return;
        }

        setActiveViz(prev => {
            const existing = prev.find(v => v.tool === tool);
            if (existing) {
                if (options?.reorder === false) {
                    return prev.map(v => (v.tool === tool ? { ...v, args } : v));
                }
                return [{ ...existing, args, ts: Date.now() }, ...prev.filter(v => v.tool !== tool)].slice(0, 12);
            }
            return [{ id, tool, ts: Date.now(), args }, ...prev].slice(0, 12);
        });
    }

    function removeVizTool(tool: string) {
        if (isCheckTool(tool)) {
            dismissedCheckToolsRef.current.add(tool);
        }
        setActiveViz(prev => prev.filter(v => v.tool !== tool));
    }

    function replayVizForAction(action: ActionItem) {
        const tool = resolveActionTool(action);
        if (tool === 'clear_ui_widgets') {
            setActiveViz([]);
            return;
        }
        if (isCheckTool(tool)) {
            dismissedCheckToolsRef.current.delete(tool);
        }
        upsertVizCard(tool, (action as any).args ?? {});
    }

    function replayVizForPanel(panelId: string) {
        const tool = domainToolMap[panelId] ?? '';
        if (!tool) return;
        setActiveViz(prev => {
            if (prev.some(v => v.tool === tool)) {
                if (isCheckTool(tool)) {
                    dismissedCheckToolsRef.current.add(tool);
                }
                return prev.filter(v => v.tool !== tool);
            }
            if (isCheckTool(tool)) {
                dismissedCheckToolsRef.current.delete(tool);
            }
            return [{ id: `viz-${tool}`, tool, ts: Date.now(), args: {} }, ...prev].slice(0, 12);
        });
    }

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

    // Keep server aware of exactly which stage widgets are visible.
    useEffect(() => {
        void syncVisibleWidgets(activeViz);
    }, [activeViz]);

    // Resync widget stage when live session becomes ready in case server restarted
    // while widgets were already on screen and no add/remove happened yet.
    useEffect(() => {
        if (liveState !== 'connected' && liveState !== 'waiting') {
            return;
        }
        void syncVisibleWidgets();
    }, [liveState]);

    // ── SSE ──
    function openES() {
        if (esRef.current) return;
        esManualCloseRef.current = false;
        const es = new EventSource(`${API}/api/live/events`);
        es.onopen = () => {
            if (esReconnectTimerRef.current) {
                clearTimeout(esReconnectTimerRef.current);
                esReconnectTimerRef.current = null;
            }
        };
        es.onmessage = (ev) => {
            const p = JSON.parse(ev.data) as LiveStreamEvent;
            if (p.type === 'live_status') {
                setLiveState(p.status);
                if (p.status === 'speaking') setSpeaking(true);
                if (p.status === 'disconnected') {
                    drainAudioQ();
                    setSpeaking(false);
                }
                if (p.status === 'interrupted') {
                    // Gemini interrupted prior output: clear any queued/scheduled playback from old turn.
                    drainAudioQ();
                    setSpeaking(false);
                }
                if (p.status === 'waiting') {
                    setLiveIn('');
                    setInterim('');
                }
            }
            else if (p.type === 'input_transcript') {
                if (p.final) {
                    // New operator turn started: drop any stale output chunks from the previous reply.
                    if (scheduledSourcesRef.current > 0 || qRef.current.length > 0 || playingRef.current) {
                        drainAudioQ();
                    }
                    setLiveIn(p.text);
                    setInterim('');
                    setLiveTx(prev => [...prev, { id: `i${Date.now()}`, role: 'operator', text: p.text }]);
                } else {
                    setInterim(p.text);
                }
            }
            else if (p.type === 'output_transcript') { setLiveOut(p.text); if (p.final) { setLiveTx(prev => [...prev, { id: `o${Date.now()}`, role: 'tilly', text: p.text }]); } }
            else if (p.type === 'output_text') setLiveOut(cur => p.text.length > cur.length ? p.text : cur);
            else if (p.type === 'model_audio') { qRef.current.push({ data: p.data, mimeType: p.mimeType }); playQ(); }
            else if (p.type === 'turn_complete') {
                if (p.inputText) setLiveTx(prev => [...prev, { id: `i${Date.now()}`, role: 'operator', text: p.inputText }]);
                if (p.outputText) setLiveTx(prev => [...prev, { id: `o${Date.now()}`, role: 'tilly', text: p.outputText }]);
                setLiveIn('');
                setInterim('');
                setLiveState('waiting');
            }
            else if (p.type === 'live_error') { setErr(p.message); setLiveState('disconnected'); }
            else if (p.type === 'snapshot') {
                // Detect new actions for viz
                // Snapshot actions are newest-first; replay oldest->newest for deterministic widget state.
                const newActions = p.snapshot.actions.filter(a => !seenActionIds.current.has(a.id)).reverse();
                for (const a of newActions) {
                    seenActionIds.current.add(a.id);
                    const tool = resolveActionTool(a);
                    if (tool === 'clear_ui_widgets') {
                        setActiveViz([]);
                        continue;
                    }
                    // Skip creating a new card for dispatch actions if a draft card already exists
                    // (the draft→dispatch sync below will update the existing card)
                    const draftCounterparts: Record<string, string> = {
                        dispatch_email_campaign: 'draft_email_campaign',
                        dispatch_sms_campaign: 'draft_sms_campaign',
                        dispatch_marketing_push: 'draft_marketing_push',
                        dispatch_promo: 'draft_promo',
                    };
                    const draftTool = draftCounterparts[tool];
                    if (draftTool) {
                        const hasDraftCard = activeViz.some(v => v.tool === draftTool);
                        if (hasDraftCard) continue; // let the sync handle the transition
                    }
                    if (isCheckTool(tool)) {
                        upsertVizCard(tool, (a as any).args ?? {}, {
                            reorder: false,
                            allowResurrectDismissedCheck: false
                        });
                    } else {
                        upsertVizCard(tool, (a as any).args ?? {});
                    }
                }
                
                // Sync args for currently visible cards (handles async updates like image generation)
                // Also handles tool transitions (e.g. draft_email_campaign → dispatch_email_campaign)
                setActiveViz(prev => prev.map(viz => {
                    // Try matching by resolved tool name first
                    const mappedSnapAction = p.snapshot.actions.find(a => resolveActionTool(a) === viz.tool);
                    if (mappedSnapAction && mappedSnapAction.args && JSON.stringify(mappedSnapAction.args) !== JSON.stringify(viz.args)) {
                        return { ...viz, args: { ...viz.args, ...mappedSnapAction.args } };
                    }

                    // Handle draft→dispatch transitions: check if a dispatched version exists for the same domain
                    const draftDispatchPairs: Record<string, string> = {
                        draft_email_campaign: 'dispatch_email_campaign',
                        draft_sms_campaign: 'dispatch_sms_campaign',
                        draft_marketing_push: 'dispatch_marketing_push',
                        draft_promo: 'dispatch_promo',
                    };
                    const dispatchTool = draftDispatchPairs[viz.tool];
                    if (dispatchTool) {
                        const dispatchAction = p.snapshot.actions.find(a => resolveActionTool(a) === dispatchTool);
                        if (dispatchAction) {
                            return { ...viz, tool: dispatchTool, args: { ...viz.args, ...(dispatchAction.args || {}) } };
                        }
                    }
                    return viz;
                }));

                setSnap(p.snapshot);
                setStatus('ok');
                setLiveIn('');
                setInterim('');
                setLiveState(prev => prev === 'processing' ? 'waiting' : prev);
            }
        };
        es.onerror = () => {
            if (esManualCloseRef.current) {
                return;
            }

            // Browser tab/app switches can cause transient EventSource errors.
            // Treat CONNECTING as recoverable and only reconnect on CLOSED.
            if (es.readyState === EventSource.CLOSED) {
                esRef.current = null;
                setLiveState((prev) => (prev === 'idle' ? prev : 'connecting'));
                if (esReconnectTimerRef.current) {
                    clearTimeout(esReconnectTimerRef.current);
                }
                esReconnectTimerRef.current = setTimeout(() => {
                    esReconnectTimerRef.current = null;
                    if (!esRef.current && !esManualCloseRef.current) {
                        openES();
                    }
                }, 500);
            }
        };
        esRef.current = es;
    }
    function closeES() {
        esManualCloseRef.current = true;
        if (esReconnectTimerRef.current) {
            clearTimeout(esReconnectTimerRef.current);
            esReconnectTimerRef.current = null;
        }
        esRef.current?.close();
        esRef.current = null;
    }

    // ── Audio Playback (raw PCM from Gemini Live) ──
    function getPlayCtx(sampleRate: number) {
        if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
            playCtxRef.current = new (window.AudioContext ?? window.webkitAudioContext!)({ sampleRate });
            playNextTimeRef.current = 0;
        }
        if (playCtxRef.current.state === 'suspended') void playCtxRef.current.resume();
        return playCtxRef.current;
    }

    function drainAudioQ() {
        if (speakEndTimer.current) {
            clearTimeout(speakEndTimer.current);
            speakEndTimer.current = null;
        }
        qRef.current = [];
        playingRef.current = false;
        scheduledSourcesRef.current = 0;
        playNextTimeRef.current = 0;
        if (playCtxRef.current && playCtxRef.current.state !== 'closed') {
            playCtxRef.current.close().catch(() => {});
            playCtxRef.current = null;
        }
        setSpeaking(false);
    }

    function playQ() {
        if (liveMuted) return;
        if (speakEndTimer.current) { clearTimeout(speakEndTimer.current); speakEndTimer.current = null; }

        while (qRef.current.length > 0) {
            const c = qRef.current.shift();
            if (!c) break;

            try {
                const bin = atob(c.data);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const byteLen = bytes.byteLength - (bytes.byteLength % 2);
                if (byteLen <= 0) continue;

                const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, byteLen / 2);
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

                const startAt = Math.max(ctx.currentTime, playNextTimeRef.current);
                playNextTimeRef.current = startAt + abuf.duration;

                scheduledSourcesRef.current += 1;
                playingRef.current = true;
                setSpeaking(true);
                greetPendingRef.current = false;

                src.onended = () => {
                    scheduledSourcesRef.current = Math.max(0, scheduledSourcesRef.current - 1);
                    if (scheduledSourcesRef.current === 0 && qRef.current.length === 0) {
                        if (speakEndTimer.current) clearTimeout(speakEndTimer.current);
                        speakEndTimer.current = setTimeout(() => {
                            speakEndTimer.current = null;
                            if (scheduledSourcesRef.current === 0 && qRef.current.length === 0) {
                                playingRef.current = false;
                                setSpeaking(false);
                            }
                        }, 140);
                    }
                };

                src.start(startAt);
            } catch (e) {
                console.error('Audio playback failed:', e);
            }
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
        micSinkRef.current?.disconnect();
        srcRef.current?.disconnect(); procRef.current = null; srcRef.current = null;
        micSinkRef.current = null;
        flushingRef.current = false;
        streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
        if (ctxRef.current) { await ctxRef.current.close().catch(() => undefined); ctxRef.current = null; }
        bufRef.current = []; bufCountRef.current = 0;
        if (sendStop) { await fetch(`${API}/api/live/audio/stop`, { method: 'POST' }).catch(() => undefined); setLiveState('processing'); }
    }

    async function startLive() {
        greetPendingRef.current = true;
        openES(); setErr(''); setLiveState('connecting'); stoppedRef.current = false;
        try {
            const tools = activeViz.map((viz) => viz.tool);
            const widgets = buildVisibleWidgetPayload(activeViz);
            widgetSyncSeqRef.current += 1;
            const seq = widgetSyncSeqRef.current;
            await fetch(`${API}/api/live/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ greet: true, tools, widgets, seq, clientId: widgetSyncClientIdRef.current })
            });
            await syncVisibleWidgets();
            const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            const Ctor = window.AudioContext ?? window.webkitAudioContext; const ctx = new Ctor();
            const src = ctx.createMediaStreamSource(s); const proc = ctx.createScriptProcessor(4096, 1, 1);
            const sink = ctx.createGain();
            sink.gain.value = 0;
            srRef.current = ctx.sampleRate; streamRef.current = s; ctxRef.current = ctx; srcRef.current = src; procRef.current = proc;
            micSinkRef.current = sink;
            proc.onaudioprocess = (e) => pushAudio(e.inputBuffer.getChannelData(0));
            src.connect(proc);
            proc.connect(sink);
            sink.connect(ctx.destination);
            setLiveState('capturing'); setListening(true); setLiveIn(''); setLiveOut('');
        } catch (e) {
            setListening(false);
            setLiveState('disconnected');
            const rawMsg = e instanceof Error ? e.message : 'Mic failed.';
            const permissionDenied = /denied|notallowed|permission/i.test(rawMsg);
            setErr(permissionDenied ? 'Microphone permission denied. You can type your command below.' : rawMsg);
            setShowComposer(true);
            setTimeout(() => promptInputRef.current?.focus(), 0);
            await teardown(false);
        }
    }

    async function stopLive() {
        greetPendingRef.current = false;
        setListening(false);
        drainAudioQ();
        await teardown(false);
        await fetch(`${API}/api/live/session/close`, { method: 'POST' }).catch(() => undefined);
        setLiveState('idle');
        setLiveIn('');
        setInterim('');
    }

    // ── Submit ──
    async function submitTypedPrompt(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const visibleItems = [...activeViz];
        const visibleTools = visibleItems.map((viz) => viz.tool);
        const visibleWidgets = buildVisibleWidgetPayload(visibleItems);
        const widgetClientId = widgetSyncClientIdRef.current;
        if (listening || liveState === 'capturing' || liveState === 'connecting') {
            await stopLive();
        }
        else if (liveState === 'speaking' || liveState === 'processing' || liveState === 'interrupted' || scheduledSourcesRef.current > 0 || qRef.current.length > 0 || playingRef.current) {
            // Interrupt in-flight output before starting a typed turn.
            await fetch(`${API}/api/live/session/close`, { method: 'POST' }).catch(() => undefined);
            drainAudioQ();
            setLiveState('idle');
        }
        setErr('');
        setStatus('busy');
        openES();
        setLiveIn(trimmed);
        setInterim('');
        setLiveState('waiting');
        try {
            // Ensure server has latest widget order before this turn is evaluated.
            const widgetSeq = await syncVisibleWidgets(visibleItems);
            const res = await fetch(`${API}/api/live/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: trimmed,
                    tools: visibleTools,
                    widgets: visibleWidgets,
                    seq: widgetSeq,
                    clientId: widgetClientId
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Live text send failed.');
            }
            setStatus('ok');
        } catch (e) {
            setStatus('off');
            setLiveState('disconnected');
            setErr(e instanceof Error ? e.message : 'Live text send failed.');
        }
    }

    function submitComposerPrompt() {
        const text = prompt;
        setPrompt('');
        void submitTypedPrompt(text);
    }

    function handlePromptKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        submitComposerPrompt();
    }

    function focusPromptInput() {
        if (!showComposer) {
            setShowComposer(true);
            setTimeout(() => promptInputRef.current?.focus(), 0);
            return;
        }
        promptInputRef.current?.focus();
    }

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
        dismissedCheckToolsRef.current.clear();
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
            if (finalText.trim()) { void submitTypedPrompt(finalText); setPrompt(''); }
        };
        recRef.current = rec; setErr(''); setListening(true); rec.start();
    }

    function toggleVoice() {
        if (speaking || liveState === 'speaking' || listening || liveState === 'capturing' || liveState === 'connecting') {
            drainAudioQ();
            void stopLive();
            return;
        }
        void startLive();
    }

    // Determine the real conversational state
    const isLive = listening || ['capturing', 'connected', 'waiting', 'speaking', 'interrupted', 'processing'].includes(liveState);
    const isSpeaking = speaking || liveState === 'speaking' || playingRef.current;
    
    // Connecting = User clicked start, but mic stream and WebSockets are still authenticating
    const isConnecting = liveState === 'connecting' || (liveState === 'capturing' && !listening) || (!listening && greetPendingRef.current);

    // Initial greeting period before audio plays
    const isGreeting = greetPendingRef.current && listening && !speaking;

    // Processing = user has spoken (liveIn is set), Tilly hasn't started her audio response yet
    const isProcessing = isLive && !isSpeaking && liveIn.length > 0 && liveOut.length === 0 && liveState === 'waiting';
    // Acting = server is executing tools after a completed turn
    const isActing = liveState === 'processing';
    const orbState = isConnecting ? 'connecting' : isGreeting ? 'speaking' : isSpeaking ? 'speaking' : isActing ? 'acting' : isProcessing ? 'processing' : isLive ? 'listening' : 'idle';
    const orbTag = orbState === 'speaking' ? '◉ Tilly is speaking' : orbState === 'acting' ? '⚡ Taking action' : orbState === 'processing' ? '◌ Processing' : orbState === 'connecting' ? '◌ Waking up...' : orbState === 'listening' ? '● Listening' : '○ Click to start';
    const dotClass = status === 'off' ? 'offline' : isLive || isConnecting ? 'running' : '';
    const statusText = (!isLive && !isConnecting) ? 'Ready' : isSpeaking || isGreeting ? 'Speaking' : isActing ? 'Acting' : isProcessing ? 'Processing' : orbState === 'connecting' ? 'Connecting' : 'Listening';

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
                                        <article
                                            key={p.id}
                                            className={`pCard tone-${p.tone} ${flashPanels.has(p.id) ? 'flash' : ''}`}
                                            onClick={() => replayVizForPanel(p.id)}
                                            onKeyDown={(ev) => {
                                                if (ev.key === 'Enter' || ev.key === ' ') {
                                                    ev.preventDefault();
                                                    replayVizForPanel(p.id);
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            style={{ cursor: 'pointer' }}
                                        >
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
                        <div
                            className={`orbTag ${orbState !== 'idle' ? 'on' : ''}`}
                            onClick={focusPromptInput}
                            onKeyDown={(ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                    ev.preventDefault();
                                    focusPromptInput();
                                }
                            }}
                            role="button"
                            tabIndex={0}
                            title="Type your command"
                        >
                            {orbTag}
                        </div>
                    </div>
                    <div className="orbSpacer" />

                    {/* Action Visualization Stage */}
                    {activeViz.length > 0 && (
                        <div className="actionStage">
                            {activeViz.map((v, vi) => {
                                const exiting = false;
                                switch (v.tool) {
                                    case 'check_driver_status':
                                        return (
                                            <div key={v.id} className={`vizCard viz-drivers ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📣</span>
                                                    <span className="vizTitle">Campaign Builder</span>
                                                    <span className="vizStatus">Staged</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoOffer" style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                                        {v.args.pct ? `${v.args.pct} OFF` : '🔥 OFFER STAGED'}
                                                    </div>
                                                    <div className="promoHeadline" style={{ marginTop: 4, marginBottom: 8 }}>
                                                        {v.args.campaign || v.args.item || 'Promotional Campaign'}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 10 }}>
                                                        {v.args.pct
                                                            ? `Strong value offer — ${v.args.pct} discount should drive high conversion with your customer base. Ready to push across channels.`
                                                            : 'Campaign drafted from operational context. Ready to push to email, SMS, or in-app channels.'}
                                                    </div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">Campaign Draft</span>
                                                        {v.args.item && <span className="promoTag">{v.args.item}</span>}
                                                        <span className="promoTag">Ready</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    case 'send_marketing_push':
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                    case 'draft_email_campaign':
                                    case 'dispatch_email_campaign': {
                                        const isDraft = v.tool === 'draft_email_campaign';
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
                                                <div className="vizHead">
                                                    <span className="vizIcon">📧</span>
                                                    <span className="vizTitle">Email Campaign</span>
                                                    <span className="vizStatus">{isDraft ? 'Draft' : 'Sent'}</span>
                                                </div>
                                                <div className="promoCard">
                                                    {v.args.imageUrl ? (
                                                        <img
                                                            src={v.args.imageUrl}
                                                            alt="Email campaign preview"
                                                            onClick={() => setLightboxUrl(v.args.imageUrl)}
                                                            style={{
                                                                width: '100%',
                                                                maxHeight: 360,
                                                                objectFit: 'contain',
                                                                borderRadius: 8,
                                                                marginBottom: 8,
                                                                border: '1px solid var(--glass-border)',
                                                                background: 'var(--surface-sunken)',
                                                                cursor: 'zoom-in',
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="promoImagePlaceholder" style={{
                                                            width: '100%', height: 160, borderRadius: 8, marginBottom: 8,
                                                            background: 'var(--surface-sunken)', border: '1px dashed var(--border)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            color: 'var(--text-dim)', fontSize: '0.8rem',
                                                            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                                                            textAlign: 'center', padding: '0 10px'
                                                        }}>
                                                            ✨ Generating Email Preview...
                                                        </div>
                                                    )}
                                                    <div className="promoHeadline">{v.args.campaign || v.args.subject || 'Email Campaign'}</div>
                                                    <div className="promoOffer" style={{ color: isDraft ? 'var(--text-dim)' : undefined }}>
                                                        {isDraft ? '⏳ AWAITING APPROVAL' : '📬 DISPATCHED'}
                                                    </div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">Email</span>
                                                        <span className="promoTag">4,200 recipients</span>
                                                        <span className="promoTag">Mailing list</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    case 'draft_sms_campaign':
                                    case 'dispatch_sms_campaign': {
                                        const isDraft = v.tool === 'draft_sms_campaign';
                                        return (
                                            <div key={v.id} className={`vizCard viz-push ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
                                                <div className="vizHead">
                                                    <span className="vizIcon">💬</span>
                                                    <span className="vizTitle">SMS Campaign</span>
                                                    <span className="vizStatus">{isDraft ? 'Draft' : 'Sent'}</span>
                                                </div>
                                                <div className="promoCard">
                                                    <div className="promoHeadline">{v.args.campaign || v.args.message || 'SMS Blast'}</div>
                                                    <div className="promoOffer" style={{ color: isDraft ? 'var(--text-dim)' : undefined }}>
                                                        {isDraft ? '⏳ AWAITING APPROVAL' : '📱 DISPATCHED'}
                                                    </div>
                                                    <div className="promoMeta">
                                                        <span className="promoTag">SMS</span>
                                                        <span className="promoTag">2,800 recipients</span>
                                                        <span className="promoTag">Customer DB</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    case 'check_engagement':
                                        return (
                                            <div key={v.id} className={`vizCard viz-loyalty ${exiting ? 'exiting' : ''}`} style={{ animationDelay: `${vi * 100}ms` }}>
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                                                <button className="vizCloseBtn" type="button" onClick={() => removeVizTool(v.tool)} aria-label="Close widget">x</button>
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
                            <div
                                key={a.id}
                                className={`aCard ${i === 0 && snap.actions.length > 1 ? 'fresh' : ''}`}
                                style={{ animationDelay: `${i * 80}ms`, cursor: 'pointer' }}
                                onClick={() => replayVizForAction(a)}
                                onKeyDown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault();
                                        replayVizForAction(a);
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                            >
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

            {showComposer && (
                <div className="composer">
                <button
                    className={`iconBtn ${isLive ? 'on' : ''}`}
                    type="button"
                    onClick={toggleVoice}
                    title={isLive ? 'Stop voice input' : 'Start voice input'}
                >
                    {isLive ? '■' : '●'}
                </button>
                <input
                    ref={promptInputRef}
                    className="cInput"
                    value={prompt}
                    onChange={(ev) => setPrompt(ev.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder="Type what you want Tilly to do..."
                    aria-label="Type a command for Tilly"
                />
                <button className="sendBtn" type="button" onClick={submitComposerPrompt} disabled={!prompt.trim() || status === 'busy'}>
                    Send
                </button>
                </div>
            )}

            {err && <span className="errMsg" style={{ padding: '0.5rem 1rem' }}>{err}</span>}

            {/* Lightbox modal for full-size image preview */}
            {lightboxUrl && (
                <div
                    onClick={() => setLightboxUrl(null)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setLightboxUrl(null); }}
                    tabIndex={0}
                    role="dialog"
                    aria-label="Image preview"
                    style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', animation: 'fadeIn 0.2s ease',
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setLightboxUrl(null)}
                        style={{
                            position: 'absolute', top: 16, right: 16,
                            background: 'rgba(255,255,255,0.15)', border: 'none',
                            color: '#fff', fontSize: '1.5rem', width: 40, height: 40,
                            borderRadius: '50%', cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                        }}
                        aria-label="Close preview"
                    >×</button>
                    <img
                        src={lightboxUrl}
                        alt="Full size preview"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '90vw', maxHeight: '90vh',
                            objectFit: 'contain', borderRadius: 12,
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                            cursor: 'default',
                        }}
                    />
                </div>
            )}
        </main>
    );
}




