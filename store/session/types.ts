export type SelectionMode = 'REPLACE' | 'ADD' | 'REMOVE' | 'TOGGLE';

export interface NodeWarningRecord {
	targetNodeId: number;
	targetNodeLabel: string;
	sourceNodeId: number;
	sourceNodeLabel: string;
	warningId: string;
	message: string;
	detail?: string;
	distance: number;
}
