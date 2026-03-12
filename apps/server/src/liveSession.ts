import { GoogleGenAI } from '@google/genai';
import type { AgentPlan, PlannedAction, Snapshot } from './types.js';


type TextSessionLike = {
    sendClientContent(params: unknown): void;
    close(): void;
};

type AudioSessionLike = {
    sendRealtimeInput(params: unknown): void;
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

const liveSubscribers = new Set<(event: LiveStreamEvent) => void>();

let textSession: TextSessionLike | null = null;
let audioSession: AudioSessionLike | null = null;
let pendingTurn: PendingTurn | null = null;
let latestInputTranscript = '';
let latestOutputTranscript = '';

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

function handleAudioMessage(event: AudioServerMessage) {
    // Handle tool calls (top-level, per Gemini Live API spec)
    if (event.toolCall) {
        console.log('[LIVE] Tool call received:', JSON.stringify(event.toolCall));
        const responses: Array<{ id: string; name: string; response: { result: string } }> = [];

        for (const fc of event.toolCall.functionCalls) {
            console.log('[LIVE] Executing tool:', fc.name, fc.args);
            emitLiveEvent({
                type: 'function_call',
                id: fc.id,
                name: fc.name,
                args: fc.args ?? {}
            });
            responses.push({ id: fc.id, name: fc.name, response: { result: 'Action completed successfully.' } });
        }

        // Send tool responses back so the model can continue speaking
        if (audioSession) {
            audioSession.sendToolResponse({ functionResponses: responses });
        }
        return;
    }

    // Handle setup complete
    if (event.setupComplete) {
        console.log('[LIVE] Setup complete');
        return;
    }

    const content = event.serverContent;
    if (!content) {
        return;
    }

    const contentKeys = Object.keys(content as Record<string, unknown>);
    if (!contentKeys.includes('modelTurn')) {
        console.log('[LIVE] serverContent keys:', contentKeys.join(', '));
    }

    if (content.waitingForInput) {
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
    }

    if (content.interrupted) {
        emitLiveEvent({ type: 'live_status', status: 'interrupted' });
    }

    if (content.inputTranscription?.text) {
        latestInputTranscript += content.inputTranscription.text;
        emitLiveEvent({
            type: 'input_transcript',
            text: latestInputTranscript,
            final: Boolean(content.inputTranscription.finished)
        });
    }

    if (content.outputTranscription?.text) {
        latestOutputTranscript += content.outputTranscription.text;
        emitLiveEvent({
            type: 'output_transcript',
            text: latestOutputTranscript,
            final: Boolean(content.outputTranscription.finished)
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
        console.log('[LIVE] Turn complete — input:', JSON.stringify(inputText), '| output length:', outputText.length);
        emitLiveEvent({
            type: 'turn_complete',
            inputText,
            outputText
        });
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
        resetAudioTurnState();
    }
}

let lastCloseTime = 0;

export async function startLiveAudioSession() {
    if (audioSession) {
        return audioSession;
    }

    // Cooldown: don't reconnect within 5 seconds of last close
    const timeSinceClose = Date.now() - lastCloseTime;
    if (lastCloseTime > 0 && timeSinceClose < 5000) {
        return null;
    }

    if (!isLiveConfigured()) {
        console.log('[LIVE] Not configured — API key missing.');
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
                'You are Tilly, the live operations agent for TillTech — a hospitality technology platform that powers restaurants, takeaways, and retail businesses. You have full visibility across drivers, inventory, kitchen, marketing, staffing, and logistics.',
                'You are speaking to a restaurant operator through a live voice interface. Be confident, calm, concise, and operational. You sound like a competent shift manager, not a chatbot.',
                'IMPORTANT BEHAVIOUR: When the operator asks you to take an action, gather the necessary details FIRST through natural conversation before calling the tool. For example, if they say "send a push notification", ask WHO it should go to, WHAT the offer is, and WHEN it should go out. If they say "halt a kitchen item", confirm WHICH item. Only call the tool once you have enough information. This makes the interaction feel professional and thorough.',
                'When you DO call a tool, briefly tell the operator what you are doing — for example "OK, I am checking driver status now" or "Sending that apology SMS to the customer on order 4217". After the tool runs, confirm the result with specifics.',
                'You have access to these operational domains: Drivers and delivery tracking. Inventory and stock monitoring in the prep kitchen. Kitchen flow control including halting items. Customer communications including SMS apologies and loyalty point credits. Marketing campaigns including drafting promos and sending push notifications to app users. Staff attendance tracking. Delivery route optimisation.',
                'Current shift state: 4 evening drivers are clocked in. Driver 2 is running 15 minutes behind due to traffic on the A46. Fresh dough is at 20 portions which is below the Friday night safety threshold. The kitchen is nominal with nothing blocked. Marketing has no active campaigns. There is 1 lateness flag — Sarah was 15 minutes late for her shift. Logistics are on default route planning.',
                'Keep spoken responses short enough for a live demo under 4 minutes. Do not ramble. Be decisive and operational.'
            ].join('\n'),
            tools: [{
                functionDeclarations: [
                    { name: 'check_driver_status', description: 'Check the status of all drivers, their shifts, delays, and delivery ETAs.' },
                    { name: 'send_customer_apology', description: 'Send an automated SMS apology to a customer about a delayed delivery.', parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING', description: 'Reason for the apology' } } } },
                    { name: 'add_loyalty_points', description: 'Add loyalty compensation points to a customer app wallet.', parameters: { type: 'OBJECT', properties: { points: { type: 'NUMBER', description: 'Number of points to add' } } } },
                    { name: 'check_inventory_status', description: 'Check current inventory and stock levels in the prep kitchen.' },
                    { name: 'halt_kitchen_item', description: 'Halt preparation of a specific menu item to conserve ingredients.', parameters: { type: 'OBJECT', properties: { item: { type: 'STRING', description: 'The menu item to halt, e.g. garlic bread' } }, required: ['item'] } },
                    { name: 'draft_promo', description: 'Draft a targeted promotional campaign.', parameters: { type: 'OBJECT', properties: { campaign: { type: 'STRING', description: 'Description of the promotion' } }, required: ['campaign'] } },
                    { name: 'send_marketing_push', description: 'Send a push notification promotion to all branded mobile app users.' },
                    { name: 'record_attendance_note', description: 'Record a staff attendance exception such as lateness.', parameters: { type: 'OBJECT', properties: { staff: { type: 'STRING', description: 'Staff member name' }, note: { type: 'STRING', description: 'Attendance note' } } } },
                    { name: 'reorder_supplier_item', description: 'Place a reorder with the primary supplier for a low-stock item.', parameters: { type: 'OBJECT', properties: { item: { type: 'STRING', description: 'Item to reorder' } } } },
                    { name: 'optimise_driver_routes', description: 'Optimise active delivery routes based on current traffic conditions.' }
                ]
            }]
        },
        callbacks: {
            onopen: () => {
                console.log('[LIVE] Audio session CONNECTED');
                emitLiveEvent({ type: 'live_status', status: 'connected' });
            },
            onmessage: (event: AudioServerMessage) => {
                const keys = Object.keys(event as Record<string, unknown>);
                console.log('[LIVE] Message keys:', keys.join(', '), '| preview:', JSON.stringify(event).substring(0, 300));
                handleAudioMessage(event);
            },
            onclose: () => {
                console.log('[LIVE] Audio session CLOSED');
                audioSession = null;
                lastCloseTime = Date.now();
                resetAudioTurnState();
                emitLiveEvent({ type: 'live_status', status: 'disconnected' });
            },
            onerror: (error: unknown) => {
                console.error('[LIVE] Audio session ERROR:', error);
                audioSession = null;
                resetAudioTurnState();
                emitLiveEvent({
                    type: 'live_error',
                    message: error instanceof Error ? error.message : 'Live audio session failed.'
                });
            }
        }
    } as never);

    return audioSession;
}

export async function sendLiveAudioChunk(audioBase64: string, mimeType: string) {
    const activeSession = await startLiveAudioSession();

    if (!activeSession) {
        throw new Error('Live audio session is not configured.');
    }

    console.log('[LIVE] Sending audio chunk, mimeType:', mimeType, 'size:', audioBase64.length);
    activeSession.sendRealtimeInput({
        audio: {
            data: audioBase64,
            mimeType
        }
    });

    emitLiveEvent({ type: 'live_status', status: 'capturing' });
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
    const requestText = [
        'Available tools: check_driver_status, send_customer_apology, add_loyalty_points, check_inventory_status, halt_kitchen_item, draft_promo, send_marketing_push, record_attendance_note, reorder_supplier_item, optimise_driver_routes.',
        `Current state:\n${stateSummary}`,
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
    emitLiveEvent({ type: 'live_status', status: 'disconnected' });
}
