import { useTrafficStore } from '../stores/trafficStore';
import { useRuleStore } from '../stores/ruleStore';
import { MatchedHit } from '../types';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Logger } from './logger';

let pollInterval: number | null = null;
let lastTimestamp = 0;
let isPolling = false;
let currentPort = 9090; // Default port

export function startTrafficMonitor(port: number = 9090) {
    if (pollInterval) {
        Logger.debug('Traffic monitor already running, stopping existing one...');
        clearInterval(pollInterval);
        pollInterval = null;
    }

    currentPort = port;
    Logger.debug(`Starting traffic monitor (polling on port ${port})...`);

    // Initial poll
    pollTraffic();

    // Poll every 500ms
    pollInterval = window.setInterval(pollTraffic, 500);
}

export function stopTrafficMonitor() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        Logger.debug('Traffic monitor stopped');
    }
}

// Add error logging
async function logErrorResponse(response: Response) {
    try {
        const text = await response.text();
        Logger.error('Polling 500 Error Body:', { text });
    } catch (e) {
        Logger.error('Could not read error body', e);
    }
}

async function pollTraffic() {
    if (isPolling) return;
    isPolling = true;

    try {
        const pollUrl = `http://127.0.0.1:${currentPort}/_relay/poll`;

        // Use Tauri's fetch for cross-platform compatibility (dev + production)
        const response = await tauriFetch(`${pollUrl}?since=${lastTimestamp}`, {
            method: 'GET',
            headers: {
                // Ensure we don't look like a proxied request if we hit direct
            }
        });

        if (response.ok) {
            const data = await response.json();

            if (data.server_ts) {
                if (data.flows && Array.isArray(data.flows)) {
                    if (data.flows.length > 0) {
                        const rules = useRuleStore.getState().rules;
                        const processedFlows = data.flows.map((flow: any) => {
                            // Process Hits
                            let processedHits: MatchedHit[] = [];
                            if (flow.hits && Array.isArray(flow.hits)) {
                                processedHits = flow.hits.map((hit: string | any) => {
                                    // Handle String Hits (Scripts or Legacy IDs)
                                    if (typeof hit === 'string') {
                                        if (hit.startsWith('script:')) {
                                            const name = hit.substring(7);
                                            return {
                                                id: name,
                                                name: name,
                                                type: 'script'
                                            };
                                        }
                                        
                                        // Legacy UUID string
                                        const rule = rules.find(r => r.id === hit);
                                        if (rule) {
                                            let type = 'rule';
                                            if (rule.actions && rule.actions.length > 0) {
                                                type = rule.actions[0].type;
                                            }
                                            return {
                                                id: rule.id,
                                                name: rule.name,
                                                type: type
                                            };
                                        }
                                        
                                        return {
                                            id: hit,
                                            name: 'Unknown Rule',
                                            type: 'unknown'
                                        };
                                    } 
                                    
                                    // Handle Object Hits (RuleEngine V2)
                                    if (typeof hit === 'object' && hit !== null) {
                                        // Enrich with latest rule data if available
                                        const rule = rules.find(r => r.id === hit.id);
                                        if (rule) {
                                             let type = 'rule';
                                             if (rule.actions && rule.actions.length > 0) {
                                                 type = rule.actions[0].type;
                                             }
                                             return {
                                                 ...hit,
                                                 name: rule.name,
                                                 type: type
                                             };
                                        }
                                        return hit;
                                    }

                                    return { id: 'unknown', name: 'Unknown', type: 'unknown' };
                                });
                            }
                            return { ...flow, hits: processedHits };
                        });
                        
                        useTrafficStore.getState().addFlows(processedFlows);
                    }
                }
                // Use backend's authoritative seconds timestamp (synced with msg_ts)
                lastTimestamp = data.server_ts;
            }
        } else {
            if (response.status === 500) {
                logErrorResponse(response);
            }
        }
    } catch (error) {
        // Log detailed error for corporate proxy diagnostics
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Only log serious failures, ignore simple connection resets during startup/shutdown
        if (!errorMsg.includes('Load Failed') && !errorMsg.includes('Connection refused')) {
            Logger.error('Traffic Poll Failed:', {
                error: errorMsg,
                port: currentPort,
                url: `http://127.0.0.1:${currentPort}/_relay/poll`,
                hint: 'Check if corporate proxy is intercepting local loopback.'
            });
        }
    } finally {
        isPolling = false;
    }
}
