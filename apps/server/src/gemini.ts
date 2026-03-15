import { GoogleGenAI } from '@google/genai';
import type { AgentPlan, PlannedAction, Snapshot } from './types.js';

function hasUsableString(value: string | undefined) {
    return Boolean(value && value.trim().length > 0);
}

export function isGeminiConfigured() {
    const apiKey = process.env.GOOGLE_API_KEY;
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_REGION;
    const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';

    if (useVertex) {
        return hasUsableString(project) && hasUsableString(location);
    }

    return hasUsableString(apiKey);
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

function extractText(response: unknown): string {
    const candidate = response as { text?: string | (() => string) };
    if (typeof candidate.text === 'function') {
        return candidate.text();
    }
    if (typeof candidate.text === 'string') {
        return candidate.text;
    }
    return '';
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
            nextSuggestion: typeof parsed.nextSuggestion === 'string' ? parsed.nextSuggestion : 'Ask for the next operational action to take.',
            actions
        };
    } catch {
        return null;
    }
}

function summariseState(snapshot: Snapshot) {
    return snapshot.panels
        .map((panel) => `${panel.label}: ${panel.value} (${panel.detail})`)
        .join('\n');
}

export async function planWithGemini(prompt: string, snapshot: Snapshot): Promise<AgentPlan | null> {
    if (!isGeminiConfigured()) {
        return null;
    }

    const model = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-image-preview';
    const client = buildClient();

    const transcript = snapshot.transcript.map((entry) => `${entry.role}: ${entry.text}`).join('\n');
    const stateSummary = summariseState(snapshot);

    const instruction = [
        'You are Tilly, a calm hospitality operations agent.',
        'You are helping an operator through one continuous live shift conversation.',
        'Return valid JSON only.',
        'Pick only from these tools: check_driver_status, send_customer_apology, add_loyalty_points, check_inventory_status, halt_kitchen_item, draft_promo, send_marketing_push, record_attendance_note, reorder_supplier_item, optimise_driver_routes, clear_ui_widgets.',
        'Use 0 to 4 actions, keep them concrete, and preserve continuity from previous turns.',
        'The spoken field must sound like a live verbal response, not a changelog.'
    ].join(' ');

    const response = await client.models.generateContent({
        model,
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: `${instruction}\n\nCurrent state:\n${stateSummary}\n\nTranscript so far:\n${transcript}\n\nOperator prompt:\n${prompt}\n\nReturn JSON with shape {"summary": string, "spoken": string, "nextSuggestion": string, "actions": [{"tool": string, "args": object?}]}`
                    }
                ]
            }
        ],
        config: {
            responseMimeType: 'application/json',
            temperature: 0.2
        }
    } as never);

    return safeParsePlan(extractText(response));
}

export async function generateBrandImage(prompt: string): Promise<string | null> {
    if (!isGeminiConfigured()) {
        return null;
    }

    // IMPORTANT: Image generation requires a dedicated image-capable model.
    // This MUST NOT share GEMINI_MODEL which may be a text-only model.
    // Uses generateContent with responseModalities, NOT generateImages.
    // See: https://ai.google.dev/gemini-api/docs/image-generation
    const imageModel = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image-preview';

    try {
        const client = buildClient();
        const response = await client.models.generateContent({
            model: imageModel,
            contents: prompt,
            config: {
                responseModalities: ['Text', 'Image'],
            }
        } as never);

        const candidates = (response as any).candidates;
        if (candidates && candidates.length > 0) {
            const parts = candidates[0].content?.parts || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    return `data:${mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        console.error(`[generateBrandImage] No image data in ${imageModel} response.`);
        return null;
    } catch (error: any) {
        console.error(`[generateBrandImage] ${imageModel} failed:`, error.message || error);
        return null;
    }
}
