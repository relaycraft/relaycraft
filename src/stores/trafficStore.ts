import { create } from 'zustand';
import { Flow } from '../types';
import { useSettingsStore } from './settingsStore';

interface TrafficStore {
    flows: Flow[];
    selectedFlow: Flow | null;
    nextOrder: number;
    addFlow: (flow: Flow) => void;
    addFlows: (flows: Flow[]) => void;
    selectFlow: (flow: Flow | null) => void;
    clearFlows: () => void;
    setFlows: (flows: Flow[]) => void;
}



export const useTrafficStore = create<TrafficStore>((set) => ({
    flows: [],
    selectedFlow: null,
    nextOrder: 1,
    addFlow: (flow) => set((state) => {
        const existingIndex = state.flows.findIndex((f) => f.id === flow.id);
        if (existingIndex >= 0) {
            const newFlows = [...state.flows];
            // Preserve existing order
            const existingOrder = newFlows[existingIndex].order;
            newFlows[existingIndex] = { ...newFlows[existingIndex], ...flow, order: existingOrder };

            const newSelectedFlow = state.selectedFlow?.id === flow.id
                ? { ...state.selectedFlow, ...flow, order: existingOrder }
                : state.selectedFlow;
            return { flows: newFlows, selectedFlow: newSelectedFlow };
        }

        // New flow
        const newFlow = { ...flow, order: state.nextOrder };

        // Enforce max_traffic_entries limit
        const configLimit = useSettingsStore.getState().config.max_traffic_entries;
        // If 0, it means unlimited. If undefined, default to 10000.
        const limit = configLimit === undefined ? 10000 : configLimit;

        const currentFlows = [...state.flows, newFlow];
        // Optimization: Only cleanup when we exceed limit by a chunk (e.g. 100 items)
        // This prevents array slicing on every single request when full
        if (limit > 0 && currentFlows.length > limit + 100) {
            return {
                flows: currentFlows.slice(-limit),
                nextOrder: state.nextOrder + 1
            };
        }

        return {
            flows: currentFlows,
            nextOrder: state.nextOrder + 1
        };
    }),
    addFlows: (newFlowsList) => set((state) => {
        const flowsMap = new Map(state.flows.map(f => [f.id, f]));
        let updatedSelectedFlow = state.selectedFlow;
        let currentOrder = state.nextOrder;

        newFlowsList.forEach(flow => {
            const existing = flowsMap.get(flow.id);
            if (existing) {
                const updated = { ...existing, ...flow, order: existing.order }; // Keep existing order
                flowsMap.set(flow.id, updated);
                if (updatedSelectedFlow?.id === flow.id) {
                    updatedSelectedFlow = { ...updatedSelectedFlow, ...flow, order: existing.order };
                }
            } else {
                flowsMap.set(flow.id, { ...flow, order: currentOrder });
                currentOrder++;
            }
        });

        // Convert back to array and sort by order
        let updatedFlows = Array.from(flowsMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));

        // Enforce max_traffic_entries limit
        const configLimit = useSettingsStore.getState().config.max_traffic_entries;
        const limit = configLimit === undefined ? 10000 : configLimit;

        // For bulk add, we might want to strict enforce, or just loose enforce
        if (limit > 0 && updatedFlows.length > limit) {
            updatedFlows = updatedFlows.slice(-limit);
        }

        return {
            flows: updatedFlows,
            selectedFlow: updatedSelectedFlow,
            nextOrder: currentOrder
        };
    }),
    selectFlow: (flow) => set({ selectedFlow: flow }),
    clearFlows: () => set({ flows: [], selectedFlow: null, nextOrder: 1 }),
    setFlows: (newFlows: Flow[]) => set(() => {
        let maxOrder = 0;
        // Limit initial set
        const configLimit = useSettingsStore.getState().config.max_traffic_entries;
        const limit = configLimit === undefined ? 10000 : configLimit;

        let limitedFlows = newFlows;
        if (limit > 0) {
            limitedFlows = newFlows.slice(-limit);
        }

        const processedFlows = limitedFlows.map((f, i) => {
            const order = f.order || (i + 1);
            if (order > maxOrder) maxOrder = order;
            return { ...f, order };
        });
        return {
            flows: processedFlows,
            selectedFlow: null,
            nextOrder: maxOrder + 1
        };
    }),
}));
