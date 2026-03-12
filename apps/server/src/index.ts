import http from 'node:http';
import { planWithGemini, isGeminiConfigured } from './gemini.js';
import {
    closeLiveSession,
    isLiveConfigured,
    planWithLiveSession,
    sendLiveAudioChunk,
    startLiveAudioSession,
    stopLiveAudioInput,
    subscribeLiveEvents,
    type LiveStreamEvent
} from './liveSession.js';
import { applyAction, applyPlan, createInitialSnapshot, createMockPlan, createSmartPlan } from './scenario.js';
import type { ResponseMode, Snapshot } from './types.js';

const port = Number(process.env.PORT ?? 8787);
const liveReady = isGeminiConfigured();
const liveSessionReady = isLiveConfigured();

let state = createInitialSnapshot(liveReady);
const liveEventClients = new Set<http.ServerResponse>();
const turnFunctionCalls = new Set<string>();

function broadcastLiveEvent(event: LiveStreamEvent | { type: 'snapshot'; snapshot: Snapshot }) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of liveEventClients) {
        client.write(payload);
    }
}

subscribeLiveEvents((event) => {
    broadcastLiveEvent(event);

    // Track tools already called via function_call during this turn
    if (event.type === 'function_call') {
        turnFunctionCalls.add(event.name);
        const action = { tool: event.name, args: event.args as Record<string, string> };
        applyAction(state, action);
        broadcastLiveEvent({ type: 'snapshot', snapshot: state });
    }

    // When a live voice turn completes, determine actions via multiple fallback paths
    if (event.type === 'turn_complete') {
        const inp = event.inputText || '';
        const out = event.outputText || '';
        if (inp || out) {
            // 1. Try output-transcript matching first (most accurate)
            let plan = createSmartPlan(inp, out, state);
            plan.actions = plan.actions.filter(a => !turnFunctionCalls.has(a.tool));

            // 2. If no function_calls happened AND smart plan found nothing, 
            //    fall back to INPUT keyword matching (the audio model doesn't reliably call tools)
            if (turnFunctionCalls.size === 0 && plan.actions.length === 0 && inp) {
                const INFO_TOOLS = new Set(['check_driver_status', 'check_inventory_status', 'record_attendance_note']);
                const fallback = createMockPlan(inp, state);
                
                // Check if input has confirmation language or specific detail
                const low = inp.toLowerCase();
                const hasConfirmation = /\b(yes|yep|yeah|go ahead|send it|do it|confirm|go for it|that's right|sounds good|perfect|ok send|ok do|please do|let's do|approved)\b/i.test(low);
                const hasDetail = /\d+%|\d+ percent/i.test(low) || low.split(/\s+/).length > 8;
                
                // De-duplicate against existing snapshot actions
                const existing = new Set(state.actions.map(a => a.domain));
                
                fallback.actions = fallback.actions.filter(a => {
                    const domainMap: Record<string, string> = {
                        check_driver_status: 'logistics', check_inventory_status: 'inventory',
                        halt_kitchen_item: 'kitchen', draft_promo: 'marketing',
                        send_marketing_push: 'marketing', send_customer_apology: 'customer',
                        add_loyalty_points: 'customer', record_attendance_note: 'staff',
                        reorder_supplier_item: 'inventory', optimise_driver_routes: 'logistics'
                    };
                    // Skip if domain already in timeline
                    if (existing.has(domainMap[a.tool] || '')) return false;
                    // Info tools: fire immediately
                    if (INFO_TOOLS.has(a.tool)) return true;
                    // Action tools: only fire with confirmation or enough detail
                    return hasConfirmation || hasDetail;
                });
                if (fallback.actions.length > 0) {
                    plan = fallback;
                }
            }

            state = applyPlan(state, inp, plan, 'live');
            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
        }
        turnFunctionCalls.clear();
    }
});

function sendJson(response: http.ServerResponse, payload: unknown, statusCode = 200) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
        return {} as T;
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
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
                state = applyPlan(state, prompt, livePlan, 'live');
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
                state = applyPlan(state, prompt, geminiPlan, 'gemini');
                return state;
            }
        } catch (error) {
            console.error('Gemini planning failed, falling back to mock planner.', error);
        }
    }

    state = applyPlan(state, prompt, createMockPlan(prompt, state), 'mock');
    return state;
}

const server = http.createServer((request, response) => {
    void (async () => {
        if (!request.url) {
            sendJson(response, { error: 'Missing URL' }, 400);
            return;
        }

        if (request.method === 'OPTIONS') {
            sendJson(response, {});
            return;
        }

        if (request.method === 'GET' && request.url === '/api/state') {
            sendJson(response, state);
            return;
        }

        if (request.method === 'GET' && request.url === '/api/config') {
            sendJson(response, {
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
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
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
                sendJson(response, { error: 'Prompt is required.' }, 400);
                return;
            }

            const nextState = await respondToPrompt(prompt, body.mode ?? 'auto');
            broadcastLiveEvent({ type: 'snapshot', snapshot: nextState });
            sendJson(response, nextState);
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/session/start') {
            await startLiveAudioSession();
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/audio') {
            const body = await readJsonBody<{ audioBase64?: string; mimeType?: string }>(request);

            if (!body.audioBase64 || !body.mimeType) {
                sendJson(response, { error: 'audioBase64 and mimeType are required.' }, 400);
                return;
            }

            await sendLiveAudioChunk(body.audioBase64, body.mimeType);
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/audio/stop') {
            await stopLiveAudioInput();
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/session/close') {
            closeLiveSession();
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/scenario/reset') {
            closeLiveSession();
            state = createInitialSnapshot(liveReady);
            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
            sendJson(response, state);
            return;
        }

        sendJson(response, { error: 'Missing URL' }, 400);
    })().catch((error) => {
        console.error(error);
        sendJson(response, { error: 'Internal server error' }, 500);
    });
});

server.listen(port, () => {
    console.log(`Tilly Live Ops server listening on http://localhost:${port}`);
});