export type ResponseMode = 'auto' | 'mock' | 'gemini' | 'live';

export type Tone = 'stable' | 'warn' | 'critical' | 'boost';

export type TranscriptEntry = {
    id: string;
    role: 'system' | 'operator' | 'tilly';
    text: string;
    timestamp: string;
};

export type ActionItem = {
    id: string;
    title: string;
    status: 'done' | 'pending' | 'draft';
    domain: string;
    detail: string;
    args?: Record<string, string>;
};

export type PanelState = {
    id: string;
    label: string;
    value: string;
    detail: string;
    tone: Tone;
    metric: string;
};

export type HeroStat = {
    id: string;
    label: string;
    value: string;
};

export type SnapshotMeta = {
    engine: 'mock' | 'gemini' | 'live';
    liveReady: boolean;
    lastPrompt: string | null;
    nextSuggestion: string;
};

export type Snapshot = {
    summary: string;
    speaking: string;
    actions: ActionItem[];
    panels: PanelState[];
    heroStats: HeroStat[];
    transcript: TranscriptEntry[];
    meta: SnapshotMeta;
};

export type PlannedAction = {
    tool: string;
    args?: Record<string, string>;
    status?: ActionItem['status'];
};

export type AgentPlan = {
    summary: string;
    spoken: string;
    nextSuggestion: string;
    actions: PlannedAction[];
};

export type RespondRequest = {
    prompt?: string;
    mode?: ResponseMode;
};