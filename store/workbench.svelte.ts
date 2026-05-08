import { tick } from 'svelte';
import { createGraphStore, type GraphStore } from './graph.svelte';
import {
	createDefaultUiClient,
	type UiTransportConnectionState,
	type UiTransportFactory,
	type UiTransportOptions
} from '../transport';
import type {
	EventTime,
	NodeId,
	UiNodeDto,
	UiClient,
	UiEditIntent,
	UiEventBatch,
	UiLogRecord,
	UiAck,
	UiSnapshot,
	UiSubscriptionScope,
	UiParameterControlState
} from '../types';
import { wholeGraphScope } from '../types';
import { handleCommandShortcut } from './commands.svelte';
import { resetProjectFileFormat, setProjectFileFormat } from './project-file-format.svelte';
import { createWorkbenchDescriptionStore } from './session/descriptions.svelte';
import { createWorkbenchCustomEventStore } from './session/custom-events.svelte';
import { createWorkbenchFooterHoverStore } from './session/footer-hover.svelte';
import { createWorkbenchHistoryStore } from './session/history.svelte';
import { createWorkbenchLoggerStore } from './session/logger.svelte';
import { createWorkbenchSelectionStore } from './session/selection.svelte';
import { createWorkbenchWarningStore } from './session/warnings.svelte';
import { createWorkbenchCommandSuite } from './session/commands.svelte';
import type {
	FooterHoverInfo,
	NodeWarningRecord,
	SelectionMode,
	WorkbenchToast,
	WorkbenchToastLevel
} from './session/types';
export type {
	FooterHoverInfo,
	NodeWarningRecord,
	SelectionMode,
	WorkbenchToast,
	WorkbenchToastLevel
} from './session/types';

export { appState } from './app-state.svelte';

export interface WorkbenchSessionOptions {
	wsUrl?: string;
	httpBaseUrl?: string;
	pollIntervalMs?: number;
	scope?: UiSubscriptionScope;
	bootstrapRetryMs?: number;
	transportFactory?: UiTransportFactory;
	enableGlobalShortcuts?: boolean;
}

export type WorkbenchConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface WorkbenchSession {
	readonly graph: GraphStore;
	readonly client: UiClient;
	readonly logRecords: UiLogRecord[];
	readonly logMaxEntries: number;
	readonly logUiUpdateHz: number;
	readonly selectedNodesIds: NodeId[];
	readonly selectedNodeId: NodeId | null;
	readonly status: WorkbenchConnectionStatus;
	readonly toasts: WorkbenchToast[];
	readonly historyBusy: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly currentHistoryStateId: number;
	readonly hasActiveEditSession: boolean;
	readonly editSessionEpoch: number;
	getNodeData(nodeId: NodeId): UiNodeDto | null;
	getSelectedNodes(): UiNodeDto[];
	getFirstSelectedNode(): UiNodeDto | null;
	getNodeDescription(node: UiNodeDto | null | undefined): string | null;
	getCustomEventSequence(topic: string, origin?: NodeId | null): number;
	getFooterHoverInfo(): FooterHoverInfo | null;
	getNodeVisibleWarnings(nodeId: NodeId): NodeWarningRecord[];
	getActiveWarnings(): NodeWarningRecord[];
	hasNodeWarnings(nodeId: NodeId): boolean;
	isNodeEnabledInHierarchy(nodeId: NodeId): boolean;
	isNodeSelected(nodeId: NodeId): boolean;
	setFooterHover(token: symbol, nodeId: NodeId): void;
	clearFooterHover(token: symbol): void;
	selectNode(nodeId: NodeId | null, selectionMode?: SelectionMode): void;
	selectNodes(nodeIds: NodeId[], selectionMode?: SelectionMode): void;
	clearSelection(): void;
	appendUiLogRecord(
		level: WorkbenchToastLevel,
		tag: string,
		message: string,
		origin?: NodeId
	): void;
	sendIntent(intent: UiEditIntent): Promise<void>;
	setLogUiUpdateHz(hz: number): void;
	dismissToast(toastId: number): void;
	undo(): Promise<void>;
	redo(): Promise<void>;
	refreshSnapshot(): Promise<boolean>;
	mount(): () => void;
}

interface IntentWaiter {
	resolve: () => void;
	reject: (reason?: unknown) => void;
}

interface QueuedIntent {
	intent: UiEditIntent;
	waiters: IntentWaiter[];
}

const DEFAULT_RETRY_MS = 1000;
const UI_LOG_TAG_INTENT = 'intent';
const UI_LOG_TAG_TRANSPORT = 'transport';

const defaultEventTime: EventTime = { tick: 0, micro: 0, seq: 0 };

const toConnectionStatus = (
	transportState: UiTransportConnectionState,
	hasLoadedSnapshot: boolean
): WorkbenchConnectionStatus => {
	if (transportState === 'connected') {
		return hasLoadedSnapshot ? 'connected' : 'connecting';
	}
	if (
		transportState === 'connecting' ||
		transportState === 'reconnecting' ||
		transportState === 'fallbackPolling'
	) {
		return 'connecting';
	}
	return 'disconnected';
};

const controlStateEquals = (
	left: UiParameterControlState,
	right: UiParameterControlState
): boolean => {
	if (left.mode !== right.mode) {
		return false;
	}
	return JSON.stringify(left.spec) === JSON.stringify(right.spec);
};

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

export const createWorkbenchSession = (options: WorkbenchSessionOptions = {}): WorkbenchSession => {
	const scope = options.scope ?? wholeGraphScope;
	const retryMs = Math.max(100, options.bootstrapRetryMs ?? DEFAULT_RETRY_MS);
	const enableGlobalShortcuts = options.enableGlobalShortcuts ?? true;
	const graph = createGraphStore();
	const shouldLogUiPerf = (() => {
		if (typeof window === 'undefined') {
			return false;
		}
		try {
			return window.localStorage.getItem('gc_ui_perf') === '1';
		} catch {
			return false;
		}
	})();
	const logUiPerf = (message: string): void => {
		if (!shouldLogUiPerf) {
			return;
		}
		console.info(`[ui-perf] ${message}`);
	};
	const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

	let status = $state<WorkbenchConnectionStatus>('connecting');
	const selection = createWorkbenchSelectionStore(graph);
	const warnings = createWorkbenchWarningStore(graph);
	const descriptions = createWorkbenchDescriptionStore();
	const customEvents = createWorkbenchCustomEventStore();
	const footerHover = createWorkbenchFooterHoverStore(graph, {
		getNodeDescription: (node) => descriptions.getNodeDescription(node)
	});
	const history = createWorkbenchHistoryStore();
	const logger = createWorkbenchLoggerStore();

	let mountedCleanup: (() => void) | null = null;
	let resyncInFlight = false;
	let resyncQueued = false;
	let snapshotRequestInFlight: Promise<UiSnapshot> | null = null;
	let hasLoadedSnapshot = false;
	let connectionState: UiTransportConnectionState = 'connecting';
	const pendingIntentQueue: QueuedIntent[] = [];
	let intentQueueProcessing = false;
	// Keep batch payloads bounded while still reducing setParam fan-out.
	const MAX_SET_PARAM_BATCH_SIZE = 512;

	const getNodeDescription = (node: UiNodeDto | null | undefined): string | null =>
		descriptions.getNodeDescription(node);

	const getCustomEventSequence = (topic: string, origin?: NodeId | null): number =>
		customEvents.getCustomEventSequence(topic, origin);

	const clearFooterHover = (token: symbol): void => {
		footerHover.clearFooterHover(token);
	};

	const setFooterHover = (token: symbol, nodeId: NodeId): void => {
		footerHover.setFooterHover(token, nodeId);
	};

	const getFooterHoverInfo = (): FooterHoverInfo | null => {
		return footerHover.getFooterHoverInfo();
	};

	const dismissToast = (toastId: number): void => {
		logger.dismissToast(toastId);
	};

	const setLogUiUpdateHz = (hz: number): void => {
		logger.setLogUiUpdateHz(hz);
	};

	const appendUiLogRecord = (
		level: WorkbenchToastLevel,
		tag: string,
		message: string,
		origin?: NodeId
	): void => {
		logger.appendUiLogRecord(level, tag, message, origin);
	};

	const applyHistoryState = (nextHistory: UiSnapshot['history'] | undefined): void => {
		history.applyHistoryState(nextHistory);
	};

	const syncConnectionStatus = (): void => {
		status = toConnectionStatus(connectionState, hasLoadedSnapshot);
	};

	const transportOptions: UiTransportOptions = {
		wsUrl: options.wsUrl,
		httpBaseUrl: options.httpBaseUrl,
		pollIntervalMs: options.pollIntervalMs,
		onConnectionStateChange: (state) => {
			connectionState = state;
			syncConnectionStatus();
			if (state === 'fallbackPolling') {
				appendUiLogRecord(
					'warning',
					UI_LOG_TAG_TRANSPORT,
					'WebSocket lost. Using HTTP fallback while reconnecting...'
				);
			}
		}
	};
	const client = (options.transportFactory ?? createDefaultUiClient)(transportOptions);

	const getNodeData = (nodeId: NodeId): UiNodeDto | null => {
		return graph.state.nodesById.get(nodeId) ?? null;
	};

	const isNodeEnabledInHierarchy = (nodeId: NodeId): boolean => {
		let current: NodeId | undefined = nodeId;
		while (current !== undefined) {
			const node = graph.state.nodesById.get(current);
			if (!node) {
				return false;
			}
			if (!node.meta.enabled) {
				return false;
			}
			current = graph.state.parentById.get(current);
		}
		return true;
	};

	const applySnapshotToState = (snapshot: UiSnapshot): void => {
		graph.loadSnapshot(snapshot);
		setProjectFileFormat(snapshot.project_file);
		descriptions.applySnapshotSchema(snapshot.schema);
		footerHover.prune();
		hasLoadedSnapshot = true;
		warnings.invalidate();
		selection.restorePersistedSelection();
		selection.reconcileSelection();
		applyHistoryState(snapshot.history);
		logger.applySnapshotLogger(snapshot.logger);
		syncConnectionStatus();
	};

	const logSnapshotTiming = (context: string, snapshot: UiSnapshot, applyStartedAt: number) => {
		const applyElapsedMs =
			(typeof performance !== 'undefined' ? performance.now() : Date.now()) - applyStartedAt;
		const flushStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		tick().then(() => {
			const flushElapsedMs =
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) - flushStartedAt;
			const t = (snapshot as any).__timings || {};
			const totalMs = (t.totalMs || 0) + applyElapsedMs + flushElapsedMs;
			logUiPerf(
				`[ui] snapshot ${context} nodes=${snapshot.nodes.length} bytes=${t.bytes || 0} fetch_ms=${(t.fetchMs || 0).toFixed(0)} read_ms=${(t.readMs || 0).toFixed(0)} parse_ms=${(t.parseMs || 0).toFixed(0)} apply_graph_ms=${applyElapsedMs.toFixed(0)} flush_ms=${flushElapsedMs.toFixed(0)} total_ms=${totalMs.toFixed(0)}`
			);
		});
	};

	const requestSnapshot = (): Promise<UiSnapshot> => {
		if (snapshotRequestInFlight) {
			return snapshotRequestInFlight;
		}
		const inFlight = client.snapshot(scope);
		snapshotRequestInFlight = inFlight.finally(() => {
			snapshotRequestInFlight = null;
		});
		return snapshotRequestInFlight;
	};

	const refreshSnapshot = async (): Promise<boolean> => {
		try {
			const snapshot = await requestSnapshot();
			const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			applySnapshotToState(snapshot);
			logSnapshotTiming('refresh', snapshot, applyStartedAt);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown refresh error';
			appendUiLogRecord('error', UI_LOG_TAG_TRANSPORT, `Snapshot refresh failed: ${message}`);
			return false;
		}
	};

	const resyncSnapshot = async (successMessage?: string): Promise<void> => {
		if (resyncInFlight) {
			resyncQueued = true;
			return;
		}
		resyncInFlight = true;
		resyncQueued = false;
		try {
			const snapshot = await requestSnapshot();
			const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			applySnapshotToState(snapshot);
			if (successMessage) {
				appendUiLogRecord('info', UI_LOG_TAG_TRANSPORT, successMessage);
			}
			logSnapshotTiming('resync', snapshot, applyStartedAt);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown resync error';
			appendUiLogRecord('error', UI_LOG_TAG_TRANSPORT, `Resync failed: ${message}`);
		} finally {
			resyncInFlight = false;
			if (resyncQueued) {
				resyncQueued = false;
				void resyncSnapshot(successMessage);
			}
		}
	};

	const applyBatch = (batch: UiEventBatch): void => {
		const applyStartedAt = nowMs();
		const graphEvents = logger.partitionBatchEvents(batch.events);
		customEvents.applyBatchEvents(graphEvents);
		let graphPatchMs = 0;

		if (graphEvents.length > 0) {
			const warningDataChanged = warnings.batchAffectsWarnings({
				from: batch.from,
				to: batch.to,
				events: graphEvents
			});
			const graphPatchStartedAt = nowMs();
			graph.applyBatch({
				from: batch.from,
				to: graphEvents[graphEvents.length - 1]?.time ?? batch.to,
				events: graphEvents
			});
			graphPatchMs = nowMs() - graphPatchStartedAt;
			footerHover.prune();
			if (warningDataChanged) {
				warnings.invalidate();
			}
			selection.reconcileSelection();
			if (graph.state.requiresResync) {
				void resyncSnapshot();
			}
		}
		const totalMs = nowMs() - applyStartedAt;
		if (batch.events.length > 0 || totalMs >= 4) {
			logUiPerf(
				`[ui] batch events=${batch.events.length} graph_events=${graphEvents.length} graph_patch_ms=${graphPatchMs.toFixed(
					1
				)} ws_batch_apply_ms=${totalMs.toFixed(1)}`
			);
		}
	};

	const runIntent = async (intent: UiEditIntent): Promise<void> => {
		let error_logged = false;
		try {
			const ack = await client.sendIntent(intent);
			applyHistoryState(ack.history);
			if (!ack.success) {
				const message = ack.error_message ?? ack.error_code ?? 'unknown error';
				appendUiLogRecord('error', UI_LOG_TAG_INTENT, `Error: ${message}`);
				error_logged = true;
				throw new Error(message);
			}

			if (ack.status === 'staged') {
				appendUiLogRecord('info', UI_LOG_TAG_INTENT, 'Intent accepted and staged.');
				return;
			}

			if (intent.kind === 'setParamControlState') {
				const paramNode = graph.state.nodesById.get(intent.node);
				if (paramNode && paramNode.data.kind === 'parameter') {
					const currentState = paramNode.data.param.control;
					if (!controlStateEquals(currentState, intent.state)) {
						graph.applyEvent({
							time: ack.earliest_event_time ?? graph.state.lastEventTime ?? defaultEventTime,
							kind: {
								kind: 'paramControlChanged',
								param: intent.node,
								old_state: currentState,
								new_state: intent.state
							}
						});
					}
				}
			}

			if (graph.state.requiresResync) {
				await resyncSnapshot('Snapshot resynced.');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown error';
			if (!error_logged) {
				appendUiLogRecord('error', UI_LOG_TAG_INTENT, `Error: ${message}`);
			}
			throw error;
		}
	};

	const runIntentBatch = async (intents: UiEditIntent[]): Promise<void> => {
		if (intents.length === 0) {
			return;
		}
		if (intents.length === 1) {
			await runIntent(intents[0]);
			return;
		}
		let error_logged = false;
		try {
			const acks = await client.sendIntents(intents);
			if (acks.length !== intents.length) {
				throw new Error(
					`intent batch acknowledgement count mismatch (${acks.length}/${intents.length})`
				);
			}
			let firstFailure: UiAck | null = null;
			for (const ack of acks) {
				applyHistoryState(ack.history);
				if (!ack.success && firstFailure === null) {
					firstFailure = ack;
				}
			}
			if (firstFailure) {
				const message = firstFailure.error_message ?? firstFailure.error_code ?? 'unknown error';
				appendUiLogRecord('error', UI_LOG_TAG_INTENT, `Error: ${message}`);
				error_logged = true;
				throw new Error(message);
			}
			if (graph.state.requiresResync) {
				await resyncSnapshot('Snapshot resynced.');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown error';
			if (!error_logged) {
				appendUiLogRecord('error', UI_LOG_TAG_INTENT, `Error: ${message}`);
			}
			throw error;
		}
	};

	const findQueuedSetParamIndex = (node: NodeId): number => {
		for (let index = pendingIntentQueue.length - 1; index >= 0; index -= 1) {
			const queued = pendingIntentQueue[index];
			if (queued?.intent.kind === 'setParam' && queued.intent.node === node) {
				return index;
			}
		}
		return -1;
	};

	const drainLeadingSetParamIntents = (): QueuedIntent[] => {
		const drained: QueuedIntent[] = [];
		while (drained.length < MAX_SET_PARAM_BATCH_SIZE && pendingIntentQueue.length > 0) {
			const next = pendingIntentQueue[0];
			if (!next || next.intent.kind !== 'setParam') {
				break;
			}
			const queued = pendingIntentQueue.shift();
			if (queued) {
				drained.push(queued);
			}
		}
		return drained;
	};

	const resolveQueuedIntents = (queuedIntents: QueuedIntent[]): void => {
		for (const queued of queuedIntents) {
			for (const waiter of queued.waiters) {
				waiter.resolve();
			}
		}
	};

	const rejectQueuedIntentsBatch = (queuedIntents: QueuedIntent[], error: unknown): void => {
		for (const queued of queuedIntents) {
			for (const waiter of queued.waiters) {
				waiter.reject(error);
			}
		}
	};

	const processIntentQueue = async (): Promise<void> => {
		if (intentQueueProcessing) {
			return;
		}
		intentQueueProcessing = true;
		try {
			while (pendingIntentQueue.length > 0) {
				const next = pendingIntentQueue[0];
				if (next?.intent.kind === 'setParam') {
					const queued_batch = drainLeadingSetParamIntents();
					if (queued_batch.length === 0) {
						continue;
					}
					try {
						await runIntentBatch(queued_batch.map((entry) => entry.intent));
						resolveQueuedIntents(queued_batch);
					} catch (error) {
						rejectQueuedIntentsBatch(queued_batch, error);
					}
					continue;
				}

				const queued = pendingIntentQueue.shift();
				if (!queued) {
					continue;
				}
				try {
					await runIntent(queued.intent);
					resolveQueuedIntents([queued]);
				} catch (error) {
					rejectQueuedIntentsBatch([queued], error);
				}
			}
		} finally {
			intentQueueProcessing = false;
			if (pendingIntentQueue.length > 0) {
				void processIntentQueue();
			}
		}
	};

	const rejectQueuedIntents = (reason: Error): void => {
		while (pendingIntentQueue.length > 0) {
			const queued = pendingIntentQueue.shift();
			if (!queued) {
				continue;
			}
			for (const waiter of queued.waiters) {
				waiter.reject(reason);
			}
		}
	};

	const sendIntent = (intent: UiEditIntent): Promise<void> => {
		return new Promise<void>((resolve, reject) => {
			if (intent.kind === 'setParam') {
				const queuedSetParamIndex = findQueuedSetParamIndex(intent.node);
				if (queuedSetParamIndex >= 0) {
					const queued = pendingIntentQueue[queuedSetParamIndex];
					if (queued) {
						queued.intent = intent;
						queued.waiters.push({ resolve, reject });
						void processIntentQueue();
						return;
					}
				}
			}
			pendingIntentQueue.push({
				intent,
				waiters: [{ resolve, reject }]
			});
			void processIntentQueue();
		});
	};

	const undo = (): Promise<void> => {
		return history.undo(() => sendIntent({ kind: 'undo' }));
	};

	const redo = (): Promise<void> => {
		return history.redo(() => sendIntent({ kind: 'redo' }));
	};

	const commandSuite = createWorkbenchCommandSuite({
		graph,
		sendIntent,
		getSelectedNodes: () => selection.getSelectedNodes(),
		getFirstSelectedNode: () => selection.getFirstSelectedNode(),
		getSelectedNodeIds: () => selection.selectedNodeIds,
		selectNodes: (nodeIds, selectionMode) => selection.selectNodes(nodeIds, selectionMode),
		undo,
		redo
	});

	const mount = (): (() => void) => {
		if (mountedCleanup !== null) {
			return mountedCleanup;
		}

		let stopped = false;
		let subscribed = false;
		let unsubscribe = () => {};
		let unregisterCommands = () => {};
		let bootstrapInFlight = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let retryDelayMs = retryMs;

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
			const delay = retryDelayMs;
			retryDelayMs = Math.min(10000, Math.max(retryMs, retryDelayMs * 2));
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void bootstrap();
			}, delay);
		};

		const bootstrap = async (): Promise<void> => {
			if (stopped || subscribed || bootstrapInFlight) {
				return;
			}

			bootstrapInFlight = true;
			try {
				const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
				const snapshot = await requestSnapshot();
				const fetchElapsedMs =
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) - fetchStartedAt;
				if (stopped) {
					return;
				}
				const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
				applySnapshotToState(snapshot);
				const applyElapsedMs =
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) - applyStartedAt;
				logUiPerf(
					`bootstrap snapshot fetch_ms=${fetchElapsedMs.toFixed(1)} apply_ms=${applyElapsedMs.toFixed(
						1
					)} nodes=${snapshot.nodes.length}`
				);
				unsubscribe = client.subscribe(scope, snapshot.at, applyBatch);
				subscribed = true;
				clearRetry();
				retryDelayMs = retryMs;
			} catch (error) {
				if (stopped) {
					return;
				}
				const message = error instanceof Error ? error.message : 'unknown connection error';
				connectionState = 'disconnected';
				syncConnectionStatus();
				appendUiLogRecord(
					'error',
					UI_LOG_TAG_TRANSPORT,
					`Connection failed: ${message} (retrying...)`
				);
				scheduleRetry();
			} finally {
				bootstrapInFlight = false;
			}
		};

		const onWindowKeydown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) {
				return;
			}
			void handleCommandShortcut(event);
		};

		unregisterCommands = commandSuite.registerCommandHandlers();
		if (enableGlobalShortcuts && typeof window !== 'undefined') {
			window.addEventListener('keydown', onWindowKeydown, true);
		}
		void bootstrap();

		mountedCleanup = (): void => {
			stopped = true;
			clearRetry();
			rejectQueuedIntents(new Error('workbench session unmounted'));
			if (enableGlobalShortcuts && typeof window !== 'undefined') {
				window.removeEventListener('keydown', onWindowKeydown, true);
			}
			unregisterCommands();
			unsubscribe();
			graph.reset();
			warnings.reset();
			descriptions.reset();
			customEvents.reset();
			footerHover.reset();
			history.reset();
			selection.reset();
			commandSuite.reset();
			logger.reset();
			resetProjectFileFormat();
			hasLoadedSnapshot = false;
			connectionState = 'connecting';
			syncConnectionStatus();
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
		get logRecords(): UiLogRecord[] {
			return logger.logRecords;
		},
		get logMaxEntries(): number {
			return logger.logMaxEntries;
		},
		get logUiUpdateHz(): number {
			return logger.logUiUpdateHz;
		},
		get selectedNodesIds(): NodeId[] {
			return selection.selectedNodeIds;
		},
		get selectedNodeId(): NodeId | null {
			return selection.selectedNodeId;
		},
		get status(): WorkbenchConnectionStatus {
			return status;
		},
		get toasts(): WorkbenchToast[] {
			return logger.toasts;
		},
		get historyBusy(): boolean {
			return history.historyBusy;
		},
		get canUndo(): boolean {
			return history.canUndo;
		},
		get canRedo(): boolean {
			return history.canRedo;
		},
		get currentHistoryStateId(): number {
			return history.currentHistoryStateId;
		},
		get hasActiveEditSession(): boolean {
			return history.hasActiveEditSession;
		},
		get editSessionEpoch(): number {
			return history.editSessionEpoch;
		},
		getNodeData,
		getSelectedNodes: () => selection.getSelectedNodes(),
		getFirstSelectedNode: () => selection.getFirstSelectedNode(),
		getNodeDescription,
		getCustomEventSequence,
		getFooterHoverInfo,
		getNodeVisibleWarnings: (nodeId) => warnings.getNodeVisibleWarnings(nodeId),
		getActiveWarnings: () => warnings.getActiveWarnings(),
		hasNodeWarnings: (nodeId) => warnings.hasNodeWarnings(nodeId),
		isNodeEnabledInHierarchy,
		isNodeSelected: (nodeId) => selection.isNodeSelected(nodeId),
		setFooterHover,
		clearFooterHover,
		selectNode: (nodeId, selectionMode) => selection.selectNode(nodeId, selectionMode),
		selectNodes: (nodeIds, selectionMode) => selection.selectNodes(nodeIds, selectionMode),
		clearSelection: () => selection.clearSelection(),
		appendUiLogRecord,
		sendIntent,
		setLogUiUpdateHz,
		dismissToast,
		undo,
		redo,
		refreshSnapshot,
		mount
	};
};
