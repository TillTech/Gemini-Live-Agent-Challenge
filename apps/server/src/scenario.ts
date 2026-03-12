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

function pushAction(snapshot: Snapshot, title: string, domain: string, detail: string, args?: Record<string, string>) {
    const nextAction: Snapshot['actions'][number] = {
        id: `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        status: 'done',
        domain,
        detail,
        ...(args ? { args } : {})
    };

    snapshot.actions = [
        nextAction,
        ...snapshot.actions
    ].slice(0, 8);
}

// ── Data Extraction from transcript ───────────────
function extractData(text: string) {
    // Extract percentage
    const pctMatch = text.match(/(\d+)\s*%/);
    const pct = pctMatch ? `${pctMatch[1]}%` : '';

    // Extract item/product names (common food/product items)
    const itemPatterns = [
        /(?:loaded\s+fries|garlic\s+bread|iced?\s+latte|pizza|burger|wings|nachos|salad|coffee|beans|dough|pepperoni|cheese|sides|pasta|soup|dessert|brownie|cookie|cake|milkshake|smoothie|wrap|sandwich|chips|onion\s+rings|mozzarella\s+sticks)/i
    ];
    let item = '';
    for (const p of itemPatterns) {
        const m = text.match(p);
        if (m) { item = m[0]; break; }
    }

    // Extract person names
    const nameMatch = text.match(/(?:Sarah|Marcus|Jade|Tom|Priya|Alex|Emma|Jake|Sam|Lisa|Beth|David|Ryan|Amy|Rachel|Mike|Dan)\s*(?:\w\.?)?/i);
    const name = nameMatch ? nameMatch[0].trim() : '';

    // Extract time values
    const timeMatch = text.match(/(\d+)\s*(?:min(?:utes?)?|hrs?|hours?)/i);
    const time = timeMatch ? timeMatch[0] : '';

    // Extract campaign/promo name — look for what the promo is about
    const campaignMatch = text.match(/(?:campaign|promo(?:tion)?|offer|deal)\s+(?:for\s+)?(?:the\s+)?([^,.!?]+)/i);
    const campaign = campaignMatch ? campaignMatch[1].trim() : (item ? `${item} promotion` : '');

    // Extract code
    const codeMatch = text.match(/(?:code|voucher|coupon)\s+(\w+)/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';

    // Extract points value
    const ptsMatch = text.match(/(\d+)\s*(?:points|pts)/i);
    const points = ptsMatch ? ptsMatch[1] : '';

    // Extract recipients count
    const recipMatch = text.match(/([\d,]+)\s*(?:users?|recipients?|customers?|people|app\s*users)/i);
    const recipients = recipMatch ? recipMatch[1] : '';

    return { pct, item, name, time, campaign, code, points, recipients };
}

export function applyAction(snapshot: Snapshot, action: PlannedAction) {
    const args = action.args ?? {};
    switch (action.tool) {
        case 'check_driver_status': {
            const delayInfo = args.detail || 'One driver is showing a delay on the current route.';
            const delayTime = args.time || '15 min delay';
            snapshot.panels = updatePanel(snapshot.panels, 'drivers', {
                value: args.value || '1 delayed',
                detail: delayInfo,
                tone: 'warn',
                metric: delayTime
            });
            snapshot.panels = updatePanel(snapshot.panels, 'logistics', {
                value: 'Traffic pressure',
                detail: 'Live route board shows affected driver routing.',
                tone: 'warn',
                metric: args.routeInfo || 'Congestion active'
            });
            pushAction(snapshot, 'Checked driver shift and delay status', 'drivers', delayInfo, args);
            break;
        }
        case 'send_customer_apology': {
            const msg = args.message || 'Customer notified about delayed delivery.';
            pushAction(snapshot, 'Sent delivery delay apology SMS', 'customer', msg, args);
            break;
        }
        case 'add_loyalty_points': {
            const pts = args.points || '250';
            pushAction(snapshot, `Added ${pts} loyalty points`, 'loyalty', `Compensation credit of ${pts} points applied.`, args);
            break;
        }
        case 'check_inventory_status': {
            const critItem = args.item || 'Fresh dough';
            snapshot.panels = updatePanel(snapshot.panels, 'inventory', {
                value: args.value || `${critItem} low`,
                detail: args.detail || `${critItem} has fallen below the safety threshold.`,
                tone: 'critical',
                metric: 'Below threshold'
            });
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen', {
                value: 'Conservation watch',
                detail: args.kitchenDetail || 'Prep decisions adjusted based on stock levels.',
                tone: 'warn',
                metric: 'Active alert'
            });
            pushAction(snapshot, 'Checked prep kitchen stock levels', 'inventory', `${critItem} risk surfaced.`, args);
            break;
        }
        case 'halt_kitchen_item': {
            const itemName = String(args.item || 'garlic bread');
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen', {
                value: `${itemName} paused`,
                detail: args.detail || `Kitchen flow updated to halt ${itemName} prep.`,
                tone: 'critical',
                metric: '1 menu item blocked'
            });
            pushAction(snapshot, `Halted ${itemName} on kitchen flow`, 'kitchen', `Prep protection applied for ${itemName}.`, args);
            break;
        }
        case 'draft_promo': {
            const promoName = String(args.campaign || args.item || 'promotion');
            const discount = args.pct || '';
            snapshot.panels = updatePanel(snapshot.panels, 'marketing', {
                value: 'Draft staged',
                detail: `${discount ? discount + ' off ' : ''}${promoName} campaign drafted and ready for approval.`,
                tone: 'boost',
                metric: 'Offer queued'
            });
            pushAction(snapshot, `Drafted ${discount ? discount + ' off ' : ''}${promoName} campaign`, 'marketing', 'Campaign prepared from operational context.', args);
            break;
        }
        case 'send_marketing_push': {
            const promoName = String(args.campaign || args.item || 'promotion');
            const discount = args.pct || '';
            const code = args.code || '';
            const recipients = args.recipients || '1,200';
            snapshot.panels = updatePanel(snapshot.panels, 'marketing', {
                value: `${code || 'Push'} sent`,
                detail: `${discount ? discount + ' off ' : ''}${promoName} push sent to ${recipients} app users.`,
                tone: 'boost',
                metric: `${recipients} recipients`
            });
            pushAction(snapshot, `Sent ${discount ? discount + ' ' : ''}${promoName} push notification`, 'marketing', `Campaign delivered to the branded app audience.`, args);
            break;
        }
        case 'record_attendance_note': {
            const staffName = args.name || args.staff || 'Staff member';
            const lateTime = args.time || args.note || '15 minutes';
            snapshot.panels = updatePanel(snapshot.panels, 'staff', {
                value: '1 late arrival',
                detail: `${staffName} logged ${lateTime} late. Attendance note recorded.`,
                tone: 'warn',
                metric: `${lateTime} late`
            });
            pushAction(snapshot, `Recorded attendance exception for ${staffName}`, 'staff', 'Late arrival noted.', args);
            break;
        }
        case 'reorder_supplier_item': {
            const itemName = args.item || 'dark roast beans';
            snapshot.panels = updatePanel(snapshot.panels, 'inventory', {
                value: `${itemName} reorder`,
                detail: `Supplier reorder prepared for ${itemName}.`,
                tone: 'boost',
                metric: 'PO drafted'
            });
            pushAction(snapshot, `Reordered ${itemName} from supplier`, 'inventory', 'Purchase order created.', args);
            break;
        }
        case 'optimise_driver_routes': {
            const saved = args.time || '45 minutes';
            snapshot.panels = updatePanel(snapshot.panels, 'logistics', {
                value: 'Routes optimized',
                detail: `Traffic avoidance applied, saving an estimated ${saved} across active runs.`,
                tone: 'boost',
                metric: `${saved} saved`
            });
            pushAction(snapshot, 'Optimised active delivery routes', 'logistics', `Route adjustment applied. ${saved} saved.`, args);
            break;
        }
        default: {
            pushAction(snapshot, `Logged action: ${action.tool}`, 'control', 'Action preserved in timeline.');
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
        { id: 'coverage', label: 'Operational Domains', value: `${new Set(next.panels.filter(p => p.value !== '—').map(p => p.id)).size} active` },
        { id: 'risk', label: 'Critical Risks', value: next.panels.some((entry) => entry.tone === 'critical') ? '2 active' : '1 watch' },
        { id: 'engine', label: 'Agent Engine', value: engine === 'live' ? 'Live session active' : engine === 'gemini' ? 'Gemini active' : 'Mock planner' }
    ];

    return next;
}

function includesAny(text: string, values: string[]) {
    return values.some((value) => text.includes(value));
}

/**
 * Smart plan: matches on Tilly's OUTPUT transcript (what she says she's done)
 * and extracts dynamic data from the conversation.
 * Only fires actions when Tilly's response indicates she has actually performed them.
 */
export function createSmartPlan(inputText: string, outputText: string, current: Snapshot): AgentPlan {
    const out = outputText.toLowerCase();
    const data = extractData(outputText + ' ' + inputText);
    const actions: PlannedAction[] = [];

    // ── Check drivers: Tilly confirms she's checked driver status ──
    if (includesAny(out, ['checked the driver', 'driver status', 'driver update', 'drivers are', 'four drivers', '4 drivers', 'all drivers', 'delivery status', 'clocked in', 'one delayed', 'running late on'])) {
        if (!actions.some(a => a.tool === 'check_driver_status')) {
            actions.push({ tool: 'check_driver_status', args: {
                time: data.time || '15 min delay',
                detail: data.item ? `Driver delayed with ${data.item} order.` : 'One driver is showing a delay on the current route.',
            }});
        }
    }

    // ── Check inventory: Tilly confirms she's checked stock ──
    if (includesAny(out, ['checked the stock', 'stock level', 'inventory check', 'below threshold', 'dough is low', 'running low on', 'stock is', 'inventory shows', 'fallen below', 'portions left', 'portions remaining', 'looking at the stock', 'supply level'])) {
        if (!actions.some(a => a.tool === 'check_inventory_status')) {
            actions.push({ tool: 'check_inventory_status', args: {
                item: data.item || 'Fresh dough',
                detail: data.item ? `${data.item} has fallen below the safety threshold.` : 'Stock level has fallen below the safety threshold.',
            }});
        }
    }

    // ── Halt kitchen item: Tilly confirms she's halted/paused something ──
    if (includesAny(out, ['halted', 'paused the', 'blocked', 'stopped prep', 'kitchen flow updated', 'reserved for pizza', 'pulled from the menu', 'taken off the menu', '86\'d', 'eighty-six'])) {
        actions.push({ tool: 'halt_kitchen_item', args: {
            item: data.item || 'garlic bread',
        }});
    }

    // ── Draft promo: Tilly confirms she's drafted/created a campaign ──
    if (includesAny(out, ['drafted', 'campaign ready', 'campaign created', 'promo drafted', 'promotion created', 'offer created', 'prepared the campaign', 'put together a', "i've created", "i've set up", 'ready for approval'])) {
        actions.push({ tool: 'draft_promo', args: {
            campaign: data.campaign || data.item || 'promotion',
            pct: data.pct,
            item: data.item,
        }});
    }

    // ── Send push: Tilly confirms she's sent a notification ──
    if (includesAny(out, ['sent the push', 'notification sent', 'push sent', 'push notification has been', 'sent to all', 'delivered to', 'sent it out', 'notification has been sent', 'going out now', 'notifications are going'])) {
        if (!actions.some(a => a.tool === 'draft_promo')) {
            actions.push({ tool: 'send_marketing_push', args: {
                campaign: data.campaign || data.item || 'promotion',
                pct: data.pct,
                code: data.code,
                item: data.item,
                recipients: data.recipients || '1,200',
            }});
        }
    }

    // ── Send SMS apology: Tilly confirms she's sent an apology ──
    if (includesAny(out, ['sent the apology', 'apology sent', 'sms sent', 'customer notified', 'message sent to the customer', 'texted the customer', 'sorry message', 'notified the customer'])) {
        actions.push({ tool: 'send_customer_apology', args: {
            message: 'Customer apology sent with delay notification.',
        }});
    }

    // ── Loyalty points: Tilly confirms she's added points ──
    if (includesAny(out, ['added points', 'points added', 'loyalty credit', 'added to their wallet', 'compensated', 'points applied', 'credited', 'bonus points'])) {
        actions.push({ tool: 'add_loyalty_points', args: {
            points: data.points || '250',
        }});
    }

    // ── Staff attendance: Tilly confirms she's recorded attendance ──
    if (includesAny(out, ['attendance logged', 'attendance noted', 'late arrival recorded', 'logged the late', 'flagged in the system', 'marked as late', 'noted that down', 'recorded that'])) {
        if (includesAny(out, ['staff', 'sarah', 'late', 'attendance', 'shift', 'arrived'])) {
            actions.push({ tool: 'record_attendance_note', args: {
                name: data.name || 'Staff member',
                time: data.time || '15 minutes',
            }});
        }
    }

    // ── Reorder: Tilly confirms she's placed/prepared a supplier order ──
    if (includesAny(out, ['reorder placed', 'order placed', 'supplier order', 'reordered', 'purchase order', 'ordered more', 'placed the order', 'po has been', 'restocking order'])) {
        actions.push({ tool: 'reorder_supplier_item', args: {
            item: data.item || 'dark roast beans',
        }});
    }

    // ── Route optimise: Tilly confirms she's optimised routes ──
    if (includesAny(out, ['routes optimised', 'routes optimized', 'rerouted', 'route updated', 'traffic avoidance', 'routes adjusted', 'optimised the route', 'optimized the route', 'routes have been'])) {
        actions.push({ tool: 'optimise_driver_routes', args: {
            time: data.time || '45 minutes',
        }});
    }

    const priorContext = current.meta.lastPrompt ? 'Context from the previous operator turn has been preserved.' : 'This is the opening turn of the session.';

    return {
        summary: actions.length > 0
            ? 'Tilly reviewed the operation and translated findings into visible actions.'
            : 'Tilly is conversing with the operator.',
        spoken: outputText || `${priorContext} Awaiting next instruction.`,
        nextSuggestion: 'Continue the conversation or ask Tilly to act on something specific.',
        actions
    };
}

// INPUT keyword-based fallback — matches the user's words directly
// This is the safety net when the audio model doesn't call tools
export function createMockPlan(prompt: string, current: Snapshot): AgentPlan {
    const text = prompt.toLowerCase();
    const data = extractData(prompt);
    const actions: PlannedAction[] = [];

    if (includesAny(text, ['rundown', 'overview', 'status update', 'brief', 'everything going'])) {
        actions.push({ tool: 'check_driver_status' }, { tool: 'check_inventory_status' });
    }
    if (includesAny(text, ['driver', 'clocked', 'shift', 'delivery']) && !actions.some(a => a.tool === 'check_driver_status')) {
        actions.push({ tool: 'check_driver_status' });
    }
    if (includesAny(text, ['apolog', 'sms'])) {
        actions.push({ tool: 'send_customer_apology' });
    }
    if (includesAny(text, ['loyalty', 'wallet', 'points'])) {
        actions.push({ tool: 'add_loyalty_points', args: { points: data.points || '250' } });
    }
    if (includesAny(text, ['inventory', 'stock', 'dough', 'beans', 'receipt paper', 'kiosk'])) {
        actions.push({ tool: 'check_inventory_status', args: { item: data.item || 'Fresh dough' } });
    }
    if (includesAny(text, ['kitchen', 'prep', 'blocked', 'menu item', 'halt', 'garlic bread', 'save the dough', '86'])) {
        actions.push({ tool: 'halt_kitchen_item', args: { item: data.item || 'garlic bread' } });
    }
    if (includesAny(text, ['promo', 'promotion', 'campaign', 'loaded fries', 'iced latte'])) {
        actions.push({ tool: 'draft_promo', args: { campaign: data.campaign || data.item || 'promotion', pct: data.pct } });
    }
    if (includesAny(text, ['push', 'notification', 'qr code', 'app users', 'send it'])) {
        actions.push({ tool: 'send_marketing_push', args: { campaign: data.campaign || data.item || 'promotion', pct: data.pct } });
    }
    if (includesAny(text, ['staff', 'attendance', 'late', 'absent', 'who was late', 'show up on time', 'note that down', 'sarah'])) {
        actions.push({ tool: 'record_attendance_note', args: { name: data.name || 'Sarah', time: data.time || '15 minutes' } });
    }
    if (includesAny(text, ['reorder', 'supplier', 'beans ordered'])) {
        actions.push({ tool: 'reorder_supplier_item', args: { item: data.item || 'dark roast beans' } });
    }
    if (includesAny(text, ['route', 'reroute', 'optimize', 'optimise', 'traffic'])) {
        actions.push({ tool: 'optimise_driver_routes', args: { time: data.time || '45 minutes' } });
    }

    const priorContext = current.meta.lastPrompt ? 'Context preserved.' : 'Opening turn.';

    return {
        summary: 'Tilly reviewed the shift and identified operational pressure points.',
        spoken: `${priorContext} I checked the live operation and updated the relevant areas.`,
        nextSuggestion: 'Ask Tilly to turn one of the highlighted issues into a concrete recovery action.',
        actions
    };
}