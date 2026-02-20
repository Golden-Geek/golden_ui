import { createGraphStore, type GraphStore } from './graph.svelte';
import { createWebSocketUiClient } from '../transport/ws';
import type {
	NodeId,
	UiNodeDto,
	UiClient,
	UiEditIntent,
	UiEventBatch,
	UiHistoryState,
	UiSubscriptionScope
} from '../types';
import { wholeGraphScope } from '../types';

export type SelectionMode = 'REPLACE' | 'ADD' | 'REMOVE' | 'TOGGLE';

export interface WorkbenchSessionOptions {
	wsUrl?: string;
	httpBaseUrl?: string;
	pollIntervalMs?: number;
	scope?: UiSubscriptionScope;
	bootstrapRetryMs?: number;
}

export interface WorkbenchSession {
	readonly graph: GraphStore;
	readonly client: UiClient;
	readonly selectedNodesIds: NodeId[];
	readonly selectedNodeId: NodeId | null;
	readonly status: string;
	readonly historyBusy: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	getSelectedNodes(): UiNodeDto[];
	getFirstSelectedNode(): UiNodeDto | null;
	isNodeSelected(nodeId: NodeId): boolean;
	selectNode(nodeId: NodeId | null, selectionMode?: SelectionMode): void;
	selectNodes(nodeIds: NodeId[], selectionMode?: SelectionMode): void;
	clearSelection(): void;
	sendIntent(intent: UiEditIntent): Promise<void>;
	undo(): Promise<void>;
	redo(): Promise<void>;
	mount(): () => void;
}

const DEFAULT_RETRY_MS = 1000;

const formatEventTime = (value: { tick: number; micro: number; seq: number }): string =>
	`${value.tick}:${value.micro}:${value.seq}`;

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tagName = target.tagName;
	return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
};

export const appState = $state({
	session : null as WorkbenchSession | null
});


export const createWorkbenchSession = (options: WorkbenchSessionOptions = {}): WorkbenchSession => {
	const scope = options.scope ?? wholeGraphScope;
	const retryMs = Math.max(100, options.bootstrapRetryMs ?? DEFAULT_RETRY_MS);
	const graph = createGraphStore();

	let status = $state('Connecting to engine...');
	let selectedNodeIds = $state<NodeId[]>([]);
	let historyBusy = $state(false);
	let canUndo = $state(false);
	let canRedo = $state(false);

	let mountedCleanup: (() => void) | null = null;
	let resyncInFlight = false;
	let intentQueueTail: Promise<void> = Promise.resolve();

	const client = createWebSocketUiClient({
		wsUrl: options.wsUrl,
		httpBaseUrl: options.httpBaseUrl,
		pollIntervalMs: options.pollIntervalMs,
		onConnectionStateChange: (state) => {
			if (state === 'connecting') {
				status = 'Connecting to engine...';
				return;
			}
			if (state === 'connected') {
				status = 'Connected.';
				return;
			}
			if (state === 'disconnected') {
				status = 'Disconnected from engine.';
				return;
			}
			if (state === 'reconnecting') {
				status = 'Disconnected, reconnecting...';
				return;
			}
			status = 'WebSocket lost. Using HTTP fallback while reconnecting...';
		}
	});

	const reconcileSelection = (): void => {
		selectedNodeIds = selectedNodeIds.filter((nodeId) => graph.state.nodesById.has(nodeId));
	};

	const getSelectedNodes = (): UiNodeDto[] =>
		selectedNodeIds
			.map((nodeId) => graph.state.nodesById.get(nodeId))
			.filter((node): node is UiNodeDto => node !== undefined);

	const getFirstSelectedNode = (): UiNodeDto | null => {
		const firstId = selectedNodeIds[0];
		if (firstId === undefined) {
			return null;
		}
		return graph.state.nodesById.get(firstId) ?? null;
	};

	const isNodeSelected = (nodeId: NodeId): boolean => selectedNodeIds.includes(nodeId);

	const clearSelection = (): void => {
		selectedNodeIds = [];
	};

	const selectNodes = (nodeIds: NodeId[], selectionMode: SelectionMode = 'REPLACE'): void => {
		const validUniqueIds: NodeId[] = [];
		for (const nodeId of nodeIds) {
			if (!graph.state.nodesById.has(nodeId)) {
				continue;
			}
			if (validUniqueIds.includes(nodeId)) {
				continue;
			}
			validUniqueIds.push(nodeId);
		}

		if (selectionMode === 'REPLACE') {
			selectedNodeIds = validUniqueIds;
			return;
		}

		if(selectionMode === 'REMOVE') {
			selectedNodeIds = selectedNodeIds.filter((id) => !validUniqueIds.includes(id));
			return;
		}

		if(selectionMode === 'TOGGLE') {
			const toggled = new Set(selectedNodeIds);
			for(const nodeId of validUniqueIds) {
				if(toggled.has(nodeId)) {
					toggled.delete(nodeId);
				} else {
					toggled.add(nodeId);
				}
			}
			selectedNodeIds = Array.from(toggled);
			return;
		}

		const merged = [...selectedNodeIds];
		for (const nodeId of validUniqueIds) {
			if (!merged.includes(nodeId)) {
				merged.push(nodeId);
			}
		}
		selectedNodeIds = merged;
	};

	const selectNode = (nodeId: NodeId | null, selectionMode: SelectionMode = 'REPLACE'): void => {
		if (nodeId === null) {
			clearSelection();
			return;
		}
		selectNodes([nodeId], selectionMode);
	};

	const applyHistoryState = (history: UiHistoryState | undefined): void => {
		if (!history) {
			return;
		}
		canUndo = history.can_undo;
		canRedo = history.can_redo;
	};

	const resyncSnapshot = async (successStatus: string): Promise<void> => {
		if (resyncInFlight) {
			return;
		}
		resyncInFlight = true;
		try {
			const snapshot = await client.snapshot(scope);
			graph.loadSnapshot(snapshot);
			reconcileSelection();
			applyHistoryState(snapshot.history);
			status = successStatus;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown resync error';
			status = `Resync failed: ${message}`;
		} finally {
			resyncInFlight = false;
		}
	};

	const applyBatch = (batch: UiEventBatch): void => {
		graph.applyBatch(batch);
		reconcileSelection();
		if (graph.state.requiresResync) {
			void resyncSnapshot('Snapshot resynced.');
		}
	};

	const runIntent = async (intent: UiEditIntent): Promise<void> => {
		try {
			const ack = await client.sendIntent(intent);
			applyHistoryState(ack.history);
			if (!ack.success) {
				status = `Error: ${ack.error_message ?? ack.error_code ?? 'unknown error'}`;
				return;
			}

			if (ack.status === 'staged') {
				status = 'Intent accepted and staged.';
				return;
			}

			if (intent.kind !== 'setParam') {
				if (intent.kind === 'undo' || intent.kind === 'redo') {
					const label = intent.kind === 'undo' ? 'Undo' : 'Redo';
					status = ack.earliest_event_time
						? `${label} applied at ${formatEventTime(ack.earliest_event_time)}`
						: `Nothing to ${intent.kind}.`;
				} else {
					status = ack.earliest_event_time
						? `Applied at ${formatEventTime(ack.earliest_event_time)}`
						: 'Applied.';
				}
			}

			if (graph.state.requiresResync) {
				await resyncSnapshot('Snapshot resynced.');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown error';
			status = `Error: ${message}`;
		}
	};

	const sendIntent = (intent: UiEditIntent): Promise<void> => {
		const queued = intentQueueTail.then(() => runIntent(intent));
		intentQueueTail = queued.catch(() => {});
		return queued;
	};

	const undo = async (): Promise<void> => {
		if (historyBusy || !canUndo) {
			return;
		}
		historyBusy = true;
		try {
			await sendIntent({ kind: 'undo' });
		} finally {
			historyBusy = false;
		}
	};

	const redo = async (): Promise<void> => {
		if (historyBusy || !canRedo) {
			return;
		}
		historyBusy = true;
		try {
			await sendIntent({ kind: 'redo' });
		} finally {
			historyBusy = false;
		}
	};

	const mount = (): (() => void) => {
		if (mountedCleanup !== null) {
			return mountedCleanup;
		}

		let stopped = false;
		let subscribed = false;
		let unsubscribe = () => {};
		let bootstrapInFlight = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		const clearRetry = (): void => {
			if (retryTimer !== null) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
		};

		const scheduleRetry = (): void => {
			if (stopped || subscribed || retryTimer !== null) {
				return;
			}
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void bootstrap();
			}, retryMs);
		};

		const bootstrap = async (): Promise<void> => {
			if (stopped || subscribed || bootstrapInFlight) {
				return;
			}

			bootstrapInFlight = true;
			try {
				const snapshot = await client.snapshot(scope);
				if (stopped) {
					return;
				}
				graph.loadSnapshot(snapshot);
				reconcileSelection();
				applyHistoryState(snapshot.history);
				status = 'Connected.';
				unsubscribe = client.subscribe(scope, snapshot.at, applyBatch);
				subscribed = true;
				clearRetry();
			} catch (error) {
				if (stopped) {
					return;
				}
				const message = error instanceof Error ? error.message : 'unknown connection error';
				status = `Connection failed: ${message} (retrying...)`;
				scheduleRetry();
			} finally {
				bootstrapInFlight = false;
			}
		};

		const onWindowKeydown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) {
				return;
			}
			if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
				return;
			}

			const key = event.key.toLowerCase();
			if (key === 'z') {
				event.preventDefault();
				if (event.shiftKey) {
					void redo();
				} else {
					void undo();
				}
				return;
			}

			if (key === 'y' && !event.shiftKey) {
				event.preventDefault();
				void redo();
			}
		};

		if (typeof window !== 'undefined') {
			window.addEventListener('keydown', onWindowKeydown);
		}
		void bootstrap();

		mountedCleanup = (): void => {
			stopped = true;
			clearRetry();
			if (typeof window !== 'undefined') {
				window.removeEventListener('keydown', onWindowKeydown);
			}
			unsubscribe();
			graph.reset();
			clearSelection();
			mountedCleanup = null;
		};

		return mountedCleanup;
	};

	return {
		get graph(): GraphStore {
			return graph;
		},
		get client(): UiClient {
			return client;
		},
		get selectedNodesIds(): NodeId[] {
			return selectedNodeIds;
		},
		get selectedNodeId(): NodeId | null {
			return selectedNodeIds[0] ?? null;
		},
		get status(): string {
			return status;
		},
		get historyBusy(): boolean {
			return historyBusy;
		},
		get canUndo(): boolean {
			return canUndo;
		},
		get canRedo(): boolean {
			return canRedo;
		},
		getSelectedNodes,
		getFirstSelectedNode,
		isNodeSelected,
		selectNode,
		selectNodes,
		clearSelection,
		sendIntent,
		undo,
		redo,
		mount
	};
};
