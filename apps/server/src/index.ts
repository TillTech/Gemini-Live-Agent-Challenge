import http from 'node:http';
import { planWithGemini, isGeminiConfigured, generateBrandImage } from './gemini.js';
import {
    applyLiveWidgetTool,
    clearLiveVisibleWidgets,
    closeLiveSession,
    hasLiveVisibleWidgets,
    isLiveConfigured,
    planWithLiveSession,
    requestLiveGreeting,
    resetLiveTranscriptHistory,
    sendLiveAudioChunk,
    sendLiveTextInput,
    startLiveAudioSession,
    stopLiveAudioInput,
    subscribeLiveEvents,
    syncLiveAudioState,
    updateLiveVisibleWidgets,
    setLiveToolHandler,
    type LiveStreamEvent
} from './liveSession.js';
import { applyAction, applyPlan, createInitialSnapshot, createMockPlan, createSmartPlan, updateLatestActionArgs } from './scenario.js';
import type { ResponseMode, Snapshot } from './types.js';

const port = Number(process.env.PORT ?? 8787);
const liveReady = isGeminiConfigured();
const liveSessionReady = isLiveConfigured();
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_AUDIO_BASE64_CHARS = 512 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://tilltech.github.io'
];
const ALLOWED_AUDIO_MIME_TYPES = new Set([
    'audio/pcm',
    'audio/pcm;rate=16000',
    'audio/pcm;rate=24000'
]);

let state = createInitialSnapshot(liveReady);
const liveEventClients = new Set<http.ServerResponse>();
let pendingImageGen = false; // prevents double image generation across tiers
const turnFunctionCalls = new Set<string>();
let lastOperatorInput = '';

const INFO_TOOLS = new Set([
    'check_driver_status', 'check_inventory_status',
    'check_distribution_status', 'check_warehouse_stock',
    'check_wastage', 'check_kitchen_stations', 'check_engagement',
    'check_rotas', 'check_staff_stations',
    'check_payments', 'check_accounts', 'check_costings', 'generate_report',
    'clear_ui_widgets'
]);
const KNOWN_TOOLS = new Set([
    'get_ui_state',
    'get_operational_state',
    ...INFO_TOOLS,
    'send_customer_apology',
    'add_loyalty_points',
    'halt_kitchen_item',
    'draft_promo',
    'record_attendance_note',
    'reorder_supplier_item',
    'optimise_driver_routes',
    'draft_marketing_push',
    'dispatch_marketing_push',
    'draft_email_campaign',
    'dispatch_email_campaign',
    'draft_sms_campaign',
    'dispatch_sms_campaign',
    'check_performance'
]);

type RequestError = Error & { statusCode: number };
type WidgetPayloadInput = {
    tool: string;
    title?: string;
    summary?: string;
    facts?: string[];
    args?: Record<string, string>;
};

function createRequestError(message: string, statusCode: number): RequestError {
    const error = new Error(message) as RequestError;
    error.statusCode = statusCode;
    return error;
}

function getAllowedOrigins() {
    const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]));
}

function getCorsOrigin(request: http.IncomingMessage) {
    const origin = request.headers.origin?.trim();
    if (!origin) {
        return null;
    }

    return getAllowedOrigins().includes(origin) ? origin : null;
}

function buildResponseHeaders(request: http.IncomingMessage, headers: Record<string, string>) {
    const origin = getCorsOrigin(request);
    const responseHeaders: Record<string, string> = {
        ...headers,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'",
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    };

    if (origin) {
        responseHeaders['Access-Control-Allow-Origin'] = origin;
        responseHeaders.Vary = 'Origin';
    }

    const forwardedProto = request.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (proto?.split(',')[0]?.trim() === 'https') {
        responseHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }

    return responseHeaders;
}

function assertAllowedOrigin(request: http.IncomingMessage) {
    if (request.headers.origin && !getCorsOrigin(request)) {
        throw createRequestError('Origin is not allowed.', 403);
    }
}

function normaliseToolName(tool: unknown) {
    if (typeof tool !== 'string') {
        return null;
    }

    const trimmed = tool.trim();
    return KNOWN_TOOLS.has(trimmed) ? trimmed : null;
}

function sanitiseString(value: unknown, maxLength = 500) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
}

function sanitiseStringRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const entries: Array<[string, string]> = [];
    for (const [key, entry] of Object.entries(value)) {
        const sanitised = sanitiseString(entry, 1000);
        if (sanitised) {
            entries.push([key, sanitised]);
        }
    }

    return Object.fromEntries(entries) as Record<string, string>;
}

function sanitiseWidgetPayloads(payloads: unknown): WidgetPayloadInput[] | undefined {
    if (!Array.isArray(payloads)) {
        return undefined;
    }

    const sanitisedPayloads: WidgetPayloadInput[] = [];
    for (const payload of payloads) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            continue;
        }

        const tool = normaliseToolName((payload as { tool?: unknown }).tool);
        if (!tool) {
            continue;
        }

        const facts = Array.isArray((payload as { facts?: unknown }).facts)
            ? (payload as { facts: unknown[] }).facts
                .map((fact) => sanitiseString(fact, 300))
                .filter((fact): fact is string => Boolean(fact))
                .slice(0, 12)
            : undefined;

        sanitisedPayloads.push({
            tool,
            title: sanitiseString((payload as { title?: unknown }).title, 120) ?? undefined,
            summary: sanitiseString((payload as { summary?: unknown }).summary, 400) ?? undefined,
            facts,
            args: sanitiseStringRecord((payload as { args?: unknown }).args)
        });
    }

    return sanitisedPayloads;
}

function sanitiseToolList(tools: unknown) {
    if (!Array.isArray(tools)) {
        return [];
    }

    return tools
        .map((tool) => normaliseToolName(tool))
        .filter((tool): tool is string => Boolean(tool));
}

function isLikelyBase64(value: string) {
    return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isAllowedAudioMimeType(value: string) {
    return ALLOWED_AUDIO_MIME_TYPES.has(value.toLowerCase().replace(/\s+/g, ''));
}

function hasClearUiIntent(text: string) {
    const t = text.toLowerCase();
    return /\b(clear|reset|declutter|remove)\b/.test(t) && /\b(ui|widget|widgets|stage|screen)\b/.test(t);
}

function mergeUniqueActions(base: Array<{ tool: string; args?: Record<string, string> }>, extra: Array<{ tool: string; args?: Record<string, string> }>, max = 8) {
    const merged = [...base];
    const seen = new Set(base.map((a) => a.tool));
    for (const action of extra) {
        if (seen.has(action.tool)) {
            continue;
        }
        merged.push(action);
        seen.add(action.tool);
        if (merged.length >= max) {
            break;
        }
    }
    return merged;
}

function broadcastLiveEvent(event: LiveStreamEvent | { type: 'snapshot'; snapshot: Snapshot }) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of liveEventClients) {
        client.write(payload);
    }
}

setLiveToolHandler((tool, args) => {
    const safeTool = normaliseToolName(tool);
    if (!safeTool || safeTool === 'get_ui_state' || safeTool === 'get_operational_state') {
        return 'Unsupported tool request ignored.';
    }

    const safeArgs = sanitiseStringRecord(args);
    turnFunctionCalls.add(safeTool);
    if (safeTool === 'clear_ui_widgets' && (!hasLiveVisibleWidgets() || !hasClearUiIntent(lastOperatorInput))) {
        return 'No action needed. Continue with the operator request.';
    }
    applyLiveWidgetTool(safeTool);
    const action = { tool: safeTool, args: safeArgs };
    applyAction(state, action);
    broadcastLiveEvent({ type: 'snapshot', snapshot: state });

    if (safeTool === 'draft_email_campaign') {
        const prompt = safeArgs.campaign || safeArgs.subject || '';
        // Only generate image if we have a meaningful campaign description (3+ words)
        const isPromptReady = prompt.trim().split(/\s+/).length >= 3;
        if (isPromptReady && !pendingImageGen) {
            const imagePrompt = `Generate a single mobile phone email newsletter screenshot for: ${prompt}. Portrait orientation (9:16 ratio), narrow mobile width, no desktop padding or white borders. Show the full email: brand logo header, eye-catching hero photo, headline text, short body copy, a bold CTA button, and a footer with social icons. Dark or coloured background, premium modern design, photorealistic render. Single column layout, no side-by-side panels.`;
            pendingImageGen = true;
            generateBrandImage(imagePrompt).then((b64) => {
                if (b64) {
                    updateLatestActionArgs(state, 'email_campaigns', { imageUrl: b64 });
                    broadcastLiveEvent({ type: 'snapshot', snapshot: state });
                }
            }).catch(console.error).finally(() => { pendingImageGen = false; });
        }
        return isPromptReady
            ? 'Email drafting started. The email preview image is being generated. Tell the user to review the preview on screen and ask if they are happy to send it.'
            : 'Email campaign created but needs more detail. Ask the user to confirm the full offer details (what discount, what product, any code) so you can finalise the email with a proper preview image.';
    }

    if (safeTool === 'dispatch_email_campaign') {
        return 'Email dispatched successfully. Inform the user it has been sent.';
    }
    
    if (safeTool === 'draft_sms_campaign' || safeTool === 'draft_marketing_push') {
        return 'Drafting started. Tell the user to review the preview on screen and ask if they are happy to send it.';
    }

    if (safeTool === 'dispatch_sms_campaign' || safeTool === 'dispatch_marketing_push') {
        return 'Campaign dispatched successfully. Inform the user it has been sent.';
    }

    // Pass the newly populated panel data back to the voice model so it has context to talk about
    const latestAction = state.actions[0];
    if (latestAction && latestAction.domain) {
        const panel = state.panels.find(p => p.id === latestAction.domain);
        if (panel) {
            return `Action completed. Screen updated. Live data for this domain (${panel.label}): ${panel.value} - ${panel.detail}`;
        }
    }

    return 'Action completed successfully and updated on screen.';
});

subscribeLiveEvents((event) => {
    broadcastLiveEvent(event);

    if (event.type === 'input_transcript' && event.final) {
        lastOperatorInput = event.text;
    }

    // When a live voice turn completes, determine actions via multiple fallback paths
    if (event.type === 'turn_complete') {
        try {
            const inp = event.inputText || '';
            const out = event.outputText || '';
            if (inp || out) {
                // 1. Try output-transcript matching first (most accurate)
                let plan = createSmartPlan(inp, out, state);
                plan.actions = plan.actions.filter(a => !turnFunctionCalls.has(a.tool));
                plan.actions = plan.actions.filter(a => a.tool !== 'clear_ui_widgets' || (hasLiveVisibleWidgets() && hasClearUiIntent(inp)));

                // 2. Coverage layer: merge request-derived info actions so broad asks do not collapse to one tool.
                if (inp) {
                    const fallback = createMockPlan(inp, state);
                    const low = inp.toLowerCase();
                    const hasConfirmation = /\b(yes|yep|yeah|go ahead|send it|do it|confirm|go for it|that's right|sounds good|perfect|ok send|ok do|please do|let's do|approved)\b/i.test(low);
                    const hasDetail = /\d+%|\d+ percent/i.test(low) || low.split(/\s+/).length > 8;

                    const filteredFallback = fallback.actions.filter(a => {
                        // Don't let the coverage layer re-add draft/dispatch actions already handled by Tier 1
                        if (turnFunctionCalls.has(a.tool)) return false;
                        if (a.tool.startsWith('draft_') && turnFunctionCalls.has(a.tool)) return false;
                        if (INFO_TOOLS.has(a.tool)) return true;
                        return hasConfirmation || hasDetail;
                    });

                    if (plan.actions.length === 0 && filteredFallback.length > 0) {
                        plan = { ...fallback, actions: filteredFallback };
                    } else {
                        const infoFallback = filteredFallback.filter((a) => INFO_TOOLS.has(a.tool));
                        if (infoFallback.length > 0) {
                            plan.actions = mergeUniqueActions(plan.actions, infoFallback, 8);
                        }
                    }
                }

                state = applyPlan(state, inp, plan, 'live');
                for (const action of plan.actions) {
                    applyLiveWidgetTool(action.tool);
                }
                broadcastLiveEvent({ type: 'snapshot', snapshot: state });
                // NOTE: do NOT call syncLiveAudioState here.
                // State context is already synced with each audio chunk via audioTurnStatePrimed
                // in sendLiveAudioChunk. Calling sendClientContent here injects fake 'user' role
                // content that triggers empty turns and kills the session.
            }
        } catch (err) {
            console.error('[TURN_COMPLETE] Error processing turn:', err);
        } finally {
            turnFunctionCalls.clear();
            lastOperatorInput = '';
        }
    }
});

function sendJson(request: http.IncomingMessage, response: http.ServerResponse, payload: unknown, statusCode = 200) {
    response.writeHead(statusCode, buildResponseHeaders(request, {
        'Content-Type': 'application/json; charset=utf-8'
    }));
    response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
    const contentType = request.headers['content-type'];
    if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
        throw createRequestError('Content-Type must be application/json.', 415);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > MAX_JSON_BODY_BYTES) {
            throw createRequestError('Request body is too large.', 413);
        }
        chunks.push(buffer);
    }

    if (chunks.length === 0) {
        return {} as T;
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    } catch {
        throw createRequestError('Request body must be valid JSON.', 400);
    }
}

function resolveMode(mode: ResponseMode | undefined): ResponseMode {
    if (mode === 'mock' || mode === 'gemini' || mode === 'live') {
        return mode;
    }
    return 'auto';
}

async function respondToPrompt(prompt: string, requestedMode: ResponseMode): Promise<Snapshot> {
    const mode = resolveMode(requestedMode);
    const tryLive = mode === 'live' || mode === 'auto';
    const tryGemini = mode === 'gemini' || mode === 'auto';

    if (tryLive) {
        try {
            const livePlan = await planWithLiveSession(prompt, state);
            if (livePlan) {
                livePlan.actions = livePlan.actions.filter(a => a.tool !== 'clear_ui_widgets' || (hasLiveVisibleWidgets() && hasClearUiIntent(prompt)));
                state = applyPlan(state, prompt, livePlan, 'live');
                for (const action of livePlan.actions) {
                    applyLiveWidgetTool(action.tool);
                }
                return state;
            }
        } catch (error) {
            console.error('Live session planning failed, falling back.', error);
        }
    }

    if (tryGemini) {
        try {
            const geminiPlan = await planWithGemini(prompt, state);
            if (geminiPlan) {
                geminiPlan.actions = geminiPlan.actions.filter(a => a.tool !== 'clear_ui_widgets' || (hasLiveVisibleWidgets() && hasClearUiIntent(prompt)));
                state = applyPlan(state, prompt, geminiPlan, 'gemini');
                for (const action of geminiPlan.actions) {
                    applyLiveWidgetTool(action.tool);
                }
                return state;
            }
        } catch (error) {
            console.error('Gemini planning failed, falling back to mock planner.', error);
        }
    }

    const mockPlan = createMockPlan(prompt, state);
    mockPlan.actions = mockPlan.actions.filter(a => a.tool !== 'clear_ui_widgets' || (hasLiveVisibleWidgets() && hasClearUiIntent(prompt)));
    state = applyPlan(state, prompt, mockPlan, 'mock');
    for (const action of mockPlan.actions) {
        applyLiveWidgetTool(action.tool);
    }
    return state;
}

const server = http.createServer((request, response) => {
    void (async () => {
        if (!request.url) {
            sendJson(request, response, { error: 'Missing URL' }, 400);
            return;
        }

        if (request.method === 'OPTIONS') {
            assertAllowedOrigin(request);
            sendJson(request, response, {});
            return;
        }

        assertAllowedOrigin(request);

        if (request.method === 'GET' && request.url === '/api/state') {
            sendJson(request, response, state);
            return;
        }


        if (request.method === 'GET' && request.url === '/api/config') {
            sendJson(request, response, {
                liveReady,
                liveSessionReady,
                defaultMode: liveSessionReady ? 'live' : liveReady ? 'auto' : 'mock',
                suggestions: [
                    'Hey TillTech, give me a quick operational rundown for the main restaurant today.',
                    'Morning TillTech. Did everyone show up on time today?',
                    'Check the stock levels in the main prep kitchen. How are we looking on fresh dough?',
                    'Push a quick promo for loaded fries to help margin tonight.'
                ]
            });
            return;
        }

        if (request.method === 'GET' && request.url === '/api/live/events') {
            response.writeHead(200, buildResponseHeaders(request, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive'
            }));
            response.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: state })}\n\n`);
            liveEventClients.add(response);

            request.on('close', () => {
                liveEventClients.delete(response);
            });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/session/respond') {
            const body = await readJsonBody<{ prompt?: string; mode?: ResponseMode }>(request);
            const prompt = body.prompt?.trim();

            if (!prompt) {
                sendJson(request, response, { error: 'Prompt is required.' }, 400);
                return;
            }

            const nextState = await respondToPrompt(prompt, body.mode ?? 'auto');
            broadcastLiveEvent({ type: 'snapshot', snapshot: nextState });
            sendJson(request, response, nextState);
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/session/start') {
            const body = await readJsonBody<{ greet?: boolean; tools?: string[]; seq?: number; clientId?: string; widgets?: WidgetPayloadInput[] }>(request);
            const greet = Boolean(body.greet);
            // Reset state for each new session so stale drafts don't block new actions
            state = createInitialSnapshot(liveReady);
            pendingImageGen = false;
            turnFunctionCalls.clear();
            lastOperatorInput = '';
            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
            if (Array.isArray(body.tools)) {
                updateLiveVisibleWidgets(sanitiseToolList(body.tools), body.seq, body.clientId, sanitiseWidgetPayloads(body.widgets));
            }
            const started = await startLiveAudioSession({ greet });
            if (!started) {
                sendJson(request, response, { error: 'Live session is unavailable.' }, 503);
                return;
            }
            syncLiveAudioState(state);
            if (greet) {
                requestLiveGreeting();
            }
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/audio') {
            const body = await readJsonBody<{ audioBase64?: string; mimeType?: string }>(request);

        if (!body.audioBase64 || !body.mimeType) {
            sendJson(request, response, { error: 'audioBase64 and mimeType are required.' }, 400);
            return;
        }

        if (body.audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
            sendJson(request, response, { error: 'audioBase64 payload is invalid or too large.' }, 400);
            return;
        }

        const audioBase64 = body.audioBase64.replace(/\s+/g, '');
        if (audioBase64.length > MAX_AUDIO_BASE64_CHARS || !isLikelyBase64(audioBase64)) {
            sendJson(request, response, { error: 'audioBase64 payload is invalid or too large.' }, 400);
            return;
        }

            const mimeType = body.mimeType.trim();
            if (!isAllowedAudioMimeType(mimeType)) {
                sendJson(request, response, { error: 'mimeType must be a valid audio content type.' }, 400);
                return;
            }

            try {
                await sendLiveAudioChunk(audioBase64, mimeType, state);
            } catch { /* session already closed — drop silently */ }
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/text') {
            const body = await readJsonBody<{ text?: string; tools?: string[]; seq?: number; clientId?: string; widgets?: WidgetPayloadInput[] }>(request);
            const text = body.text?.trim();

            if (!text) {
                sendJson(request, response, { error: 'text is required.' }, 400);
                return;
            }

            if (Array.isArray(body.tools)) {
                updateLiveVisibleWidgets(sanitiseToolList(body.tools), body.seq, body.clientId, sanitiseWidgetPayloads(body.widgets));
                syncLiveAudioState(state);
            }

            const sent = await sendLiveTextInput(text, state);
            if (!sent) {
                sendJson(request, response, { error: 'Live session is unavailable.' }, 503);
                return;
            }
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/ui/widgets') {
            const body = await readJsonBody<{ tools?: string[]; seq?: number; clientId?: string; widgets?: WidgetPayloadInput[] }>(request);
            updateLiveVisibleWidgets(sanitiseToolList(body.tools), body.seq, body.clientId, sanitiseWidgetPayloads(body.widgets));
            syncLiveAudioState(state);
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/audio/stop') {
            await stopLiveAudioInput();
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/session/close') {
            closeLiveSession();
            sendJson(request, response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/scenario/reset') {
            closeLiveSession();
            clearLiveVisibleWidgets();
            resetLiveTranscriptHistory();
            state = createInitialSnapshot(liveReady);
            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
            sendJson(request, response, state);
            return;
        }

        sendJson(request, response, { error: 'Missing URL' }, 400);
    })().catch((error) => {
        console.error(error);
        const statusCode = typeof (error as Partial<RequestError>)?.statusCode === 'number'
            ? (error as RequestError).statusCode
            : 500;
        const message = statusCode === 500 ? 'Internal server error' : (error as Error).message;
        sendJson(request, response, { error: message }, statusCode);
    });
});

server.listen(port, () => {
    console.log(`Tilly Live Ops server listening on http://localhost:${port}`);
});
