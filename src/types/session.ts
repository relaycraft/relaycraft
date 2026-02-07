import { Flow } from './index';

export interface SessionMetadata {
    createdAt: number;
    duration: number;
    flowCount: number;
    sizeBytes: number;
    clientInfo?: string;
    networkCondition?: string;
    viewState?: string; // JSON string
}

export interface Session {
    id: string;
    name: string;
    description?: string;
    metadata: SessionMetadata;
    flows: Flow[];
}

export type ViewState = {
    filters: string;
    highlightedIds: string[];
    notes: Record<string, string>; // FlowID -> Note
};
