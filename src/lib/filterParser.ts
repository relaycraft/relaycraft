export interface FilterItem {
    key: string;
    value: string;
    operator?: '>' | '<' | '>=' | '<=';
    negative?: boolean;
}

export interface FilterCriteria {
    text: FilterItem[];
    method: FilterItem[];
    status: FilterItem[];
    domain: FilterItem[];
    type: FilterItem[];
    header: FilterItem[];
    body: FilterItem[];
    reqbody: FilterItem[];
    size: FilterItem[];
    duration: FilterItem[];
    ip: FilterItem[];
    source: FilterItem[];
}

export function parseFilter(input: string): FilterCriteria {
    const criteria: FilterCriteria = {
        text: [],
        method: [],
        status: [],
        domain: [],
        type: [],
        header: [],
        body: [],
        reqbody: [],
        size: [],
        duration: [],
        ip: [],
        source: []
    };

    const parts = input.split(' ').filter(p => p.trim() !== '');

    parts.forEach(part => {
        let isNegative = false;
        let cleanPart = part;

        if (part.startsWith('!') || part.startsWith('-')) {
            isNegative = true;
            cleanPart = part.substring(1);
        }

        if (cleanPart.includes(':')) {
            const firstColonIndex = cleanPart.indexOf(':');
            const key = cleanPart.substring(0, firstColonIndex).toLowerCase();
            let value = cleanPart.substring(firstColonIndex + 1);

            let operator: FilterItem['operator'];
            if (value.startsWith('>=') || value.startsWith('<=')) {
                operator = value.substring(0, 2) as any;
                value = value.substring(2);
            } else if (value.startsWith('>') || value.startsWith('<')) {
                operator = value.substring(0, 1) as any;
                value = value.substring(1);
            }

            const item: FilterItem = { key, value: value.toLowerCase(), negative: isNegative, operator };

            switch (key) {
                case 'method':
                case 'm':
                    criteria.method.push(item);
                    break;
                case 'status':
                case 's':
                    criteria.status.push(item);
                    break;
                case 'domain':
                case 'd':
                case 'host':
                    criteria.domain.push(item);
                    break;
                case 'type':
                case 't':
                    criteria.type.push(item);
                    break;
                case 'header':
                case 'h':
                    criteria.header.push(item);
                    break;
                case 'body':
                case 'resbody':
                    criteria.body.push(item);
                    break;
                case 'reqbody':
                case 'rb':
                    criteria.reqbody.push(item);
                    break;
                case 'size':
                case 'sz':
                    criteria.size.push(item);
                    break;
                case 'duration':
                case 'dur':
                    criteria.duration.push(item);
                    break;
                case 'ip':
                    criteria.ip.push(item);
                    break;
                case 'src':
                case 'source':
                    criteria.source.push(item);
                    break;
                default:
                    criteria.text.push({ key: '', value: part.toLowerCase(), negative: isNegative });
            }
        } else {
            criteria.text.push({ key: '', value: cleanPart.toLowerCase(), negative: isNegative });
        }
    });

    return criteria;
}

function parseSize(val: string): number {
    const num = parseFloat(val);
    if (isNaN(num)) return 0;
    const unit = val.toLowerCase().replace(/[0-9.]/g, '').trim();
    if (unit === 'kb' || unit === 'k') return num * 1024;
    if (unit === 'mb' || unit === 'm') return num * 1024 * 1024;
    if (unit === 'gb' || unit === 'g') return num * 1024 * 1024 * 1024;
    return num;
}

function parseDuration(val: string): number {
    const num = parseFloat(val);
    if (isNaN(num)) return 0;
    const unit = val.toLowerCase().replace(/[0-9.]/g, '').trim();
    if (unit === 's') return num * 1000;
    if (unit === 'm') return num * 60 * 1000;
    return num; // Default ms
}

function compare(actual: number, expected: number, operator: FilterItem['operator']): boolean {
    switch (operator) {
        case '>': return actual > expected;
        case '<': return actual < expected;
        case '>=': return actual >= expected;
        case '<=': return actual <= expected;
        default: return actual === expected;
    }
}

export function matchFlow(flow: any, criteria: FilterCriteria, isRegex: boolean, caseSensitive: boolean): boolean {
    const checkGroup = (items: FilterItem[], matchFn: (item: FilterItem) => boolean) => {
        if (items.length === 0) return true;
        // Logic: OR within same key group, BUT negative items act as exclusions (AND NOT)
        const positive = items.filter(i => !i.negative);
        const negative = items.filter(i => i.negative);

        const posMatch = positive.length === 0 || positive.some(matchFn);

        if (negative.length > 0) {
            // If any negative matches, exclude
            if (negative.some(i => matchFn({ ...i, negative: false }))) return false;
        }

        return posMatch;
    };

    // 1. Method
    if (!checkGroup(criteria.method, (item) => flow.method.toLowerCase() === item.value)) return false;

    // 2. Status
    if (!checkGroup(criteria.status, (item) => {
        const flowStatus = flow.statusCode?.toString() || '';
        if (item.value.endsWith('xx')) {
            return flowStatus.startsWith(item.value[0]);
        }
        return flowStatus === item.value;
    })) return false;

    // 3. Domain
    if (!checkGroup(criteria.domain, (item) => {
        return flow.host.toLowerCase().includes(item.value);
    })) return false;

    // 4. Type
    if (!checkGroup(criteria.type, (item) => {
        const contentType = (flow.responseHeaders?.['content-type'] || flow.contentType || '').toLowerCase();
        const url = flow.url.toLowerCase();
        const val = item.value;
        if (val === 'json') return contentType.includes('json');
        if (val === 'image' || val === 'img') return contentType.includes('image');
        if (val === 'js' || val === 'script') return contentType.includes('javascript') || url.endsWith('.js');
        if (val === 'css') return contentType.includes('css') || url.endsWith('.css');
        if (val === 'html') return contentType.includes('html');
        return contentType.includes(val);
    })) return false;

    // 5. IP (Any)
    if (!checkGroup(criteria.ip, (item) => {
        return (flow.clientIp || '').includes(item.value) || (flow.serverIp || '').includes(item.value);
    })) return false;

    // 6. Source IP (Strict)
    if (!checkGroup(criteria.source, (item) => {
        return (flow.clientIp || '').includes(item.value);
    })) return false;

    // 7. Sizing
    if (!checkGroup(criteria.size, (item) => {
        const actual = flow.size || 0;
        const expected = parseSize(item.value);
        return compare(actual, expected, item.operator);
    })) return false;

    // 8. Duration
    if (!checkGroup(criteria.duration, (item) => {
        const actual = flow.duration || 0;
        const expected = parseDuration(item.value);
        return compare(actual, expected, item.operator);
    })) return false;

    // 9. Headers
    if (!checkGroup(criteria.header, (item) => {
        const reqHeaders = flow.requestHeaders || {};
        const resHeaders = flow.responseHeaders || {};
        const combined = { ...reqHeaders, ...resHeaders };

        // item.value might be "key:val" or just "val" (search in all keys/values)
        if (item.value.includes(':')) {
            const [hKey, hVal] = item.value.split(':');
            const actualVal = Object.entries(combined).find(([k]) => k.toLowerCase() === hKey)?.[1] as string;
            return actualVal?.toLowerCase().includes(hVal);
        }

        // Search in all headers
        return Object.entries(combined).some(([k, v]) =>
            k.toLowerCase().includes(item.value) || String(v).toLowerCase().includes(item.value)
        );
    })) return false;

    // 10. Body
    const matchText = (actual: string | undefined, search: string) => {
        if (!actual) return false;
        if (isRegex) {
            try { return new RegExp(search, caseSensitive ? '' : 'i').test(actual); } catch (e) { return false; }
        }
        const a = caseSensitive ? actual : actual.toLowerCase();
        const s = caseSensitive ? search : search.toLowerCase();
        return a.includes(s);
    };

    if (!checkGroup(criteria.body, (item) => matchText(flow.responseBody, item.value))) return false;
    if (!checkGroup(criteria.reqbody, (item) => matchText(flow.requestBody, item.value))) return false;

    // 11. General Text (AND logic)
    if (criteria.text.length > 0) {
        // For general text, we use AND logic: ALL positive terms must match, ANY negative term should NOT match
        for (const item of criteria.text) {
            const isMatch = (flow.url.toLowerCase().includes(item.value) ||
                flow.method.toLowerCase().includes(item.value) ||
                (flow.statusCode?.toString() || '').includes(item.value) ||
                flow.host.toLowerCase().includes(item.value));

            if (item.negative) {
                if (isMatch) return false;
            } else {
                if (!isMatch) return false;
            }
        }
    }

    return true;
}
