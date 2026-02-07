import { create } from 'zustand';
import { Flow } from '../types';
import { version as APP_VERSION } from '../../package.json';
import { Logger } from '../lib/logger';

interface ComposerState {
    // ... same interface
    method: string;
    url: string;
    headers: Array<{ key: string; value: string; enabled: boolean }>;
    body: string;
    bodyType: 'none' | 'raw' | 'x-www-form-urlencoded';
    bodyFormData: Array<{ key: string; value: string; enabled: boolean }>;
    lastResponse: {
        status: number | null;
        headers: Record<string, string>;
        body: string;
    } | null;

    setMethod: (method: string) => void;
    setUrl: (url: string) => void;
    setHeaders: (headers: Array<{ key: string; value: string; enabled: boolean }>) => void;
    setBody: (body: string) => void;
    setLastResponse: (response: { status: number | null; headers: Record<string, string>; body: string } | null) => void;

    setBodyType: (type: 'none' | 'raw' | 'x-www-form-urlencoded') => void;
    setBodyFormData: (data: Array<{ key: string; value: string; enabled: boolean }>) => void;

    setComposerFromFlow: (flow: Flow) => void;
    reset: () => void;
}

const DEFAULT_HEADERS = [
    { key: 'User-Agent', value: `RelayCraft/${APP_VERSION}`, enabled: true },
    { key: 'Accept', value: '*/*', enabled: true },
];

export const useComposerStore = create<ComposerState>((set, get) => ({
    method: 'GET',
    url: '',
    headers: [...DEFAULT_HEADERS],
    body: '',
    bodyType: 'raw',
    bodyFormData: [],
    lastResponse: null,

    setMethod: (method) => set({ method }),
    setUrl: (url) => set({ url }),
    setHeaders: (headers) => set({ headers }),
    setBody: (body) => set({ body }),

    setBodyType: (bodyType) => {
        const currentHeaders = get().headers;
        let newHeaders = [...currentHeaders];

        if (bodyType === 'x-www-form-urlencoded') {
            const hasContentType = newHeaders.some(h => h.key.toLowerCase() === 'content-type');
            if (!hasContentType) {
                newHeaders.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true });
            }
        } else {
            // If switching away from form-data (to None or Raw), remove the specific header
            // This prevents stale headers (e.g. keeping form-urlencoded when sending JSON)
            newHeaders = newHeaders.filter(h =>
                !(h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().includes('x-www-form-urlencoded'))
            );
        }

        set({ bodyType, headers: newHeaders });
    },

    setBodyFormData: (bodyFormData) => {
        // Serialize form data to body string
        const params = new URLSearchParams();
        bodyFormData.forEach(item => {
            if (item.enabled && item.key) {
                params.append(item.key, item.value);
            }
        });
        set({ bodyFormData, body: params.toString() });
    },

    setLastResponse: (lastResponse) => set({ lastResponse }),

    setComposerFromFlow: (flow) => {
        const headerArray = Object.entries(flow.requestHeaders).map(([key, value]) => ({
            key,
            value,
            enabled: true,
        }));

        // Detect Body Type
        let bodyType: 'none' | 'raw' | 'x-www-form-urlencoded' = 'raw';
        let bodyFormData: Array<{ key: string; value: string; enabled: boolean }> = [];

        const contentType = flow.requestHeaders['content-type'] || flow.requestHeaders['Content-Type'] || '';
        if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
            bodyType = 'x-www-form-urlencoded';
            // Parse body
            try {
                const params = new URLSearchParams(flow.requestBody || '');
                params.forEach((value, key) => {
                    bodyFormData.push({ key, value, enabled: true });
                });
            } catch (e) {
                Logger.error('Failed to parse form body', e);
            }
        } else if (!flow.requestBody) {
            bodyType = 'none';
        }

        set({
            method: flow.method,
            url: flow.url,
            headers: headerArray.length > 0 ? headerArray : [...DEFAULT_HEADERS],
            body: flow.requestBody || '',
            bodyType,
            bodyFormData,
            lastResponse: null, // Clear old response when loading new flow
        });
    },

    reset: () => set({
        method: 'GET',
        url: '',
        headers: [...DEFAULT_HEADERS],
        body: '',
        bodyType: 'raw',
        bodyFormData: [],
        lastResponse: null,
    }),
}));
