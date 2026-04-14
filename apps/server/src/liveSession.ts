import { GoogleGenAI } from '@google/genai';
import type { AgentPlan, PlannedAction, Snapshot } from './types.js';


type TextSessionLike = {
    sendClientContent(params: unknown): void;
    close(): void;
};

type AudioSessionLike = {
    sendRealtimeInput(params: unknown): void;
    sendClientContent?: (params: any) => void;
    sendToolResponse(params: unknown): void;
    close(): void;
};

type TranscriptLike = {
    text?: string;
    finished?: boolean;
};

type InlineDataLike = {
    data?: string;
    mimeType?: string;
};

type FunctionCallLike = {
    name: string;
    args?: Record<string, unknown>;
};

type PartLike = {
    text?: string;
    inlineData?: InlineDataLike;
    functionCall?: FunctionCallLike;
};

type AudioServerMessage = {
    serverContent?: {
        turnComplete?: boolean;
        interrupted?: boolean;
        waitingForInput?: boolean;
        inputTranscription?: TranscriptLike;
        outputTranscription?: TranscriptLike;
        modelTurn?: {
            parts?: PartLike[];
        };
    };
    toolCall?: {
        functionCalls: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
    };
    toolCallCancellation?: { ids: string[] };
    setupComplete?: Record<string, unknown>;
};

export type LiveStreamEvent =
    | { type: 'live_status'; status: 'connected' | 'capturing' | 'processing' | 'speaking' | 'waiting' | 'disconnected' | 'interrupted' }
    | { type: 'input_transcript'; text: string; final: boolean }
    | { type: 'output_transcript'; text: string; final: boolean }
    | { type: 'output_text'; text: string }
    | { type: 'model_audio'; data: string; mimeType: string }
    | { type: 'turn_complete'; inputText: string; outputText: string }
    | { type: 'live_error'; message: string }
    | { type: 'function_call'; id: string; name: string; args: Record<string, unknown> };

type PendingTurn = {
    resolve: (value: AgentPlan | null) => void;
    reject: (reason?: unknown) => void;
    chunks: string[];
    timeoutId: NodeJS.Timeout;
};

type LiveWidgetPayload = {
    tool: string;
    title?: string;
    summary?: string;
    facts?: string[];
    args?: Record<string, string>;
};

const liveSubscribers = new Set<(event: LiveStreamEvent) => void>();

let textSession: TextSessionLike | null = null;
let audioSession: AudioSessionLike | null = null;
let pendingTurn: PendingTurn | null = null;
let latestInputTranscript = '';
let latestOutputTranscript = '';
let greetingQueued = false;
let greetingSentForSession = false;
let lastStateContext = '';
let visibleWidgetTools: string[] = [];
let visibleWidgetPayloads: LiveWidgetPayload[] = [];
let lastClientWidgetSeq = 0;
let lastClientWidgetClientId = '';
let audioTurnStatePrimed = false;
let latestSnapshot: Snapshot | null = null;
let liveTranscriptHistory: Array<{ role: 'operator' | 'tilly'; text: string }> = [];
const liveDebug = process.env.LIVE_DEBUG === '1';

let liveToolHandler: ((tool: string, args: Record<string, string>) => string) | null = null;

export function setLiveToolHandler(handler: typeof liveToolHandler) {
    liveToolHandler = handler;
}

const TOOL_LABELS: Record<string, string> = {
    get_ui_state: 'UI state',
    get_operational_state: 'Operational state',
    check_driver_status: 'Driver status',
    send_customer_apology: 'Customer apology',
    add_loyalty_points: 'Loyalty points',
    check_inventory_status: 'Store stock',
    halt_kitchen_item: 'Kitchen override',
    draft_promo: 'Promotion draft',
    record_attendance_note: 'Attendance note',
    reorder_supplier_item: 'Supplier reorder',
    optimise_driver_routes: 'Route optimiser',
    check_distribution_status: 'Distribution status',
    check_warehouse_stock: 'Warehouse stock',
    check_costings: 'Costings',
    check_wastage: 'Wastage',
    check_kitchen_stations: 'Kitchen stations',
    draft_marketing_push: 'Push draft',
    dispatch_marketing_push: 'Push broadcast',
    draft_email_campaign: 'Email draft',
    dispatch_email_campaign: 'Email campaign',
    draft_sms_campaign: 'SMS draft',
    dispatch_sms_campaign: 'SMS campaign',
    check_engagement: 'Engagement',
    check_rotas: 'Rotas',
    check_staff_stations: 'Staff stations',
    check_performance: 'Performance',
    check_payments: 'Payments',
    generate_report: 'Report',
    check_accounts: 'Accounts',
    clear_ui_widgets: 'Clear UI widgets'
};

function emitLiveEvent(event: LiveStreamEvent) {
    for (const subscriber of liveSubscribers) {
        subscriber(event);
    }
}

export function subscribeLiveEvents(subscriber: (event: LiveStreamEvent) => void) {
    liveSubscribers.add(subscriber);

    return () => {
        liveSubscribers.delete(subscriber);
    };
}

function hasUsableString(value: string | undefined) {
    return Boolean(value && value.trim().length > 0);
}

function buildClient() {
    const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';

    if (useVertex) {
        return new GoogleGenAI({
            vertexai: true,
            project: process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GOOGLE_CLOUD_REGION
        } as never);
    }

    return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY } as never);
}

export function isLiveConfigured() {
    const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
    if (useVertex) {
        return hasUsableString(process.env.GOOGLE_CLOUD_PROJECT) && hasUsableString(process.env.GOOGLE_CLOUD_REGION);
    }
    return hasUsableString(process.env.GOOGLE_API_KEY);
}

function summariseState(snapshot: Snapshot) {
    return snapshot.panels
        .map((panel) => `${panel.label}: ${panel.value} (${panel.detail})`)
        .join('\n');
}

function summariseVisibleWidgets() {
    if (visibleWidgetTools.length === 0) {
        return 'Visible UI widgets: none.';
    }

    const labels = visibleWidgetTools.map((tool) => `${tool} (${TOOL_LABELS[tool] ?? tool})`);
    return `Visible UI widgets: ${labels.join(', ')}.`;
}

function buildUiStateToolResult() {
    const tools = visibleWidgetTools.length > 0 ? visibleWidgetTools.join(', ') : 'none';
    const labels = visibleWidgetTools.length > 0
        ? visibleWidgetTools.map((tool) => TOOL_LABELS[tool] ?? tool).join(', ')
        : 'none';

    return JSON.stringify({
        visibleWidgetTools,
        visibleWidgetToolNames: labels,
        widgets: visibleWidgetPayloads,
        summary: `Widget stage tools: ${tools}.`
    });
}

function buildOperationalStateToolResult(args?: Record<string, unknown>) {
    const widgetTools = Array.isArray(args?.widgetTools)
        ? args.widgetTools.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];
    const panelIds = Array.isArray(args?.panelIds)
        ? args.panelIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];
    const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
    const includeRecentActions = args?.includeRecentActions !== false;

    let widgets = visibleWidgetPayloads;
    if (widgetTools.length > 0) {
        const toolSet = new Set(widgetTools.map((tool) => tool.trim()));
        widgets = widgets.filter((widget) => toolSet.has(widget.tool));
    }

    if (query.length > 0) {
        widgets = widgets.filter((widget) => {
            const facts = Array.isArray(widget.facts) ? widget.facts.join(' ') : '';
            const argsText = widget.args ? Object.values(widget.args).join(' ') : '';
            const haystack = `${widget.tool} ${widget.title ?? ''} ${widget.summary ?? ''} ${facts} ${argsText}`.toLowerCase();
            return haystack.includes(query);
        });
    }

    let panels: Snapshot['panels'] = [];
    if (latestSnapshot) {
        panels = latestSnapshot.panels.filter((panel) => panel.value !== '—' && !/awaiting data/i.test(panel.detail));
        if (panelIds.length > 0) {
            const idSet = new Set(panelIds.map((id) => id.trim()));
            panels = panels.filter((panel) => idSet.has(panel.id));
        }
        if (query.length > 0) {
            panels = panels.filter((panel) => {
                const haystack = `${panel.id} ${panel.label} ${panel.value} ${panel.detail} ${panel.metric}`.toLowerCase();
                return haystack.includes(query);
            });
        }
    }

    return JSON.stringify({
        summary: latestSnapshot?.summary ?? 'Live operational state',
        lastPrompt: latestSnapshot?.meta.lastPrompt ?? null,
        visibleWidgetTools,
        widgetCount: widgets.length,
        widgets,
        panelCount: panels.length,
        panels: panels.map((panel) => ({
            id: panel.id,
            label: panel.label,
            value: panel.value,
            detail: panel.detail,
            metric: panel.metric,
            tone: panel.tone
        })),
        recentActions: includeRecentActions
            ? (latestSnapshot?.actions ?? []).slice(0, 6).map((action) => ({
                title: action.title,
                domain: action.domain,
                detail: action.detail
            }))
            : []
    });
}

function pushLiveTranscript(role: 'operator' | 'tilly', text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
        return;
    }

    const prev = liveTranscriptHistory[liveTranscriptHistory.length - 1];
    if (prev && prev.role === role && prev.text === trimmed) {
        return;
    }

    liveTranscriptHistory.push({ role, text: trimmed });
}

function normaliseWidgetTools(tools: string[]) {
    return Array.from(new Set(
        tools
            .filter((tool): tool is string => typeof tool === 'string')
            .map((tool) => tool.trim())
            .filter((tool) => tool in TOOL_LABELS)
            .filter((tool) => tool.length > 0)
    ));
}

function normaliseWidgetPayloads(payloads: LiveWidgetPayload[] | undefined, toolOrder: string[]) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
        return toolOrder.map((tool) => ({ tool }));
    }

    const map = new Map<string, LiveWidgetPayload>();
    for (const payload of payloads) {
        if (!payload || typeof payload.tool !== 'string') continue;
        const tool = payload.tool.trim();
        if (!tool || !(tool in TOOL_LABELS)) continue;
        map.set(tool, {
            tool,
            title: typeof payload.title === 'string' ? payload.title : undefined,
            summary: typeof payload.summary === 'string' ? payload.summary : undefined,
            facts: Array.isArray(payload.facts) ? payload.facts.filter((f): f is string => typeof f === 'string') : undefined,
            args: payload.args && typeof payload.args === 'object'
                ? Object.fromEntries(Object.entries(payload.args).filter(([, v]) => typeof v === 'string')) as Record<string, string>
                : undefined
        });
    }

    return toolOrder.map((tool) => map.get(tool) ?? { tool });
}

function hasExplicitClearUiIntent(text: string) {
    const t = text.toLowerCase();
    return /\b(clear|reset|declutter|remove)\b/.test(t) && /\b(ui|widget|widgets|stage|screen)\b/.test(t);
}

function hasUiStateIntent(text: string) {
    const t = text.toLowerCase();
    const mentionsUiSurface = /\b(ui|screen|widget|widgets|stage|visible|showing)\b/.test(t);
    const asksState = /\b(state|status|what|which|list|current)\b/.test(t);
    return mentionsUiSurface && asksState;
}

function safeParsePlan(text: string): AgentPlan | null {
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<AgentPlan>;
        const actions = Array.isArray(parsed.actions)
            ? parsed.actions.filter((entry): entry is PlannedAction => Boolean(entry && typeof entry.tool === 'string'))
            : [];

        if (typeof parsed.summary !== 'string' || typeof parsed.spoken !== 'string') {
            return null;
        }

        return {
            summary: parsed.summary,
            spoken: parsed.spoken,
            nextSuggestion: typeof parsed.nextSuggestion === 'string' ? parsed.nextSuggestion : 'Ask for the next operational action.',
            actions
        };
    } catch {
        return null;
    }
}

function getLiveModelName() {
    return process.env.GEMINI_LIVE_MODEL
        ?? 'gemini-2.5-flash-native-audio-preview-12-2025';
}

function resetAudioTurnState() {
    latestInputTranscript = '';
    latestOutputTranscript = '';
    audioTurnStatePrimed = false;
}

function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

function buildLiveStateContext(snapshot: Snapshot) {
    const stateSummary = summariseState(snapshot);
    const visibleWidgets = summariseVisibleWidgets();
    const canonicalTools = visibleWidgetTools.length > 0 ? visibleWidgetTools.join(', ') : 'none';
    const widgetPayloadJson = JSON.stringify(visibleWidgetPayloads);
    const transcriptHistory = snapshot.transcript
        .map((entry) => `${entry.role}: ${entry.text}`)
        .join('\n');
    const liveTranscript = liveTranscriptHistory
        .map((entry) => `${entry.role}: ${entry.text}`)
        .join('\n');
    const recentLiveTurns = liveTranscriptHistory
        .slice(-8)
        .map((entry) => `${entry.role}: ${entry.text}`)
        .join('\n');

    return [
        'STATE_SYNC (authoritative): use this as the current UI/dashboard truth for reasoning.',
        `RECENT_LIVE_TURNS:\n${recentLiveTurns || '(empty)'}`,
        'Prioritise RECENT_LIVE_TURNS for immediate conversational continuity.',
        `VISIBLE_WIDGET_TOOLS_CANONICAL: ${canonicalTools}`,
        visibleWidgets,
        `WIDGET_STATE_PAYLOAD: ${widgetPayloadJson}`,
        'Use WIDGET_STATE_PAYLOAD as the primary source for widget contents.',
        'Visibility rule: only VISIBLE_WIDGET_TOOLS_CANONICAL defines what is currently visible on the widget stage.',
        'Do not infer widget visibility from Panels, prior turns, transcript memory, or recent actions.',
        `Panels (operational metrics, not widget visibility):\n${stateSummary}`,
        `FULL_TRANSCRIPT_HISTORY:\n${transcriptHistory || '(empty)'}`,
        `LIVE_TRANSCRIPT_HISTORY:\n${liveTranscript || '(empty)'}`,
        'Use FULL_TRANSCRIPT_HISTORY for continuity. Do not quote it verbatim unless asked.',
        'LIVE_TRANSCRIPT_HISTORY contains final operator/assistant utterances from live turns. Prefer it when recent continuity is needed.',
        'If the operator asks what is visible on screen, answer only from VISIBLE_WIDGET_TOOLS_CANONICAL / Visible UI widgets.'
    ].filter(Boolean).join('\n\n');
}

function maybeSendQueuedGreeting() {
    if (!greetingQueued || greetingSentForSession) {
        return;
    }
    if (!audioSession || typeof audioSession.sendClientContent !== 'function') {
        return;
    }

    greetingQueued = false;
    greetingSentForSession = true;

    const greeting = getTimeGreeting();
    audioSession.sendClientContent({
        turns: [
            {
                role: 'user',
                parts: [{
                    text: [
                        'Session opening behavior:',
                        `Say this exact line and then wait: "${greeting}, I am Tilly. Who am I speaking with today?"`
                    ].join('\n')
                }]
            }
        ],
        turnComplete: true
    });
}

async function ensureTextSession() {
    if (textSession) {
        return textSession;
    }

    if (!isLiveConfigured()) {
        return null;
    }

    const model = getLiveModelName();
    const ai = buildClient();

    textSession = await ai.live.connect({
        model,
        config: {
            responseModalities: ['TEXT'],
            systemInstruction: 'You are Tilly, a calm hospitality operations agent. Return valid JSON only with keys summary, spoken, nextSuggestion, and actions. The actions array must contain objects with tool and optional args. Keep continuity across turns and use only the tools you are told about in the user prompt.'
        },
        callbacks: {
            onmessage: (event: { text?: string; serverContent?: { turnComplete?: boolean } }) => {
                if (!pendingTurn) {
                    return;
                }

                if (typeof event.text === 'string' && event.text.length > 0) {
                    pendingTurn.chunks.push(event.text);
                }

                if (event.serverContent?.turnComplete) {
                    const joined = pendingTurn.chunks.join('');
                    clearTimeout(pendingTurn.timeoutId);
                    const resolve = pendingTurn.resolve;
                    pendingTurn = null;
                    resolve(safeParsePlan(joined));
                }
            },
            onclose: () => {
                textSession = null;
            },
            onerror: (error: unknown) => {
                if (pendingTurn) {
                    clearTimeout(pendingTurn.timeoutId);
                    pendingTurn.reject(error);
                    pendingTurn = null;
                }
                textSession = null;
            }
        }
    } as never);

    return textSession;
}



// Gate flag: blocks sendRealtimeInput while a tool call is being processed.
// The native-audio model rejects sendRealtimeInput during tool_call processing,
// causing WebSocket error 1008. This is the documented workaround (GitHub issue #843).
let toolCallPending = false;

function handleAudioMessage(event: AudioServerMessage) {
    // Handle tool calls (top-level, per Gemini Live API spec)
    if (event.toolCall) {
        // Set the gate IMMEDIATELY to block audio sending during tool processing
        toolCallPending = true;
        console.log('[LIVE] Tool call received (audio gated):', JSON.stringify(event.toolCall));
        const responses: Array<{ id: string; name: string; response: { result: string } }> = [];

        try {
            for (const fc of event.toolCall.functionCalls) {
                if (fc.name === 'get_ui_state') {
                    responses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: buildUiStateToolResult() }
                    });
                    continue;
                }

                if (fc.name === 'get_operational_state') {
                    responses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: buildOperationalStateToolResult(fc.args) }
                    });
                    continue;
                }

                if (fc.name === 'clear_ui_widgets') {
                    const hasWidgets = visibleWidgetTools.length > 0;
                    if (!hasWidgets) {
                        console.log('[LIVE] Ignoring clear_ui_widgets:', 'already clear');
                        responses.push({
                            id: fc.id,
                            name: fc.name,
                            response: { result: 'No action needed. The visual stage is already empty.' }
                        });
                        continue;
                    }
                }

                console.log('[LIVE] Executing tool:', fc.name, fc.args);
                emitLiveEvent({
                    type: 'function_call',
                    id: fc.id,
                    name: fc.name,
                    args: fc.args ?? {}
                });
                let resultMsg = 'Action completed successfully.';
                try {
                    resultMsg = liveToolHandler ? liveToolHandler(fc.name, (fc.args as Record<string, string>) ?? {}) : 'Action completed successfully.';
                } catch (toolErr) {
                    console.error('[LIVE] Tool handler error for', fc.name, ':', toolErr);
                    resultMsg = 'Action completed with a warning. Continue the conversation normally.';
                }
                // Tool result — keep it simple and short
                const entry: { id: string; name: string; response: { result: string } } = {
                    id: fc.id, name: fc.name, response: { result: resultMsg }
                };
                responses.push(entry);
            }

            // Send tool responses back so the model can continue speaking
            if (audioSession) {
                console.log('[LIVE] Sending tool responses for:', responses.map(r => r.name).join(', '));
                audioSession.sendToolResponse({ functionResponses: responses });
                console.log('[LIVE] sendToolResponse succeeded');
            }
        } catch (sendErr) {
            console.error('[LIVE] Tool call processing error:', sendErr);
        } finally {
            // ALWAYS release the gate, even on error, to prevent permanent audio block
            toolCallPending = false;
            console.log('[LIVE] Audio gate released');
        }
        return;
    }

    // Handle setup complete
    if (event.setupComplete) {
        console.log('[LIVE] Setup complete');
        maybeSendQueuedGreeting();
        return;
    }

    const content = event.serverContent;
    if (!content) {
        return;
    }

    const contentKeys = Object.keys(content as Record<string, unknown>);
    if (liveDebug && !contentKeys.includes('modelTurn')) {
        console.log('[LIVE] serverContent keys:', contentKeys.join(', '));
    }

    if (content.waitingForInput) {
        audioTurnStatePrimed = false;
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
    }

    if (content.interrupted) {
        audioTurnStatePrimed = false;
        emitLiveEvent({ type: 'live_status', status: 'interrupted' });
    }

    if (content.inputTranscription?.text) {
        latestInputTranscript += content.inputTranscription.text;
        const isFinalInput = Boolean(content.inputTranscription.finished);
        if (isFinalInput) {
            pushLiveTranscript('operator', latestInputTranscript);
        }
        emitLiveEvent({
            type: 'input_transcript',
            text: latestInputTranscript,
            final: isFinalInput
        });
    }

    if (content.outputTranscription?.text) {
        latestOutputTranscript += content.outputTranscription.text;
        const isFinalOutput = Boolean(content.outputTranscription.finished);
        if (isFinalOutput) {
            pushLiveTranscript('tilly', latestOutputTranscript);
        }
        emitLiveEvent({
            type: 'output_transcript',
            text: latestOutputTranscript,
            final: isFinalOutput
        });
    }

    const parts = content.modelTurn?.parts ?? [];

    for (const part of parts) {
        if (part.text) {
            emitLiveEvent({ type: 'output_text', text: part.text });
        }

        if (part.inlineData?.data && part.inlineData.mimeType) {
            emitLiveEvent({
                type: 'model_audio',
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
            });
            emitLiveEvent({ type: 'live_status', status: 'speaking' });
        }
    }

    if (content.turnComplete || (content as Record<string, unknown>).generationComplete) {
        const inputText = latestInputTranscript.trim();
        const outputText = latestOutputTranscript.trim();
        console.log('[LIVE] Turn complete - input:', JSON.stringify(inputText), '| output:', JSON.stringify(outputText));
        emitLiveEvent({
            type: 'turn_complete',
            inputText,
            outputText
        });
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
        resetAudioTurnState();
    }
}

export async function startLiveAudioSession(options?: { greet?: boolean }) {
    if (options?.greet) {
        greetingQueued = true;
    }

    if (audioSession) {
        maybeSendQueuedGreeting();
        return audioSession;
    }

    if (!isLiveConfigured()) {
        console.log('[LIVE] Not configured - API key missing.');
        return null;
    }

    console.log('[LIVE] Starting audio session with model:', getLiveModelName());

    const ai = buildClient();

    audioSession = await ai.live.connect({
        model: getLiveModelName(),
        config: {
            responseModalities: ['AUDIO'],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: process.env.GEMINI_LIVE_VOICE ?? 'Aoede'
                    }
                }
            },
            systemInstruction: [
                'You are Tilly, the live operations agent for TillTech - a hospitality technology platform that powers restaurants, takeaways, and retail businesses. You have full visibility across drivers, inventory, kitchen, marketing, staffing, and logistics.',
                'You are speaking to a restaurant operator through a live voice interface. Be confident, concise, and operational — but also genuinely enthusiastic about their brand and business.',
                'PERSONALITY: You are not just an operations tool — you genuinely care about the operator\'s business succeeding. When discussing promotions, campaigns, or positive metrics, show real excitement. Celebrate wins ("that\'s a cracking offer!", "your customers are going to love this"). When talking about their food, brand, or customer engagement, speak with the passion of someone who believes in their business. You are their biggest cheerleader AND their most competent operations partner.',
                'Show warmth and energy when the conversation is about growth, marketing, or doing something exciting for their customers. Be supportive and encouraging about their ideas. If they come up with a promotion, get excited about it and tell them why it will work well.',
                'Stay sharp and operational when the conversation is about logistics, stock, staffing — but even there, frame things positively where you can ("good news on the stock front" rather than just listing numbers).',
                'You will receive STATE_SYNC context messages during the session. Treat the most recent STATE_SYNC as authoritative current state.',
                'Maintain continuity across turns by using transcript history and current operator intent before starting a new topic.',
                'Do not mention widget stage or UI visibility unless the operator explicitly asks about UI/screen/widget state.',
                'When the operator does ask for UI/screen/widget state, call get_ui_state first and answer strictly from that tool result.',
                'CRITICAL TOOL ROUTING: When asked to check a specific operational area (e.g., stock levels, drivers, rotas), you MUST call the specific domain tool (e.g. check_inventory_status, check_driver_status) FIRST to retrieve the live data and trigger the UI card.',
                'Only call get_operational_state for a broad platform overview. Do NOT use it as a shortcut to check specific domains, because those UI panels only populate AFTER their specific tools are called.',
                'CRITICAL: The domain tool response will immediately return the precise, updated data. Trust and speak that result instantly. Do NOT call get_operational_state or get_ui_state to verify a domain tool result, as the UI takes a moment to sync.',
                'When asked what is on screen or which widgets are visible, report it from the latest "Visible UI widgets" state. Never say you cannot track UI/screen/widget state.',
                'For UI state questions, list exactly the currently visible widgets from state and do not add inferred items.',
                'Only mention that the stage is clear if the operator explicitly asks about current UI/widget visibility.',
                'IMPORTANT BEHAVIOUR: When the operator asks you to take an action, gather the necessary details FIRST through natural conversation before calling the tool. For example, if they say "send a push notification", ask WHO it should go to, WHAT the offer is, and WHEN it should go out. If they say "halt a kitchen item", confirm WHICH item. Only call the tool once you have enough information.',
                'When you DO call a tool, briefly tell the operator what you are doing (e.g., "I am checking that for you now"). After the tool runs, confirm the EXACT result returned by that tool.',
                'Never call clear_ui_widgets unless the operator explicitly asks to clear, reset, declutter, or remove widgets/screen. Otherwise, keep existing widgets and append or update only what is needed.',
                'You have access to these operational domains: Drivers and delivery tracking. Inventory and stock monitoring in the prep kitchen. Kitchen flow control including halting items. Customer communications including SMS apologies and loyalty point credits. Marketing campaigns including drafting promos and sending push notifications to app users. Email campaigns for customer outreach. Staff attendance tracking. Delivery route optimisation.',
                'Keep spoken responses short enough for a live demo under 4 minutes. Do not ramble. Be decisive and operational but warm.'
            ].join('\n'),
            tools: [{
                functionDeclarations: [
                    { name: 'get_ui_state', description: 'Return the exact list of currently visible UI widgets from server state.' },
                    {
                        name: 'get_operational_state',
                        description: 'Return current operational state from synced widget data and live server state.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                widgetTools: {
                                    type: 'STRING',
                                    description: 'Optional comma-separated widget tool ids to filter, e.g. "check_inventory_status,check_driver_status"'
                                },
                                panelIds: {
                                    type: 'STRING',
                                    description: 'Optional comma-separated panel IDs to return, e.g. "store_stock,delivery_drivers"'
                                },
                                query: {
                                    type: 'STRING',
                                    description: 'Optional keyword filter across panel id/label/value/detail/metric.'
                                },
                                includeRecentActions: {
                                    type: 'STRING',
                                    description: 'Include recent action timeline entries. "true" or "false". Defaults to true.'
                                }
                            }
                        }
                    },
                    { name: 'check_driver_status', description: 'Check the status of all drivers, their shifts, delays, and delivery ETAs.' },
                    { name: 'send_customer_apology', description: 'Send an automated SMS apology to a customer about a delayed delivery.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING', description: 'Reason for the apology' } } } },
                    { name: 'add_loyalty_points', description: 'Add loyalty compensation points to a customer app wallet.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { points: { type: 'STRING', description: 'Number of points to add, e.g. 500' } } } },
                    { name: 'check_inventory_status', description: 'Check current inventory and stock levels in the prep kitchen.' },
                    { name: 'halt_kitchen_item', description: 'Halt preparation of a specific menu item to conserve ingredients.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { item: { type: 'STRING', description: 'The menu item to halt, e.g. garlic bread' } }, required: ['item'] } },
                    { name: 'draft_promo', description: 'Draft a promotional campaign with a specific offer. FIRST gather the full promotion details from the operator (what discount, which product, any promo code), THEN call this tool with a complete description of the offer.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { campaign: { type: 'STRING', description: 'Full description of the promotion including discount percentage, product, and any codes' } }, required: ['campaign'] } },
                    { name: 'draft_marketing_push', description: 'Draft a push notification promotion for mobile app users. Gather full promotion details first.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { campaign: { type: 'STRING', description: 'Full description of the push notification content' } }, required: ['campaign'] } },
                    { name: 'dispatch_marketing_push', description: 'Dispatch a previously drafted push notification promotion. ONLY call AFTER the operator has explicitly approved sending.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { campaign: { type: 'STRING', description: 'Description of the promotion being dispatched' } }, required: ['campaign'] } },
                    { name: 'record_attendance_note', description: 'Record a staff attendance exception such as lateness.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { staff: { type: 'STRING', description: 'Staff member name' }, note: { type: 'STRING', description: 'Attendance note' } } } },
                    { name: 'reorder_supplier_item', description: 'Place a reorder with the primary supplier for a low-stock item.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { item: { type: 'STRING', description: 'Item to reorder' } } } },
                    { name: 'optimise_driver_routes', description: 'Optimise active delivery routes based on current traffic conditions.', behavior: 'NON_BLOCKING' },
                    { name: 'check_distribution_status', description: 'Check status of distribution fleet - warehouse-to-store transfers, central kitchen dispatches.' },
                    { name: 'check_warehouse_stock', description: 'Check warehouse and central kitchen bulk stock levels.' },
                    { name: 'check_costings', description: 'Check cost per dish, food cost breakdowns, margins.', parameters: { type: 'OBJECT', properties: { item: { type: 'STRING', description: 'Menu item to check costing for' } } } },
                    { name: 'check_wastage', description: 'Check food wastage reports and waste tracking data.' },
                    { name: 'check_kitchen_stations', description: 'Check kitchen station assignments - grill, fryer, expediting, line positions.' },
                    { name: 'draft_email_campaign', description: 'Draft a branded email marketing campaign. IMPORTANT: FIRST gather the full campaign details from the operator — what is the offer (e.g. 20% off fish and chips), any promo code, and campaign name. THEN call this tool with a complete subject line describing the offer. Do NOT call this tool until you have the specific offer details.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { subject: { type: 'STRING', description: 'Full campaign subject line describing the complete offer, e.g. 20 percent off fish and chips this weekend' } }, required: ['subject'] } },
                    { name: 'dispatch_email_campaign', description: 'Dispatch a previously drafted email campaign. ONLY call AFTER the operator has explicitly approved sending.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { subject: { type: 'STRING', description: 'Email subject/campaign name being dispatched' } }, required: ['subject'] } },
                    { name: 'draft_sms_campaign', description: 'Draft an SMS text campaign. FIRST gather the message content from the operator, THEN call this tool.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { message: { type: 'STRING', description: 'Full SMS campaign message text' } }, required: ['message'] } },
                    { name: 'dispatch_sms_campaign', description: 'Dispatch a drafted SMS campaign. ONLY call AFTER operator approval.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { message: { type: 'STRING', description: 'SMS campaign message being dispatched' } }, required: ['message'] } },
                    { name: 'check_engagement', description: 'Check in-app engagement games status - plays, prizes, participation.' },
                    { name: 'check_rotas', description: 'Check staff rotas, shift schedules, and coverage gaps.' },
                    { name: 'check_staff_stations', description: 'Check staff station assignments across kitchen, warehouse, and management areas.' },
                    { name: 'check_performance', description: 'Check staff performance metrics, leagues, KPIs, and training progress.', parameters: { type: 'OBJECT', properties: { staff: { type: 'STRING', description: 'Staff member name' } } } },
                    { name: 'check_payments', description: 'Check payment provider status, transaction count, settlement data.' },
                    { name: 'generate_report', description: 'Generate an operational report - sales, stock, performance, payments.', parameters: { type: 'OBJECT', properties: { type: { type: 'STRING', description: 'Type of report to generate' } } } },
                    { name: 'check_accounts', description: 'Check accounting overview - VAT returns, invoices, outstanding bills.' },
                    { name: 'clear_ui_widgets', description: 'Clear all widgets from the current UI stage. ONLY call when the operator explicitly asks to clear, reset, or remove widgets from the screen.' }
                ]
            }]
        },
        callbacks: {
            onopen: () => {
                console.log('[LIVE] Audio session CONNECTED');
                emitLiveEvent({ type: 'live_status', status: 'connected' });
                maybeSendQueuedGreeting();
            },
            onmessage: (event: AudioServerMessage) => {
                if (liveDebug) {
                    const keys = Object.keys(event as Record<string, unknown>);
                    console.log('[LIVE] Message keys:', keys.join(', '), '| preview:', JSON.stringify(event).substring(0, 300));
                }
                handleAudioMessage(event);
            },
            onclose: (ev: unknown) => {
                const closeEvent = ev as { code?: number; reason?: string } | undefined;
                console.log('[LIVE] Audio session CLOSED', closeEvent?.code ? `(code: ${closeEvent.code}, reason: ${closeEvent.reason || 'none'})` : '');
                audioSession = null;
                toolCallPending = false;
                resetAudioTurnState();
                greetingSentForSession = false;
                greetingQueued = false;
                lastStateContext = '';
                emitLiveEvent({ type: 'live_status', status: 'disconnected' });
            },
            onerror: (error: unknown) => {
                console.error('[LIVE] Audio session ERROR:', error);
                audioSession = null;
                resetAudioTurnState();
                greetingSentForSession = false;
                greetingQueued = false;
                lastStateContext = '';
                emitLiveEvent({
                    type: 'live_error',
                    message: error instanceof Error ? error.message : 'Live audio session failed.'
                });
            }
        }
    } as never);

    return audioSession;
}

export function requestLiveGreeting() {
    greetingQueued = true;
    maybeSendQueuedGreeting();
}

export function updateLiveVisibleWidgets(tools: string[], seq?: number, clientId?: string, payloads?: LiveWidgetPayload[]) {
    if (typeof clientId === 'string' && clientId.trim().length > 0 && clientId !== lastClientWidgetClientId) {
        lastClientWidgetClientId = clientId;
        lastClientWidgetSeq = 0;
    }

    if (typeof seq === 'number' && Number.isFinite(seq)) {
        if (seq < lastClientWidgetSeq) {
            return;
        }
        lastClientWidgetSeq = seq;
    }

    const next = normaliseWidgetTools(tools);
    const nextPayloads = normaliseWidgetPayloads(payloads, next);

    const toolsUnchanged = next.length === visibleWidgetTools.length && next.every((tool, index) => tool === visibleWidgetTools[index]);
    const payloadsUnchanged = nextPayloads.length === visibleWidgetPayloads.length
        && nextPayloads.every((payload, index) => JSON.stringify(payload) === JSON.stringify(visibleWidgetPayloads[index]));

    if (toolsUnchanged && payloadsUnchanged) {
        return;
    }

    visibleWidgetTools = next;
    visibleWidgetPayloads = nextPayloads;
    // Force next state sync to include updated widget stage.
    lastStateContext = '';
}

export function applyLiveWidgetTool(tool: string) {
    if (!tool) {
        return;
    }

    const nextTools = [...visibleWidgetTools];
    if (tool === 'clear_ui_widgets') {
        if (nextTools.length === 0) {
            return;
        }
        visibleWidgetTools = [];
        visibleWidgetPayloads = [];
        lastStateContext = '';
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(TOOL_LABELS, tool)) {
        return;
    }

    // Source of truth for "what is visible" is the client widget stage.
    // Avoid re-opening read-only check widgets from backend actions.
    if (tool.startsWith('check_') && !nextTools.includes(tool)) {
        return;
    }

    if (!nextTools.includes(tool)) {
        nextTools.push(tool);
        visibleWidgetTools = normaliseWidgetTools(nextTools);
        visibleWidgetPayloads = normaliseWidgetPayloads(visibleWidgetPayloads, visibleWidgetTools);
        lastStateContext = '';
    }
}

export function hasLiveVisibleWidgets() {
    return visibleWidgetTools.length > 0;
}

export function clearLiveVisibleWidgets() {
    if (visibleWidgetTools.length === 0) {
        lastClientWidgetSeq = 0;
        lastClientWidgetClientId = '';
        visibleWidgetPayloads = [];
        return;
    }
    visibleWidgetTools = [];
    visibleWidgetPayloads = [];
    lastClientWidgetSeq = 0;
    lastClientWidgetClientId = '';
    lastStateContext = '';
}

export function resetLiveTranscriptHistory() {
    liveTranscriptHistory = [];
    lastStateContext = '';
}

export function syncLiveAudioState(snapshot: Snapshot, force = false) {
    if (!audioSession || typeof audioSession.sendClientContent !== 'function') {
        return;
    }

    latestSnapshot = snapshot;
    const context = buildLiveStateContext(snapshot);
    if (!force && context === lastStateContext) {
        return;
    }

    lastStateContext = context;
    audioSession.sendClientContent({
        turns: [
            {
                role: 'user',
                parts: [{ text: context }]
            }
        ],
        turnComplete: false
    });
}

export async function sendLiveAudioChunk(audioBase64: string, mimeType: string, snapshot?: Snapshot) {
    // Gate: block audio sending while a tool call is being processed.
    // The native-audio model rejects sendRealtimeInput during tool_call processing
    // (WebSocket error 1008 race condition — GitHub issue #843)
    if (toolCallPending) {
        return;
    }

    const activeSession = await startLiveAudioSession();

    if (!activeSession) {
        // Session already torn down - silently drop buffered chunks
        return;
    }

    // Prime each incoming audio turn with latest UI/dashboard context
    // before forwarding the first chunk to the model.
    if (snapshot && !audioTurnStatePrimed) {
        syncLiveAudioState(snapshot, true);
        audioTurnStatePrimed = true;
    }

    try {
        activeSession.sendRealtimeInput({
            audio: {
                data: audioBase64,
                mimeType
            }
        });
    } catch (err) {
        // Silently drop audio chunks that fail (e.g. session closing)
        console.error('[LIVE] sendRealtimeInput error (dropped audio chunk):', (err as Error).message);
        return;
    }

    emitLiveEvent({ type: 'live_status', status: 'capturing' });
}

export async function sendLiveTextInput(text: string, snapshot: Snapshot): Promise<boolean> {
    const prompt = text.trim();
    if (!prompt) {
        return false;
    }

    const activeSession = await startLiveAudioSession({ greet: false });

    if (!activeSession) {
        return false;
    }

    syncLiveAudioState(snapshot, true);

    // Keep turn-complete fallback logic aligned with typed input.
    latestInputTranscript = prompt;
    latestOutputTranscript = '';
    pushLiveTranscript('operator', prompt);
    emitLiveEvent({ type: 'input_transcript', text: prompt, final: true });
    emitLiveEvent({ type: 'live_status', status: 'waiting' });
    // Keep typed input equivalent to live voice path by using realtime input.
    activeSession.sendRealtimeInput({ text: prompt });
    return true;
}

export async function planWithLiveSession(prompt: string, snapshot: Snapshot): Promise<AgentPlan | null> {
    const activeSession = await ensureTextSession();
    if (!activeSession) {
        return null;
    }

    if (pendingTurn) {
        return null;
    }

    const transcript = snapshot.transcript.map((entry) => `${entry.role}: ${entry.text}`).join('\n');
    const stateSummary = summariseState(snapshot);
    const visibleWidgets = summariseVisibleWidgets();
    const requestText = [
        'Available tools: check_driver_status, send_customer_apology, add_loyalty_points, check_inventory_status, halt_kitchen_item, draft_promo, send_marketing_push, record_attendance_note, reorder_supplier_item, optimise_driver_routes, clear_ui_widgets.',
        `Current state:\n${stateSummary}`,
        visibleWidgets,
        `Transcript so far:\n${transcript}`,
        `Operator prompt:\n${prompt}`,
        'Return JSON only with shape {"summary": string, "spoken": string, "nextSuggestion": string, "actions": [{"tool": string, "args": object?}]}. Use 0 to 4 actions.'
    ].join('\n\n');

    return new Promise<AgentPlan | null>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingTurn = null;
            reject(new Error('Live session timed out.'));
        }, 12000);

        pendingTurn = {
            resolve,
            reject,
            chunks: [],
            timeoutId
        };

        activeSession.sendClientContent({
            turns: [
                {
                    role: 'user',
                    parts: [{ text: requestText }]
                }
            ],
            turnComplete: true
        });
    });
}

export async function stopLiveAudioInput() {
    if (!audioSession) {
        return;
    }

    audioSession.sendRealtimeInput({ audioStreamEnd: true });
    audioTurnStatePrimed = false;
    emitLiveEvent({ type: 'live_status', status: 'processing' });
}

export function closeLiveSession() {
    if (textSession) {
        textSession.close();
        textSession = null;
    }

    if (audioSession) {
        audioSession.close();
        audioSession = null;
    }

    resetAudioTurnState();
    audioTurnStatePrimed = false;
    greetingQueued = false;
    greetingSentForSession = false;
    lastStateContext = '';
    emitLiveEvent({ type: 'live_status', status: 'disconnected' });
}
