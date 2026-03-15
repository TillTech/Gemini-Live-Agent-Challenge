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
            // 🚚 Delivery & Logistics
            panel('delivery_drivers', 'Delivery Drivers', '1 delayed', 'Four evening drivers clocked in. One route affected by traffic.', 'warn', '15 min delay'),
            panel('distribution', 'Distribution', '2 active runs', 'Central dispatch vans en route to stores on schedule.', 'stable', 'On schedule'),
            panel('logistics', 'Logistics Overview', 'Traffic pressure', 'Live routing has one delayed leg; replans available.', 'warn', 'Congestion active'),

            // 📦 Inventory & Stock
            panel('store_stock', 'Store Stock', 'Fresh dough low', 'Fresh dough is below Friday safety threshold.', 'critical', '20 portions'),
            panel('warehouse_stock', 'Warehouse Stock', 'Stable', 'Warehouse buffer stock healthy across core lines.', 'stable', 'All above threshold'),
            panel('supplier_orders', 'Supplier Orders', 'No urgent PO', 'No immediate emergency reorder currently required.', 'stable', 'Queue clear'),
            panel('costings', 'Costings', 'Loaded fries: £2.40', 'Margin currently healthy on featured add-on items.', 'stable', 'Margin healthy'),
            panel('wastage', 'Wastage', '2 flags', 'Today\'s wastage within expected range.', 'warn', '£12 today'),

            // 🍳 Kitchen
            panel('kitchen_flow', 'Kitchen Flow', 'Conservation watch', 'Prep decisions adjusted to protect dough usage.', 'warn', 'Active alert'),
            panel('kitchen_stations', 'Stations', 'All covered', 'Grill, fryer, and expediting positions covered.', 'stable', '4 active'),

            // 📣 Marketing & Campaigns
            panel('promotions', 'Promotions', 'No active draft', 'No live promotional draft currently staged.', 'stable', 'Idle'),
            panel('push_notifications', 'Push Notifications', 'Idle', 'No push broadcast has been sent this shift.', 'stable', '0 sent'),
            panel('email_campaigns', 'Email Campaigns', 'Idle', 'No email campaign currently queued.', 'stable', '0 sent'),
            panel('sms_campaigns', 'SMS Campaigns', 'Idle', 'No SMS campaign currently queued.', 'stable', '0 sent'),

            // 💰 Loyalty & Engagement
            panel('loyalty', 'Loyalty', 'Comp policy ready', 'Loyalty compensation available for service recovery.', 'stable', 'Ready'),
            panel('engagement', 'Games & Incentives', 'Live', 'Scratch & Win active for app users.', 'boost', '38 plays'),

            // 👥 Customer Service
            panel('customer_comms', 'Customer Comms', 'Queue clear', 'No unresolved customer comms escalations.', 'stable', '0 urgent'),

            // 👷 Staffing & HR
            panel('rotas', 'Rotas & Schedules', 'Fully covered', 'Evening rota fully covered for next 48 hours.', 'stable', 'No gaps'),
            panel('attendance', 'Attendance', '1 late arrival', 'Sarah clocked in 15 minutes late.', 'warn', '15 min late'),
            panel('staff_stations', 'Staff Stations', '3 stations active', 'Station assignments confirmed across floor and kitchen.', 'stable', 'All covered'),
            panel('performance', 'Performance', 'Team on track', 'Current shift KPIs tracking to target.', 'stable', 'Avg 92%'),

            // 📊 Accounting & Reports
            panel('payments', 'Payments', '147 today', 'Payment provider online with no failure spike.', 'stable', '£3,240'),
            panel('reports', 'Reports', 'Sales summary', 'Most recent operational report available for review.', 'stable', 'Generated'),
            panel('accounts', 'Accounts', 'VAT current', 'No overdue invoices currently flagged.', 'stable', 'All clear'),
        ],
        heroStats: [
            { id: 'coverage', label: 'Operational Domains', value: '8 areas • 24 panels' },
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
            snapshot.panels = updatePanel(snapshot.panels, 'delivery_drivers', {
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
            pushAction(snapshot, 'Checked driver shift and delay status', 'delivery_drivers', delayInfo, args);
            break;
        }
        case 'send_customer_apology': {
            const msg = args.message || 'Customer notified about delayed delivery.';
            snapshot.panels = updatePanel(snapshot.panels, 'customer_comms', {
                value: 'SMS sent',
                detail: msg,
                tone: 'boost',
                metric: 'Apology dispatched'
            });
            pushAction(snapshot, 'Sent delivery delay apology SMS', 'customer_comms', msg, args);
            break;
        }
        case 'add_loyalty_points': {
            const pts = args.points || '250';
            snapshot.panels = updatePanel(snapshot.panels, 'loyalty', {
                value: `${pts} pts added`,
                detail: `Compensation credit of ${pts} points applied.`,
                tone: 'boost',
                metric: `${pts} points`
            });
            pushAction(snapshot, `Added ${pts} loyalty points`, 'loyalty', `Compensation credit of ${pts} points applied.`, args);
            break;
        }
        case 'check_inventory_status': {
            const critItem = args.item || 'Fresh dough';
            snapshot.panels = updatePanel(snapshot.panels, 'store_stock', {
                value: args.value || `${critItem} low`,
                detail: args.detail || `${critItem} has fallen below the safety threshold.`,
                tone: 'critical',
                metric: 'Below threshold'
            });
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen_flow', {
                value: 'Conservation watch',
                detail: args.kitchenDetail || 'Prep decisions adjusted based on stock levels.',
                tone: 'warn',
                metric: 'Active alert'
            });
            pushAction(snapshot, 'Checked prep kitchen stock levels', 'store_stock', `${critItem} risk surfaced.`, args);
            break;
        }
        case 'halt_kitchen_item': {
            const itemName = String(args.item || 'garlic bread');
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen_flow', {
                value: `${itemName} paused`,
                detail: args.detail || `Kitchen flow updated to halt ${itemName} prep.`,
                tone: 'critical',
                metric: '1 menu item blocked'
            });
            pushAction(snapshot, `Halted ${itemName} on kitchen flow`, 'kitchen_flow', `Prep protection applied for ${itemName}.`, args);
            break;
        }
        case 'draft_promo': {
            const promoName = String(args.campaign || args.item || 'promotion');
            const discount = args.pct || '';
            snapshot.panels = updatePanel(snapshot.panels, 'promotions', {
                value: 'Draft staged',
                detail: `${discount ? discount + ' off ' : ''}${promoName} campaign drafted and ready for approval.`,
                tone: 'boost',
                metric: 'Offer queued'
            });
            pushAction(snapshot, `Drafted ${discount ? discount + ' off ' : ''}${promoName} campaign`, 'promotions', 'Campaign prepared from operational context.', args);
            break;
        }
        case 'send_marketing_push': {
            const promoName = String(args.campaign || args.item || 'promotion');
            const discount = args.pct || '';
            const code = args.code || '';
            const recipients = args.recipients || '1,200';
            snapshot.panels = updatePanel(snapshot.panels, 'push_notifications', {
                value: `${code || 'Push'} sent`,
                detail: `${discount ? discount + ' off ' : ''}${promoName} push sent to ${recipients} app users.`,
                tone: 'boost',
                metric: `${recipients} recipients`
            });
            pushAction(snapshot, `Sent ${discount ? discount + ' ' : ''}${promoName} push notification`, 'push_notifications', `Campaign delivered to the branded app audience.`, args);
            break;
        }
        case 'record_attendance_note': {
            const staffName = args.name || args.staff || 'Staff member';
            const lateTime = args.time || args.note || '15 minutes';
            snapshot.panels = updatePanel(snapshot.panels, 'attendance', {
                value: '1 late arrival',
                detail: `${staffName} logged ${lateTime} late. Attendance note recorded.`,
                tone: 'warn',
                metric: `${lateTime} late`
            });
            pushAction(snapshot, `Recorded attendance exception for ${staffName}`, 'attendance', 'Late arrival noted.', args);
            break;
        }
        case 'reorder_supplier_item': {
            const itemName = args.item || 'dark roast beans';
            snapshot.panels = updatePanel(snapshot.panels, 'supplier_orders', {
                value: `${itemName} reorder`,
                detail: `Supplier reorder prepared for ${itemName}.`,
                tone: 'boost',
                metric: 'PO drafted'
            });
            pushAction(snapshot, `Reordered ${itemName} from supplier`, 'supplier_orders', 'Purchase order created.', args);
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
        // ── New tools for expanded panels ──────────────────
        case 'check_distribution_status': {
            const info = args.detail || 'Central kitchen dispatch on schedule. 2 vans en route to stores.';
            snapshot.panels = updatePanel(snapshot.panels, 'distribution', {
                value: args.value || '2 active runs',
                detail: info,
                tone: 'stable',
                metric: args.metric || 'On schedule'
            });
            pushAction(snapshot, 'Checked distribution fleet status', 'distribution', info, args);
            break;
        }
        case 'check_warehouse_stock': {
            const info = args.detail || 'Warehouse inventory holding steady. No critical shortages flagged.';
            snapshot.panels = updatePanel(snapshot.panels, 'warehouse_stock', {
                value: args.value || 'Stable',
                detail: info,
                tone: 'stable',
                metric: args.metric || 'All above threshold'
            });
            pushAction(snapshot, 'Checked warehouse stock levels', 'warehouse_stock', info, args);
            break;
        }
        case 'check_costings': {
            const itemName = args.item || 'Loaded fries';
            const cost = args.cost || '£2.40';
            snapshot.panels = updatePanel(snapshot.panels, 'costings', {
                value: `${itemName}: ${cost}`,
                detail: args.detail || `Cost per dish for ${itemName} including ingredients and prep labour.`,
                tone: 'stable',
                metric: args.metric || 'Margin healthy'
            });
            pushAction(snapshot, `Retrieved costing breakdown for ${itemName}`, 'costings', `Unit cost: ${cost}`, args);
            break;
        }
        case 'check_wastage': {
            const wasteInfo = args.detail || 'Today\'s wastage within acceptable range. 2 items flagged.';
            snapshot.panels = updatePanel(snapshot.panels, 'wastage', {
                value: args.value || '2 flags',
                detail: wasteInfo,
                tone: args.value ? 'warn' : 'stable',
                metric: args.metric || '£12 today'
            });
            pushAction(snapshot, 'Checked wastage report', 'wastage', wasteInfo, args);
            break;
        }
        case 'check_kitchen_stations': {
            const info = args.detail || 'All stations manned. Expediting position covered by shift lead.';
            snapshot.panels = updatePanel(snapshot.panels, 'kitchen_stations', {
                value: args.value || 'All covered',
                detail: info,
                tone: 'stable',
                metric: args.metric || '4 active'
            });
            pushAction(snapshot, 'Checked kitchen station assignments', 'kitchen_stations', info, args);
            break;
        }
        case 'send_email_campaign': {
            const subject = args.subject || args.campaign || 'Weekly offers';
            snapshot.panels = updatePanel(snapshot.panels, 'email_campaigns', {
                value: 'Campaign sent',
                detail: `"${subject}" email campaign dispatched to ${args.recipients || 'mailing list'}.`,
                tone: 'boost',
                metric: args.recipients ? `${args.recipients} recipients` : 'Sent'
            });
            pushAction(snapshot, `Sent "${subject}" email campaign`, 'email_campaigns', 'Email dispatched.', args);
            break;
        }
        case 'send_sms_campaign': {
            const msg = args.message || args.campaign || 'Weekend deals';
            snapshot.panels = updatePanel(snapshot.panels, 'sms_campaigns', {
                value: 'SMS sent',
                detail: `"${msg}" SMS campaign sent to ${args.recipients || 'customer list'}.`,
                tone: 'boost',
                metric: args.recipients ? `${args.recipients} recipients` : 'Sent'
            });
            pushAction(snapshot, `Sent "${msg}" SMS campaign`, 'sms_campaigns', 'SMS dispatched.', args);
            break;
        }
        case 'check_engagement': {
            const info = args.detail || 'Scratch & Win game active. 38 plays today, 4 prizes claimed.';
            snapshot.panels = updatePanel(snapshot.panels, 'engagement', {
                value: args.value || '38 plays today',
                detail: info,
                tone: 'boost',
                metric: args.metric || '4 prizes'
            });
            pushAction(snapshot, 'Checked engagement games status', 'engagement', info, args);
            break;
        }
        case 'check_rotas': {
            const info = args.detail || 'Evening shift fully covered. No gaps in the next 48 hours.';
            snapshot.panels = updatePanel(snapshot.panels, 'rotas', {
                value: args.value || 'Fully covered',
                detail: info,
                tone: 'stable',
                metric: args.metric || 'No gaps'
            });
            pushAction(snapshot, 'Checked rotas and schedules', 'rotas', info, args);
            break;
        }
        case 'check_staff_stations': {
            const info = args.detail || 'Station assignments confirmed. Grill, fryer, and expedite covered.';
            snapshot.panels = updatePanel(snapshot.panels, 'staff_stations', {
                value: args.value || '3 stations active',
                detail: info,
                tone: 'stable',
                metric: args.metric || 'All covered'
            });
            pushAction(snapshot, 'Checked staff station assignments', 'staff_stations', info, args);
            break;
        }
        case 'check_performance': {
            const staffName = args.name || args.staff || 'Team';
            const info = args.detail || `${staffName} performance metrics updated. On track for the week.`;
            snapshot.panels = updatePanel(snapshot.panels, 'performance', {
                value: args.value || `${staffName} on track`,
                detail: info,
                tone: 'stable',
                metric: args.metric || 'Avg 92%'
            });
            pushAction(snapshot, `Checked performance for ${staffName}`, 'performance', info, args);
            break;
        }
        case 'check_payments': {
            const info = args.detail || 'Payment provider online. 147 transactions today, no failures.';
            snapshot.panels = updatePanel(snapshot.panels, 'payments', {
                value: args.value || '147 today',
                detail: info,
                tone: 'stable',
                metric: args.metric || '£3,240'
            });
            pushAction(snapshot, 'Checked payment status', 'payments', info, args);
            break;
        }
        case 'generate_report': {
            const reportType = args.type || args.report || 'Sales summary';
            snapshot.panels = updatePanel(snapshot.panels, 'reports', {
                value: `${reportType}`,
                detail: args.detail || `${reportType} report generated for the current period.`,
                tone: 'boost',
                metric: 'Generated'
            });
            pushAction(snapshot, `Generated ${reportType} report`, 'reports', 'Report ready for review.', args);
            break;
        }
        case 'check_accounts': {
            const info = args.detail || 'VAT return up to date. No outstanding invoices overdue.';
            snapshot.panels = updatePanel(snapshot.panels, 'accounts', {
                value: args.value || 'VAT current',
                detail: info,
                tone: 'stable',
                metric: args.metric || 'All clear'
            });
            pushAction(snapshot, 'Checked accounts overview', 'accounts', info, args);
            break;
        }
        case 'clear_ui_widgets': {
            const detail = args.detail || 'Cleared active UI widgets from the main stage.';
            pushAction(snapshot, 'Cleared active widget stage', 'control', detail, args);
            break;
        }
        default: {
            pushAction(snapshot, `Logged action: ${action.tool}`, 'control', 'Action preserved in timeline.');
        }
    }
}

export function applyPlan(current: Snapshot, prompt: string, plan: AgentPlan, engine: 'mock' | 'gemini' | 'live'): Snapshot {
    const next: Snapshot = structuredClone(current);
    const trimmedPrompt = prompt.trim();
    const spoken = plan.spoken.trim();

    next.meta.engine = engine;
    if (trimmedPrompt.length > 0) {
        next.meta.lastPrompt = trimmedPrompt;
    }
    next.meta.nextSuggestion = plan.nextSuggestion;
    next.summary = plan.summary;
    next.speaking = spoken;
    const newTranscriptEntries: TranscriptEntry[] = [];
    if (trimmedPrompt.length > 0) {
        newTranscriptEntries.push(makeEntry('operator', trimmedPrompt));
    }
    if (spoken.length > 0) {
        newTranscriptEntries.push(makeEntry('tilly', spoken));
    }
    if (newTranscriptEntries.length > 0) {
        next.transcript = [...next.transcript, ...newTranscriptEntries];
    }

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

function isOverviewIntent(text: string) {
    const t = text.toLowerCase();
    if (includesAny(t, [
        'show me everything',
        'show everything',
        'full overview',
        'full status',
        'complete overview',
        'complete rundown',
        'entire operation',
        'across all areas',
        'across the business',
        'overall status',
        'operational rundown',
        'status update'
    ])) {
        return true;
    }

    const hasRequestVerb = /\b(show|give|check|scan|run|pull|tell|what(?:'| i)s)\b/.test(t);
    const hasScopeWord = /\b(everything|all|full|entire|overall|complete)\b/.test(t);
    const hasDomainWord = /\b(status|overview|rundown|operation|business|systems|areas|state)\b/.test(t);
    return hasRequestVerb && hasScopeWord && hasDomainWord;
}

/**
 * Smart plan: matches on Tilly's OUTPUT transcript (what she says she's done)
 * and extracts dynamic data from the conversation.
 * Only fires actions when Tilly's response indicates she has actually performed them.
 */
export function createSmartPlan(inputText: string, outputText: string, current: Snapshot): AgentPlan {
    const inp = inputText.toLowerCase();
    const out = outputText.toLowerCase();
    const combined = `${inp} ${out}`;
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
    if (includesAny(out, ['attendance logged', 'attendance noted', 'late arrival recorded', 'logged the late arrival', 'attendance entry created', 'marked as late'])) {
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

    // ── Distribution: Tilly confirms she's checked distribution ──
    if (includesAny(out, ['distribution fleet', 'distribution van', 'warehouse dispatch', 'central kitchen dispatch', 'store transfer status', 'dispatch status'])) {
        if (!actions.some(a => a.tool === 'check_distribution_status')) {
            actions.push({ tool: 'check_distribution_status' });
        }
    }

    // ── Warehouse stock: Tilly confirms warehouse stock check ──
    if (includesAny(out, ['warehouse stock', 'warehouse inventory', 'central stock', 'bulk supply'])) {
        if (!actions.some(a => a.tool === 'check_warehouse_stock')) {
            actions.push({ tool: 'check_warehouse_stock' });
        }
    }

    // ── Costings: Tilly confirms cost check (only when giving actual results, not asking questions) ──
    const isAskingCost = includesAny(out, ['which item', 'what would you', 'which dish', 'what menu item', 'which product']);
    if (!isAskingCost && data.item && includesAny(out, ['cost per dish', 'food cost is', 'margin is', 'unit cost is', 'costing for', 'price breakdown', 'gross profit is'])) {
        actions.push({ tool: 'check_costings', args: { item: data.item } });
    }

    // ── Wastage: Tilly confirms wastage review ──
    if (includesAny(out, ['wastage', 'waste report', 'thrown away', 'food waste', 'binned', 'waste level'])) {
        actions.push({ tool: 'check_wastage' });
    }

    // ── Kitchen stations: Tilly confirms station assignments ──
    if (includesAny(out, ['station assignment', 'stations are', 'expedit', 'grill station', 'fryer position', 'line covered'])) {
        actions.push({ tool: 'check_kitchen_stations' });
    }

    // ── Email campaign: Tilly confirms email sent ──
    if (includesAny(out, ['email sent', 'email campaign', 'newsletter', 'email dispatched', 'sent the email'])) {
        actions.push({ tool: 'send_email_campaign', args: { campaign: data.campaign } });
    }

    // ── SMS campaign: Tilly confirms SMS sent ──
    if (includesAny(out, ['sms campaign', 'text message sent', 'sms sent', 'texted', 'text blast'])) {
        if (!actions.some(a => a.tool === 'send_customer_apology')) {
            actions.push({ tool: 'send_sms_campaign', args: { campaign: data.campaign } });
        }
    }

    // ── Engagement: Tilly confirms engagement check ──
    if (includesAny(out, ['scratch card', 'game play', 'engagement rate', 'engagement data', 'incentive program', 'prizes claimed'])) {
        actions.push({ tool: 'check_engagement' });
    }

    // ── Rotas: Tilly confirms rota check ──
    if (includesAny(out, ['rota shows', 'rota is', 'roster for', 'shift coverage', 'shifts are covered', 'fully covered', 'no gaps in', 'shift gap'])) {
        if (!actions.some(a => a.tool === 'check_rotas')) {
            actions.push({ tool: 'check_rotas' });
        }
    }

    // ── Staff stations: Tilly confirms station assignments ──
    if (includesAny(out, ['staff station', 'assigned to', 'station assignment', 'who is where'])) {
        actions.push({ tool: 'check_staff_stations' });
    }

    // ── Performance: Tilly confirms performance review (only when giving results, not asking which staff) ──
    const isAskingPerf = includesAny(out, ['which member', 'which staff', 'who would you', 'whose performance', 'which team member']);
    if (!isAskingPerf && data.name && includesAny(out, ["'s performance", 'performance is', 'performance has been', 'kpi', 'consistency score', 'on track', 'metrics show', 'scored'])) {
        if (!actions.some(a => a.tool === 'check_performance')) {
            actions.push({ tool: 'check_performance', args: { name: data.name } });
        }
    }

    // ── Payments: Tilly confirms payment check ──
    if (includesAny(out, ['payment status', 'payment provider', 'transactions today', 'card machine status', 'settlement', 'no payment failures'])) {
        actions.push({ tool: 'check_payments' });
    }

    // ── Reports: Tilly confirms report generation ──
    if (includesAny(out, ['report generated', 'report ready', 'pulled the report', 'sales report', 'generated the'])) {
        actions.push({ tool: 'generate_report', args: { type: data.item || 'Sales summary' } });
    }

    // ── Accounts: Tilly confirms accounts check ──
    if (includesAny(out, ['vat return', 'invoices outstanding', 'accounts show', 'financial summary', 'tax return'])) {
        if (!actions.some(a => a.tool === 'check_accounts')) {
            actions.push({ tool: 'check_accounts' });
        }
    }

    if (includesAny(out, ['clear the ui', 'clear ui', 'clear widgets', 'clear the widget', 'clear the screen', 'reset the stage', 'clean slate'])) {
        if (!actions.some(a => a.tool === 'clear_ui_widgets')) {
            actions.unshift({ tool: 'clear_ui_widgets' });
        }
    }

    const overviewTools: PlannedAction['tool'][] = [
        'check_driver_status',
        'check_inventory_status',
        'check_distribution_status',
        'check_warehouse_stock',
        'check_kitchen_stations',
        'check_rotas',
        'check_payments',
        'check_accounts'
    ];

    const domainSignals: Array<{ tool: PlannedAction['tool']; keywords: string[] }> = [
        { tool: 'check_driver_status', keywords: ['driver', 'delivery', 'eta', 'route', 'fleet'] },
        { tool: 'check_inventory_status', keywords: ['inventory', 'store stock', 'stock level', 'dough', 'portion', 'prep stock'] },
        { tool: 'check_distribution_status', keywords: ['distribution', 'dispatch', 'store transfer', 'transfer status', 'distribution van'] },
        { tool: 'check_warehouse_stock', keywords: ['warehouse stock', 'warehouse inventory', 'bulk stock', 'central stock'] },
        { tool: 'check_kitchen_stations', keywords: ['kitchen station', 'grill', 'fryer', 'expedit', 'line covered'] },
        { tool: 'check_rotas', keywords: ['rota', 'roster', 'shift coverage', 'coverage gap', 'staffing'] },
        { tool: 'check_payments', keywords: ['payment', 'transaction', 'settlement', 'card machine'] },
        { tool: 'check_accounts', keywords: ['accounts', 'vat', 'invoice', 'financial summary'] },
    ];

    const hintedTools = domainSignals
        .filter((signal) => includesAny(combined, signal.keywords))
        .map((signal) => signal.tool);

    // General fan-out rule:
    // - explicit full-overview intents get the full cross-domain bundle
    // - otherwise, if multiple domains are hinted, add those domain checks
    if (isOverviewIntent(inp)) {
        for (const tool of overviewTools) {
            if (!actions.some(a => a.tool === tool)) actions.push({ tool });
        }
    } else if (hintedTools.length >= 2) {
        for (const tool of hintedTools) {
            if (!actions.some(a => a.tool === tool)) actions.push({ tool });
        }
    }

    const priorContext = current.meta.lastPrompt ? 'Context from the previous operator turn has been preserved.' : 'This is the opening turn of the session.';

    // Adaptive cap:
    // - full overview: broad fan-out
    // - multi-domain hints: medium fan-out
    // - normal turn: tight cap
    const isOverview = isOverviewIntent(inp);
    const cappedActions = actions.slice(0, isOverview ? 8 : hintedTools.length >= 3 ? 6 : 4);

    return {
        summary: cappedActions.length > 0
            ? 'Tilly reviewed the operation and translated findings into visible actions.'
            : 'Tilly is conversing with the operator.',
        spoken: outputText || `${priorContext} Awaiting next instruction.`,
        nextSuggestion: 'Continue the conversation or ask Tilly to act on something specific.',
        actions: cappedActions
    };
}

// INPUT keyword-based fallback — matches the user's words directly
// This is the safety net when the audio model doesn't call tools
export function createMockPlan(prompt: string, current: Snapshot): AgentPlan {
    const text = prompt.toLowerCase();
    const data = extractData(prompt);
    const actions: PlannedAction[] = [];

    if (includesAny(text, ['clear ui', 'clear the ui', 'clear widgets', 'clear the widgets', 'clear screen', 'reset stage', 'clean slate', 'remove widgets'])) {
        actions.push({ tool: 'clear_ui_widgets' });
    }

    if (isOverviewIntent(text) || includesAny(text, ['rundown', 'overview', 'status update', 'brief', 'everything going'])) {
        actions.push({ tool: 'check_driver_status' }, { tool: 'check_inventory_status' }, { tool: 'check_distribution_status' }, { tool: 'check_rotas' }, { tool: 'check_payments' });
    }
    if (includesAny(text, ['driver', 'clocked', 'delivery']) && !actions.some(a => a.tool === 'check_driver_status')) {
        actions.push({ tool: 'check_driver_status' });
    }
    if (includesAny(text, ['distribution', 'warehouse driver', 'central kitchen dispatch', 'van', 'store transfer'])) {
        actions.push({ tool: 'check_distribution_status' });
    }
    if (includesAny(text, ['apolog', 'sms', 'sorry to the customer'])) {
        actions.push({ tool: 'send_customer_apology' });
    }
    if (includesAny(text, ['loyalty', 'wallet', 'points'])) {
        actions.push({ tool: 'add_loyalty_points', args: { points: data.points || '250' } });
    }
    if (includesAny(text, ['inventory', 'stock', 'dough', 'beans', 'receipt paper', 'kiosk', 'store stock', 'how much do we have'])) {
        actions.push({ tool: 'check_inventory_status', args: { item: data.item || 'Fresh dough' } });
    }
    if (includesAny(text, ['warehouse stock', 'warehouse inventory', 'central stock', 'bulk supply', 'warehouse level'])) {
        actions.push({ tool: 'check_warehouse_stock' });
    }
    if (includesAny(text, ['cost', 'margin', 'price per dish', 'food cost', 'how much does it cost', 'costing', 'unit cost', 'gp', 'gross profit'])) {
        actions.push({ tool: 'check_costings', args: { item: data.item } });
    }
    if (includesAny(text, ['waste', 'wastage', 'thrown away', 'binned', 'food waste', 'loss'])) {
        actions.push({ tool: 'check_wastage' });
    }
    if (includesAny(text, ['kitchen', 'prep', 'blocked', 'menu item', 'halt', 'garlic bread', 'save the dough', '86'])) {
        actions.push({ tool: 'halt_kitchen_item', args: { item: data.item || 'garlic bread' } });
    }
    if (includesAny(text, ['kitchen station', 'expedit', 'line position', 'who is on grill', 'who is on which station'])) {
        if (!actions.some(a => a.tool === 'check_kitchen_stations')) actions.push({ tool: 'check_kitchen_stations' });
    }
    if (includesAny(text, ['promo', 'promotion', 'campaign', 'loaded fries', 'iced latte', 'discount'])) {
        actions.push({ tool: 'draft_promo', args: { campaign: data.campaign || data.item || 'promotion', pct: data.pct } });
    }
    if (includesAny(text, ['push', 'notification', 'qr code', 'app users', 'send it'])) {
        actions.push({ tool: 'send_marketing_push', args: { campaign: data.campaign || data.item || 'promotion', pct: data.pct } });
    }
    if (includesAny(text, ['email campaign', 'email blast', 'newsletter', 'send an email', 'email promotion'])) {
        actions.push({ tool: 'send_email_campaign', args: { campaign: data.campaign || 'Weekly offers' } });
    }
    if (includesAny(text, ['sms campaign', 'sms blast', 'text all customers', 'text campaign', 'text message campaign'])) {
        actions.push({ tool: 'send_sms_campaign', args: { campaign: data.campaign || 'Weekend deals' } });
    }
    if (includesAny(text, ['game', 'scratch', 'incentive', 'engagement', 'prize', 'gamif'])) {
        actions.push({ tool: 'check_engagement' });
    }
    if (includesAny(text, ['staff', 'attendance', 'late', 'absent', 'who was late', 'show up on time', 'note that down', 'sarah'])) {
        actions.push({ tool: 'record_attendance_note', args: { name: data.name || 'Sarah', time: data.time || '15 minutes' } });
    }
    if (includesAny(text, ['rota', 'roster', 'schedule', 'shift cover', 'shift gap', 'coverage', 'next week', 'who is working'])) {
        if (!actions.some(a => a.tool === 'check_rotas')) actions.push({ tool: 'check_rotas' });
    }
    if (includesAny(text, ['staff station', 'who is where', 'station assignment'])) {
        if (!actions.some(a => a.tool === 'check_staff_stations')) actions.push({ tool: 'check_staff_stations' });
    }
    if (includesAny(text, ['performance', 'league table', 'kpi', 'staff performance', 'how are they doing', 'training record'])) {
        if (!actions.some(a => a.tool === 'check_performance')) actions.push({ tool: 'check_performance', args: { name: data.name } });
    }
    if (includesAny(text, ['reorder', 'supplier', 'beans ordered'])) {
        actions.push({ tool: 'reorder_supplier_item', args: { item: data.item || 'dark roast beans' } });
    }
    if (includesAny(text, ['route', 'reroute', 'optimize', 'optimise', 'traffic'])) {
        actions.push({ tool: 'optimise_driver_routes', args: { time: data.time || '45 minutes' } });
    }
    if (includesAny(text, ['payment', 'transaction', 'settlement', 'card machine', 'stripe', 'taking payment'])) {
        actions.push({ tool: 'check_payments' });
    }
    if (includesAny(text, ['report', 'sales report', 'run a report', 'generate report', 'analytics', 'figures', 'numbers'])) {
        actions.push({ tool: 'generate_report', args: { type: data.item || 'Sales summary' } });
    }
    if (includesAny(text, ['account', 'vat', 'invoice', 'tax', 'bill', 'financial'])) {
        actions.push({ tool: 'check_accounts' });
    }

    const priorContext = current.meta.lastPrompt ? 'Context preserved.' : 'Opening turn.';

    return {
        summary: 'Tilly reviewed the shift and identified operational pressure points.',
        spoken: `${priorContext} I checked the live operation and updated the relevant areas.`,
        nextSuggestion: 'Ask Tilly to turn one of the highlighted issues into a concrete recovery action.',
        actions
    };
}
