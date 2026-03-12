import { GoogleGenAI } from '@google/genai';
import type { AgentPlan, PlannedAction, Snapshot } from './types.js';

type TextSessionLike = {
    sendClientContent(params: unknown): void;
    close(): void;
};

type AudioSessionLike = {
    sendRealtimeInput(params: unknown): void;
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

type PartLike = {
    text?: string;
    inlineData?: InlineDataLike;
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
};

export type LiveStreamEvent =
    | { type: 'live_status'; status: 'connected' | 'capturing' | 'processing' | 'speaking' | 'waiting' | 'disconnected' | 'interrupted' }
    | { type: 'input_transcript'; text: string; final: boolean }
    | { type: 'output_transcript'; text: string; final: boolean }
    | { type: 'output_text'; text: string }
    | { type: 'model_audio'; data: string; mimeType: string }
    | { type: 'turn_complete'; inputText: string; outputText: string }
    | { type: 'live_error'; message: string };

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
        ?? (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ? 'gemini-2.0-flash-live-preview-04-09' : 'gemini-live-2.5-flash-preview');
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
    const content = event.serverContent;

    if (!content) {
        return;
    }

    if (content.waitingForInput) {
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
    }

    if (content.interrupted) {
        emitLiveEvent({ type: 'live_status', status: 'interrupted' });
    }

    if (content.inputTranscription?.text) {
        latestInputTranscript = content.inputTranscription.text;
        emitLiveEvent({
            type: 'input_transcript',
            text: latestInputTranscript,
            final: Boolean(content.inputTranscription.finished)
        });
    }

    if (content.outputTranscription?.text) {
        latestOutputTranscript = content.outputTranscription.text;
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

    if (content.turnComplete) {
        emitLiveEvent({
            type: 'turn_complete',
            inputText: latestInputTranscript.trim(),
            outputText: latestOutputTranscript.trim()
        });
        emitLiveEvent({ type: 'live_status', status: 'waiting' });
        resetAudioTurnState();
    }
}

export async function startLiveAudioSession() {
    if (audioSession) {
        emitLiveEvent({ type: 'live_status', status: 'connected' });
        return audioSession;
    }

    if (!isLiveConfigured()) {
        return null;
    }

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
            systemInstruction: 'You are Tilly, a calm hospitality operations agent for restaurant and retail operators. Speak with clear, concise operational updates and direct next actions. Keep spoken responses short enough for a live demo.'
        },
        callbacks: {
            onopen: () => {
                emitLiveEvent({ type: 'live_status', status: 'connected' });
            },
            onmessage: (event: AudioServerMessage) => {
                handleAudioMessage(event);
            },
            onclose: () => {
                audioSession = null;
                resetAudioTurnState();
                emitLiveEvent({ type: 'live_status', status: 'disconnected' });
            },
            onerror: (error: unknown) => {
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