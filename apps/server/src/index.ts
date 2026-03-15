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

let state = createInitialSnapshot(liveReady);
const liveEventClients = new Set<http.ServerResponse>();
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
    turnFunctionCalls.add(tool);
    if (tool === 'clear_ui_widgets' && (!hasLiveVisibleWidgets() || !hasClearUiIntent(lastOperatorInput))) {
        return 'No action needed. Continue with the operator request.';
    }
    applyLiveWidgetTool(tool);
    const action = { tool, args: args as Record<string, string> };
    applyAction(state, action);
    broadcastLiveEvent({ type: 'snapshot', snapshot: state });

    if (tool === 'draft_email_campaign') {
        const prompt = args.campaign || args.subject || 'A promotional hospitality email marketing campaign';
        const imagePrompt = `Generate a single mobile phone email newsletter screenshot for: ${prompt}. Portrait orientation (9:16 ratio), narrow mobile width, no desktop padding or white borders. Show the full email: brand logo header, eye-catching hero photo, headline text, short body copy, a bold CTA button, and a footer with social icons. Dark or coloured background, premium modern design, photorealistic render. Single column layout, no side-by-side panels.`;
        generateBrandImage(imagePrompt).then((b64) => {
            if (b64) {
                updateLatestActionArgs(state, 'email_campaigns', { imageUrl: b64 });
                broadcastLiveEvent({ type: 'snapshot', snapshot: state });
            }
        }).catch(console.error);
        return 'Email drafting started in the background. Tell the user to review the preview on screen and ask if they are happy to send it.';
    }

    if (tool === 'dispatch_email_campaign') {
        return 'Email dispatched successfully. Inform the user it has been sent.';
    }
    
    if (tool === 'draft_sms_campaign' || tool === 'draft_marketing_push') {
        return 'Drafting started. Tell the user to review the preview on screen and ask if they are happy to send it.';
    }

    if (tool === 'dispatch_sms_campaign' || tool === 'dispatch_marketing_push') {
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

                // Trigger background image generation for email drafts from Tier 2/3 paths
                // (Tier 1 tool handler already has its own trigger)
                if (action.tool === 'draft_email_campaign' && !turnFunctionCalls.has('draft_email_campaign')) {
                    // Only generate if no image exists yet for this draft
                    const existingEmailAction = state.actions.find(a => a.domain === 'email_campaigns');
                    if (existingEmailAction?.args?.imageUrl) continue;
                    const prompt = action.args?.campaign || action.args?.subject || 'A promotional hospitality email marketing campaign';
                    const imagePrompt = `Generate a single mobile phone email newsletter screenshot for: ${prompt}. Portrait orientation (9:16 ratio), narrow mobile width, no desktop padding or white borders. Show the full email: brand logo header, eye-catching hero photo, headline text, short body copy, a bold CTA button, and a footer with social icons. Dark or coloured background, premium modern design, photorealistic render. Single column layout, no side-by-side panels.`;
                    generateBrandImage(imagePrompt).then((b64) => {
                        if (b64) {
                            updateLatestActionArgs(state, 'email_campaigns', { imageUrl: b64 });
                            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
                        }
                    }).catch(console.error);
                }
            }
            broadcastLiveEvent({ type: 'snapshot', snapshot: state });
            syncLiveAudioState(state);
        }
        turnFunctionCalls.clear();
        lastOperatorInput = '';
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
            const body = await readJsonBody<{ greet?: boolean; tools?: string[]; seq?: number; clientId?: string; widgets?: Array<{ tool: string; title?: string; summary?: string; facts?: string[]; args?: Record<string, string> }> }>(request);
            const greet = Boolean(body.greet);
            if (Array.isArray(body.tools)) {
                updateLiveVisibleWidgets(body.tools, body.seq, body.clientId, body.widgets);
            }
            const started = await startLiveAudioSession({ greet });
            if (!started) {
                sendJson(response, { error: 'Live session is unavailable.' }, 503);
                return;
            }
            syncLiveAudioState(state);
            if (greet) {
                requestLiveGreeting();
            }
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/audio') {
            const body = await readJsonBody<{ audioBase64?: string; mimeType?: string }>(request);

            if (!body.audioBase64 || !body.mimeType) {
                sendJson(response, { error: 'audioBase64 and mimeType are required.' }, 400);
                return;
            }

            try {
                await sendLiveAudioChunk(body.audioBase64, body.mimeType, state);
            } catch { /* session already closed — drop silently */ }
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/text') {
            const body = await readJsonBody<{ text?: string; tools?: string[]; seq?: number; clientId?: string; widgets?: Array<{ tool: string; title?: string; summary?: string; facts?: string[]; args?: Record<string, string> }> }>(request);
            const text = body.text?.trim();

            if (!text) {
                sendJson(response, { error: 'text is required.' }, 400);
                return;
            }

            if (Array.isArray(body.tools)) {
                updateLiveVisibleWidgets(body.tools, body.seq, body.clientId, body.widgets);
                syncLiveAudioState(state);
            }

            const sent = await sendLiveTextInput(text, state);
            if (!sent) {
                sendJson(response, { error: 'Live session is unavailable.' }, 503);
                return;
            }
            sendJson(response, { ok: true });
            return;
        }

        if (request.method === 'POST' && request.url === '/api/live/ui/widgets') {
            const body = await readJsonBody<{ tools?: string[]; seq?: number; clientId?: string; widgets?: Array<{ tool: string; title?: string; summary?: string; facts?: string[]; args?: Record<string, string> }> }>(request);
            const tools = Array.isArray(body.tools) ? body.tools : [];
            updateLiveVisibleWidgets(tools, body.seq, body.clientId, body.widgets);
            syncLiveAudioState(state);
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
            clearLiveVisibleWidgets();
            resetLiveTranscriptHistory();
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
