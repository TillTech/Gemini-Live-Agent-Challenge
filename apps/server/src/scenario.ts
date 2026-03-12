import type { AgentPlan, PanelState, PlannedAction, Snapshot, TranscriptEntry } from './types.js';

function nowIso() {
    return new Date().toISOString();
}

function makeEntry(role: TranscriptEntry['role'], text: string): TranscriptEntry {
    return {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text,
        timestamp: nowIso()
    };
}

function panel(id: string, label: string, value: string, detail: string, tone: PanelState['tone'], metric: string): PanelState {
    return { id, label, value, detail, tone, metric };
}

export function createInitialSnapshot(liveReady: boolean): Snapshot {
    return {
        summary: 'Tilly is standing by.',
        speaking: '',
        actions: [
            {
                id: 'boot-1',
                title: 'Ready for first instruction',
                status: 'pending',
                domain: 'control',
                detail: 'Click the orb and start talking to Tilly.'
            }
        ],
        panels: [
            panel('drivers', 'Drivers', '—', 'Awaiting data', 'stable', '—'),
            panel('inventory', 'Inventory', '—', 'Awaiting data', 'stable', '—'),
            panel('kitchen', 'Kitchen', '—', 'Awaiting data', 'stable', '—'),
            panel('marketing', 'Marketing', '—', 'Awaiting data', 'stable', '—'),
            panel('staff', 'Staffing', '—', 'Awaiting data', 'stable', '—'),
            panel('logistics', 'Logistics', '—', 'Awaiting data', 'stable', '—')
        ],
        heroStats: [
            { id: 'coverage', label: 'Operational Domains', value: '6 available' },
            { id: 'risk', label: 'Critical Risks', value: '—' },
            { id: 'engine', label: 'Agent Engine', value: liveReady ? 'Gemini Live' : 'Offline' }
        ],
        transcript: [],
        meta: {
            engine: 'mock',
            liveReady,
            lastPrompt: null,
            nextSuggestion: 'Ask for a quick operational rundown for the main restaurant.'
        }
    };
}

function updatePanel(panels: PanelState[], id: string, next: Partial<PanelState>) {
    return panels.map((entry) => (entry.id === id ? { ...entry, ...next } : entry));
}

function pushAction(snapshot: Snapshot, title: string, domain: string, detail: string) {
    const nextAction: Snapshot['actions'][number] = {
        id: `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        status: 'done',
        domain,
        detail
    };

    snapshot.actions = [
        nextAction,
        ...snapshot.actions
    ].slice(0, 8);
}

export function applyAction(snapshot: Snapshot, action: PlannedAction) {
    switch (action.tool) {
        case 'check_driver_status': {
            snapshot.panels = updatePanel(snapshot.panels, 'drivers', {
                value: '1 delayed',
                detail: 'Driver 2 is delayed by traffic and one order is trending 15 minutes late.',
                tone: 'warn',
                metric: '15 min delay'
            });
            snapshot.panels = updatePanel(snapshot.panels, 'logistics', {
                value: 'Traffic pressure',
                detail: 'Live route board shows one driver affected by motorway congestion.',
                tone: 'warn',
                metric: 'A46 congestion'
            });
            pushAction(snapshot, 'Checked driver shift and delay status', 'drivers', 'All four drivers are clocked in, with one active delay.');
            break;
        }
        case 'send_customer_apology': {
            pushAction(snapshot, 'Sent delivery delay apology SMS', 'customer', 'Customer notified automatically about delayed delivery.');
            break;
        }
        case 'add_loyalty_points': {
            pushAction(snapshot, 'Added loyalty points to app wallet', 'loyalty', 'Compensation credit applied to synthetic app wallet.');
            break;
        }
        case 'check_inventory_status': {
            snapshot.panels = updatePanel(snapshot.panels, 'inventory', {
                value: '20 dough portions',
                detail: 'Fresh dough has fallen below the Friday-night safety threshold for the main prep kitchen.',
                tone: 'critical',
                metric: 'Below threshold'
            });
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen', {
                value: 'Conservation watch',
                detail: 'Prep decisions should prioritize pizza throughput over low-margin sides.',
                tone: 'warn',
                metric: 'Friday surge'
            });
            pushAction(snapshot, 'Checked prep kitchen stock levels', 'inventory', 'Fresh dough risk surfaced for the main kitchen.');
            break;
        }
        case 'halt_kitchen_item': {
            const itemName = String(action.args?.item ?? 'garlic bread');
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen', {
                value: `${itemName} paused`,
                detail: `Kitchen flow updated to halt ${itemName} prep and reserve dough for pizzas.`,
                tone: 'critical',
                metric: '1 menu item blocked'
            });
            pushAction(snapshot, `Halted ${itemName} on kitchen flow`, 'kitchen', 'Prep protection rule pushed to the synthetic kitchen screen state.');
            break;
        }
        case 'draft_promo': {
            const promoName = String(action.args?.campaign ?? 'loaded fries campaign');
            snapshot.panels = updatePanel(snapshot.panels, 'marketing', {
                value: 'Draft staged',
                detail: `${promoName} has been drafted and is ready for approval or push distribution.`,
                tone: 'boost',
                metric: 'Offer queued'
            });
            pushAction(snapshot, 'Drafted targeted recovery promotion', 'marketing', 'Offer logic prepared from current operational context.');
            break;
        }
        case 'send_marketing_push': {
            snapshot.panels = updatePanel(snapshot.panels, 'marketing', {
                value: 'FRIES20 sent',
                detail: 'A 20% off loaded fries push notification was sent to 1,200 synthetic app users.',
                tone: 'boost',
                metric: '1,200 recipients'
            });
            pushAction(snapshot, 'Sent app push and QR-driven promo', 'marketing', 'Recovery campaign delivered to the branded app audience.');
            break;
        }
        case 'record_attendance_note': {
            snapshot.panels = updatePanel(snapshot.panels, 'staff', {
                value: '1 late arrival',
                detail: 'Sarah logged 15 minutes late and the attendance note has been recorded.',
                tone: 'warn',
                metric: '15 min late'
            });
            pushAction(snapshot, 'Recorded attendance exception', 'staff', 'Late arrival noted in the synthetic staffing ledger.');
            break;
        }
        case 'reorder_supplier_item': {
            snapshot.panels = updatePanel(snapshot.panels, 'inventory', {
                value: 'Bean reorder placed',
                detail: 'Primary supplier reorder prepared for dark roast beans.',
                tone: 'boost',
                metric: 'PO drafted'
            });
            pushAction(snapshot, 'Reordered low-stock supplier item', 'inventory', 'Primary supplier purchase order created from the low-stock alert.');
            break;
        }
        case 'optimise_driver_routes': {
            snapshot.panels = updatePanel(snapshot.panels, 'logistics', {
                value: 'Routes optimized',
                detail: 'Traffic avoidance applied, saving an estimated 45 minutes across active runs.',
                tone: 'boost',
                metric: '45 min saved'
            });
            pushAction(snapshot, 'Optimised active delivery routes', 'logistics', 'Traffic-aware route adjustment applied across synthetic drivers.');
            break;
        }
        default: {
            pushAction(snapshot, `Logged unsupported tool ${action.tool}`, 'control', 'Tool preserved in timeline for review during prototyping.');
        }
    }
}

export function applyPlan(current: Snapshot, prompt: string, plan: AgentPlan, engine: 'mock' | 'gemini' | 'live'): Snapshot {
    const next: Snapshot = structuredClone(current);

    next.meta.engine = engine;
    next.meta.lastPrompt = prompt;
    next.meta.nextSuggestion = plan.nextSuggestion;
    next.summary = plan.summary;
    next.speaking = plan.spoken;
    next.transcript = [
        ...next.transcript,
        makeEntry('operator', prompt),
        makeEntry('tilly', plan.spoken)
    ].slice(-10);

    for (const action of plan.actions) {
        applyAction(next, action);
    }

    next.heroStats = [
        { id: 'coverage', label: 'Operational Domains', value: '6 live' },
        { id: 'risk', label: 'Critical Risks', value: next.panels.some((entry) => entry.tone === 'critical') ? '2 active' : '1 watch' },
        { id: 'engine', label: 'Agent Engine', value: engine === 'live' ? 'Live session active' : engine === 'gemini' ? 'Gemini active' : 'Mock planner' }
    ];

    return next;
}

function includesAny(text: string, values: string[]) {
    return values.some((value) => text.includes(value));
}

export function createMockPlan(prompt: string, current: Snapshot): AgentPlan {
    const text = prompt.toLowerCase();
    const actions: PlannedAction[] = [];

    if (includesAny(text, ['rundown', 'overview', 'how are', 'status update', 'brief'])) {
        actions.push({ tool: 'check_driver_status' }, { tool: 'check_inventory_status' });
    }
    if (includesAny(text, ['driver', 'clocked', 'shift', 'delivery']) && !actions.some(a => a.tool === 'check_driver_status')) {
        actions.push({ tool: 'check_driver_status' });
    }
    if (includesAny(text, ['apolog', 'sms'])) {
        actions.push({ tool: 'send_customer_apology' });
    }
    if (includesAny(text, ['loyalty', 'wallet', 'points'])) {
        actions.push({ tool: 'add_loyalty_points' });
    }
    if (includesAny(text, ['inventory', 'stock', 'dough', 'beans', 'receipt paper', 'kiosk'])) {
        actions.push({ tool: 'check_inventory_status' });
    }
    if (includesAny(text, ['halt', 'garlic bread', 'save the dough', '86'])) {
        actions.push({ tool: 'halt_kitchen_item', args: { item: 'garlic bread' } });
    }
    if (includesAny(text, ['promo', 'promotion', 'campaign', 'loaded fries', 'iced latte'])) {
        actions.push({ tool: 'draft_promo', args: { campaign: includesAny(text, ['iced latte']) ? 'iced latte recovery campaign' : 'loaded fries margin campaign' } });
    }
    if (includesAny(text, ['push', 'notification', 'qr code', 'app users', 'send it'])) {
        actions.push({ tool: 'send_marketing_push' });
    }
    if (includesAny(text, ['show up on time', 'late', 'note that down'])) {
        actions.push({ tool: 'record_attendance_note' });
    }
    if (includesAny(text, ['reorder', 'supplier', 'beans ordered'])) {
        actions.push({ tool: 'reorder_supplier_item' });
    }
    if (includesAny(text, ['route', 'reroute', 'optimize', 'optimise', 'traffic'])) {
        actions.push({ tool: 'optimise_driver_routes' });
    }

    if (actions.length === 0) {
        actions.push({ tool: 'check_driver_status' }, { tool: 'check_inventory_status' });
    }

    const priorContext = current.meta.lastPrompt ? 'Context from the previous operator turn has been preserved.' : 'This is the opening turn of the session.';

    return {
        summary: 'Tilly reviewed the shift, identified operational pressure points, and translated them into visible actions.',
        spoken: `${priorContext} I checked the live operation, surfaced the highest-priority issue, and updated the relevant areas so you can act without leaving the command surface.`,
        nextSuggestion: 'Ask Tilly to turn one of the highlighted issues into a concrete recovery action.',
        actions
    };
}