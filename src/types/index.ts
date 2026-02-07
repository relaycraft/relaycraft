export interface Timing {
    dns?: number;
    connect?: number;
    ssl?: number;
    ttfb?: number;
    total: number;
}

export interface ErrorDetail {
    message: string;
    errorType: string;
}

export interface Flow {
    id: string;
    order?: number; // Sequence number for UI display
    method: string;
    url: string;
    host: string;
    path: string;
    statusCode: number;
    timestamp: number;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    requestBody?: string;
    responseBody?: string;
    contentType?: string;
    size: number;
    duration?: number;
    requestBodyEncoding?: 'text' | 'base64';
    responseBodyEncoding?: 'text' | 'base64';
    matchedRules?: MatchedHit[];
    hits?: MatchedHit[];
    intercepted?: boolean;
    interceptPhase?: 'request' | 'response';

    // V2 Fields
    httpVersion?: string;
    clientIp?: string;
    serverIp?: string;
    error?: ErrorDetail;
    timing?: Timing;
    isWebsocket?: boolean;
    websocketFrames?: WebSocketFrame[];
    bodyTruncated?: boolean;
    matchedScripts?: MatchedHit[];
}

export interface WebSocketFrame {
    type: 'text' | 'binary' | 'ping' | 'pong' | 'close';
    fromClient: boolean;
    content: string;
    timestamp: number;
    length: number;
}

export interface MatchedHit {
    id: string;
    name: string;
    type: 'rule' | 'script' | 'breakpoint' | string;
    status?: 'success' | 'warning' | 'error' | string;
    message?: string;
    timestamp?: number;
}

export * from './rules';
