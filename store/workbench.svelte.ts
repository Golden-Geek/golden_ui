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
	UiNodeWarningDto,
	UiNodeDto,
	UiClient,
	UiEditIntent,
	UiEventBatch,
	UiEventDto,
	UiLogRecord,
	UiHistoryState,
	UiAck,
	UiSnapshot,
	UiSubscriptionScope,
	UiParameterControlState
} from '../types';
import { wholeGraphScope } from '../types';
import { DEFAULT_LOG_UI_UPDATE_HZ, normalizeLogUiUpdateHz } from './logger-ui-config';
import { handleCommandShortcut } from './commands.svelte';
import { createWorkbenchSelectionStore } from './session/selection.svelte';
import { createWorkbenchWarningStore } from './session/warnings.svelte';
import { createWorkbenchCommandSuite } from './session/commands.svelte';
import type { NodeWarningRecord, SelectionMode } from './session/types';
export type { NodeWarningRecord, SelectionMode } from './session/types';

export { appState } from './app-state.svelte';

export interface WorkbenchSessionOptions {
	wsUrl?: string;
	httpBaseUrl?: string;
	pollIntervalMs?: number;
	scope?: UiSubscriptionScope;
	bootstrapRetryMs?: number;
	transportFactory?: UiTransportFactory;
}

export type WorkbenchConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type WorkbenchToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface WorkbenchToast {
	id: number;
	level: WorkbenchToastLevel;
	message: string;
}

export interface FooterHoverInfo {
	node_id: NodeId;
	label: string;
	node_type: string;
	description: string;
}

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
	readonly hasActiveEditSession: boolean;
	readonly editSessionEpoch: number;
	getNodeData(nodeId: NodeId): UiNodeDto | null;
	getSelectedNodes(): UiNodeDto[];
	getFirstSelectedNode(): UiNodeDto | null;
	getNodeDescription(node: UiNodeDto | null | undefined): string | null;
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
	sendIntent(intent: UiEditIntent): Promise<void>;
	setLogUiUpdateHz(hz: number): void;
	dismissToast(toastId: number): void;
	undo(): Promise<void>;
	redo(): Promise<void>;
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
const MAX_TOASTS = 3;
const DEFAULT_TOAST_DURATION_MS = 5000;
const UI_LOG_TAG_INTENT = 'intent';
const UI_LOG_TAG_TRANSPORT = 'transport';

type PendingLogMutation =
	| { kind: 'clear' }
	| { kind: 'replaceRecord'; record: UiLogRecord }
	| { kind: 'append'; records: UiLogRecord[] };

interface FooterHoverEntry {
	token: symbol;
	nodeId: NodeId;
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const asUiLogRecord = (payload: unknown): UiLogRecord | null => {
	if (!isRecord(payload)) {
		return null;
	}

	const id = Number(payload.id);
	const timestampMs = Number(payload.timestamp_ms);
	const level = payload.level;
	const tag = payload.tag;
	const message = payload.message;
	const originRaw = payload.origin;
	const repeatCountRaw = payload.repeat_count;

	if (
		!Number.isFinite(id) ||
		!Number.isFinite(timestampMs) ||
		(level !== 'success' && level !== 'info' && level !== 'warning' && level !== 'error') ||
		typeof tag !== 'string' ||
		typeof message !== 'string'
	) {
		return null;
	}

	const origin = typeof originRaw === 'number' ? originRaw : undefined;
	const repeatCount =
		typeof repeatCountRaw === 'number' && Number.isFinite(repeatCountRaw)
			? Math.max(1, Math.floor(repeatCountRaw))
			: undefined;
	return {
		id,
		timestamp_ms: timestampMs,
		level,
		tag,
		message,
		repeat_count: repeatCount,
		origin
	};
};

export const createWorkbenchSession = (options: WorkbenchSessionOptions = {}): WorkbenchSession => {
	const scope = options.scope ?? wholeGraphScope;
	const retryMs = Math.max(100, options.bootstrapRetryMs ?? DEFAULT_RETRY_MS);
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

	let status = $state<WorkbenchConnectionStatus>('connecting');
	const selection = createWorkbenchSelectionStore(graph);
	const warnings = createWorkbenchWarningStore(graph);
	let historyBusy = $state(false);
	let canUndo = $state(false);
	let canRedo = $state(false);
	let hasActiveEditSession = $state(false);
	let editSessionEpoch = $state(0);
	let toasts = $state<WorkbenchToast[]>([]);
	let logRecords = $state<UiLogRecord[]>([]);
	let logMaxEntries = $state(0);
	let logUiUpdateHz = $state(DEFAULT_LOG_UI_UPDATE_HZ);
	let nodeTypeDescriptions = $state<Map<string, string>>(new Map());
	let declaredDescriptions = $state<Map<string, string>>(new Map());
	let footerHoverStack = $state<FooterHoverEntry[]>([]);
	const pendingLogMutations: PendingLogMutation[] = [];
	let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

	let mountedCleanup: (() => void) | null = null;
	let resyncInFlight = false;
	let resyncQueued = false;
	let snapshotRequestInFlight: Promise<UiSnapshot> | null = null;
	let hasLoadedSnapshot = false;
	let connectionState: UiTransportConnectionState = 'connecting';
	let nextToastId = 0;
	let nextUiLogId = -1;
	const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const uiGeneratedLogIds = new Set<number>();
	const pendingIntentQueue: QueuedIntent[] = [];
	let intentQueueProcessing = false;
	// Keep batch payloads bounded while still reducing setParam fan-out.
	const MAX_SET_PARAM_BATCH_SIZE = 512;

	const normalizeDescription = (value: string | null | undefined): string | null => {
		const text = typeof value === 'string' ? value.trim() : '';
		return text.length > 0 ? text : null;
	};

	const rebuildNodeTypeDescriptions = (descriptors: UiSnapshot['schema']['node_types']): void => {
		const nextDescriptions = new Map<string, string>();
		for (const descriptor of descriptors) {
			const nodeType = descriptor.node_type.trim();
			const description = normalizeDescription(descriptor.description);
			if (nodeType.length === 0 || description === null) {
				continue;
			}
			nextDescriptions.set(nodeType, description);
		}
		nodeTypeDescriptions = nextDescriptions;
	};

	const rebuildDeclaredDescriptions = (
		descriptors: UiSnapshot['schema']['declared_descriptions']
	): void => {
		const nextDescriptions = new Map<string, string>();
		for (const descriptor of descriptors) {
			const key = descriptor.key.trim();
			const description = normalizeDescription(descriptor.description);
			if (key.length === 0 || description === null) {
				continue;
			}
			nextDescriptions.set(key, description);
		}
		declaredDescriptions = nextDescriptions;
	};

	const getNodeDescription = (node: UiNodeDto | null | undefined): string | null => {
		if (!node) {
			return null;
		}
		const declaredDescriptionKey =
			typeof node.meta.declared_description_key === 'string'
				? node.meta.declared_description_key.trim()
				: '';
		if (declaredDescriptionKey.length > 0) {
			if (node.meta.description_overridden) {
				return normalizeDescription(node.meta.description);
			}
			return declaredDescriptions.get(declaredDescriptionKey) ?? null;
		}
		return (
			normalizeDescription(node.meta.description) ??
			nodeTypeDescriptions.get(node.node_type) ??
			null
		);
	};

	const clearFooterHover = (token: symbol): void => {
		const nextStack = footerHoverStack.filter((entry) => entry.token !== token);
		if (nextStack.length !== footerHoverStack.length) {
			footerHoverStack = nextStack;
		}
	};

	const setFooterHover = (token: symbol, nodeId: NodeId): void => {
		if (!graph.state.nodesById.has(nodeId)) {
			clearFooterHover(token);
			return;
		}
		footerHoverStack = [
			...footerHoverStack.filter((entry) => entry.token !== token),
			{ token, nodeId }
		];
	};

	const pruneFooterHoverStack = (): void => {
		if (footerHoverStack.length === 0) {
			return;
		}
		const nextStack = footerHoverStack.filter((entry) => graph.state.nodesById.has(entry.nodeId));
		if (nextStack.length !== footerHoverStack.length) {
			footerHoverStack = nextStack;
		}
	};

	const getFooterHoverInfo = (): FooterHoverInfo | null => {
		for (let index = footerHoverStack.length - 1; index >= 0; index -= 1) {
			const node = graph.state.nodesById.get(footerHoverStack[index]?.nodeId ?? -1);
			if (!node) {
				continue;
			}
			const description = getNodeDescription(node);
			if (description === null) {
				return null;
			}
			return {
				node_id: node.node_id,
				label: node.meta.label,
				node_type: node.node_type,
				description
			};
		}
		return null;
	};

	const clearToastTimer = (toastId: number): void => {
		const timer = toastTimers.get(toastId);
		if (!timer) {
			return;
		}
		clearTimeout(timer);
		toastTimers.delete(toastId);
	};

	const dismissToast = (toastId: number): void => {
		clearToastTimer(toastId);
		const nextToasts = toasts.filter((toast) => toast.id !== toastId);
		if (nextToasts.length !== toasts.length) {
			toasts = nextToasts;
		}
	};

	const scheduleToastDismiss = (toastId: number, durationMs: number): void => {
		clearToastTimer(toastId);
		toastTimers.set(
			toastId,
			setTimeout(() => {
				dismissToast(toastId);
			}, durationMs)
		);
	};

	const clearToasts = (): void => {
		for (const toastId of [...toastTimers.keys()]) {
			clearToastTimer(toastId);
		}
		toasts = [];
	};

	const emitToastForLogRecord = (
		record: Pick<UiLogRecord, 'level' | 'message'>,
		durationMs = DEFAULT_TOAST_DURATION_MS
	): void => {
		if (record.level === 'info') {
			return;
		}
		pushToast(record.message, record.level, durationMs);
	};

	const pushToast = (
		message: string,
		level: WorkbenchToastLevel = 'info',
		durationMs = DEFAULT_TOAST_DURATION_MS
	): void => {
		const normalizedMessage = message.trim();
		if (normalizedMessage.length === 0) {
			return;
		}

		const lastToast = toasts[toasts.length - 1];
		if (lastToast && lastToast.message === normalizedMessage && lastToast.level === level) {
			scheduleToastDismiss(lastToast.id, durationMs);
			return;
		}

		if (toasts.length >= MAX_TOASTS) {
			const oldestToast = toasts[0];
			if (oldestToast) {
				dismissToast(oldestToast.id);
			}
		}

		const toast: WorkbenchToast = {
			id: nextToastId,
			level,
			message: normalizedMessage
		};
		nextToastId += 1;
		toasts = [...toasts, toast];
		scheduleToastDismiss(toast.id, durationMs);
	};

	const syncConnectionStatus = (): void => {
		status = toConnectionStatus(connectionState, hasLoadedSnapshot);
	};

	const compareLogRecords = (left: UiLogRecord, right: UiLogRecord): number => {
		if (left.timestamp_ms !== right.timestamp_ms) {
			return left.timestamp_ms - right.timestamp_ms;
		}
		return left.id - right.id;
	};

	const trimLogRecords = (): void => {
		if (logMaxEntries <= 0) {
			return;
		}
		const overflow = logRecords.length - logMaxEntries;
		if (overflow <= 0) {
			return;
		}
		const removedRecords = logRecords.slice(0, overflow);
		for (const record of removedRecords) {
			uiGeneratedLogIds.delete(record.id);
		}
		logRecords = logRecords.slice(overflow);
	};

	const findLogRecordIndexById = (recordId: number): number => {
		for (let index = logRecords.length - 1; index >= 0; index -= 1) {
			if (logRecords[index]?.id === recordId) {
				return index;
			}
		}
		return -1;
	};

	const appendUiLogRecord = (
		level: WorkbenchToastLevel,
		tag: string,
		message: string,
		origin?: NodeId
	): void => {
		const normalizedMessage = message.trim();
		if (normalizedMessage.length === 0) {
			return;
		}

		flushPendingLogMutations();
		const timestampMs = Date.now();
		const lastRecord = logRecords[logRecords.length - 1];
		if (
			lastRecord &&
			uiGeneratedLogIds.has(lastRecord.id) &&
			lastRecord.level === level &&
			lastRecord.tag === tag &&
			lastRecord.message === normalizedMessage &&
			lastRecord.origin === origin
		) {
			const repeatCount = Math.max(1, Math.floor(lastRecord.repeat_count ?? 1)) + 1;
			const nextRecord: UiLogRecord = {
				...lastRecord,
				timestamp_ms: timestampMs,
				repeat_count: repeatCount
			};
			logRecords = [...logRecords.slice(0, -1), nextRecord];
			emitToastForLogRecord(nextRecord);
			return;
		}

		const record: UiLogRecord = {
			id: nextUiLogId,
			timestamp_ms: timestampMs,
			level,
			tag,
			message: normalizedMessage,
			origin
		};
		nextUiLogId -= 1;
		uiGeneratedLogIds.add(record.id);
		logRecords = [...logRecords, record];
		trimLogRecords();
		emitToastForLogRecord(record);
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

	const clearPendingLogFlush = (): void => {
		if (logFlushTimer !== null) {
			clearTimeout(logFlushTimer);
			logFlushTimer = null;
		}
	};

	const resetPendingLogMutations = (): void => {
		pendingLogMutations.length = 0;
		clearPendingLogFlush();
	};

	const flushPendingLogMutations = (): void => {
		logFlushTimer = null;
		if (pendingLogMutations.length === 0) {
			return;
		}

		for (const mutation of pendingLogMutations) {
			if (mutation.kind === 'clear') {
				if (logRecords.length > 0) {
					logRecords = [];
				}
				uiGeneratedLogIds.clear();
				continue;
			}

			if (mutation.kind === 'replaceRecord') {
				const recordIndex = findLogRecordIndexById(mutation.record.id);
				if (recordIndex >= 0) {
					logRecords[recordIndex] = mutation.record;
					logRecords = [...logRecords];
				} else {
					logRecords = [...logRecords, mutation.record];
				}
				continue;
			}

			if (mutation.records.length > 0) {
				logRecords.push(...mutation.records);
			}
		}

		pendingLogMutations.length = 0;
		trimLogRecords();
	};

	const schedulePendingLogFlush = (): void => {
		if (logFlushTimer !== null) {
			return;
		}
		const intervalMs = Math.max(1, Math.round(1000 / logUiUpdateHz));
		logFlushTimer = setTimeout(() => {
			flushPendingLogMutations();
		}, intervalMs);
	};

	const queuePendingLogMutations = (
		shouldClearLogs: boolean,
		replaceRecords: UiLogRecord[],
		pendingLogRecords: UiLogRecord[]
	): void => {
		if (shouldClearLogs) {
			pendingLogMutations.length = 0;
			pendingLogMutations.push({ kind: 'clear' });
		} else {
			for (const record of replaceRecords) {
				pendingLogMutations.push({ kind: 'replaceRecord', record });
			}
		}

		if (pendingLogRecords.length > 0) {
			pendingLogMutations.push({
				kind: 'append',
				records: [...pendingLogRecords]
			});
		}

		if (pendingLogMutations.length > 0) {
			schedulePendingLogFlush();
		}
	};

	const setLogUiUpdateHz = (hz: number): void => {
		const normalized = normalizeLogUiUpdateHz(hz);
		if (normalized === logUiUpdateHz) {
			return;
		}
		console.log(`Setting log UI update frequency to ${normalized} Hz`);
		logUiUpdateHz = normalized;
		if (pendingLogMutations.length > 0) {
			clearPendingLogFlush();
			schedulePendingLogFlush();
		}
	};

	const applyHistoryState = (history: UiHistoryState | undefined): void => {
		if (!history) {
			return;
		}
		canUndo = history.can_undo;
		canRedo = history.can_redo;
		if (hasActiveEditSession !== history.active_edit_session) {
			editSessionEpoch += 1;
		}
		hasActiveEditSession = history.active_edit_session;
	};

	const applySnapshotToState = (snapshot: UiSnapshot): void => {
		const retainedUiLogRecords = logRecords.filter((record) => uiGeneratedLogIds.has(record.id));
		graph.loadSnapshot(snapshot);
		rebuildNodeTypeDescriptions(snapshot.schema.node_types);
		rebuildDeclaredDescriptions(snapshot.schema.declared_descriptions);
		pruneFooterHoverStack();
		hasLoadedSnapshot = true;
		warnings.invalidate();
		selection.restorePersistedSelection();
		selection.reconcileSelection();
		applyHistoryState(snapshot.history);
		resetPendingLogMutations();
		logMaxEntries = snapshot.logger.max_entries;
		logRecords = [...snapshot.logger.records, ...retainedUiLogRecords].sort(compareLogRecords);
		trimLogRecords();
		syncConnectionStatus();
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

	const resyncSnapshot = async (successMessage?: string): Promise<void> => {
		if (resyncInFlight) {
			resyncQueued = true;
			return;
		}
		resyncInFlight = true;
		resyncQueued = false;
		try {
			const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			const snapshot = await requestSnapshot();
			const fetchElapsedMs =
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) - fetchStartedAt;
			const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			applySnapshotToState(snapshot);
			if (successMessage) {
				appendUiLogRecord('info', UI_LOG_TAG_TRANSPORT, successMessage);
			}
			const applyElapsedMs =
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) - applyStartedAt;
			logUiPerf(
				`resync snapshot fetch_ms=${fetchElapsedMs.toFixed(1)} apply_ms=${applyElapsedMs.toFixed(
					1
				)} nodes=${snapshot.nodes.length}`
			);
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
		const graphEvents: UiEventDto[] = [];
		const pendingLogRecords: UiLogRecord[] = [];
		let shouldClearLogs = false;
		let nextLogMaxEntries: number | null = null;
		const replaceLogRecords = new Map<number, UiLogRecord>();

		for (const event of batch.events) {
			if (event.kind.kind !== 'custom') {
				graphEvents.push(event);
				continue;
			}

			if (event.kind.topic === '__logger.record') {
				const record = asUiLogRecord(event.kind.payload);
				if (!record) {
					continue;
				}
				const pendingTail = pendingLogRecords[pendingLogRecords.length - 1];
				if (pendingTail && pendingTail.id === record.id) {
					pendingLogRecords[pendingLogRecords.length - 1] = record;
					continue;
				}

				if (replaceLogRecords.has(record.id)) {
					replaceLogRecords.set(record.id, record);
					continue;
				}

				if (!shouldClearLogs && findLogRecordIndexById(record.id) >= 0) {
					replaceLogRecords.set(record.id, record);
					continue;
				}

				pendingLogRecords.push(record);
				emitToastForLogRecord(record);
				continue;
			}

			if (event.kind.topic === '__logger.cleared') {
				shouldClearLogs = true;
				pendingLogRecords.length = 0;
				replaceLogRecords.clear();
				continue;
			}

			if (event.kind.topic === '__logger.max_entries') {
				if (
					isRecord(event.kind.payload) &&
					Number.isFinite(Number(event.kind.payload.max_entries))
				) {
					nextLogMaxEntries = Math.max(1, Math.round(Number(event.kind.payload.max_entries)));
				}
				continue;
			}

			graphEvents.push(event);
		}

		if (nextLogMaxEntries !== null) {
			logMaxEntries = nextLogMaxEntries;
			trimLogRecords();
		}

		if (shouldClearLogs || replaceLogRecords.size > 0 || pendingLogRecords.length > 0) {
			queuePendingLogMutations(shouldClearLogs, [...replaceLogRecords.values()], pendingLogRecords);
		}

		if (graphEvents.length > 0) {
			const warningDataChanged = warnings.batchAffectsWarnings({
				from: batch.from,
				to: batch.to,
				events: graphEvents
			});
			graph.applyBatch({
				from: batch.from,
				to: graphEvents[graphEvents.length - 1]?.time ?? batch.to,
				events: graphEvents
			});
			pruneFooterHoverStack();
			if (warningDataChanged) {
				warnings.invalidate();
			}
			selection.reconcileSelection();
			if (graph.state.requiresResync) {
				void resyncSnapshot('Snapshot resynced.');
			}
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
		if (typeof window !== 'undefined') {
			window.addEventListener('keydown', onWindowKeydown, true);
		}
		void bootstrap();

		mountedCleanup = (): void => {
			stopped = true;
			clearRetry();
			rejectQueuedIntents(new Error('workbench session unmounted'));
			if (typeof window !== 'undefined') {
				window.removeEventListener('keydown', onWindowKeydown, true);
			}
			unregisterCommands();
			unsubscribe();
			graph.reset();
			warnings.reset();
			resetPendingLogMutations();
			nodeTypeDescriptions = new Map();
			declaredDescriptions = new Map();
			footerHoverStack = [];
			selection.reset();
			commandSuite.reset();
			uiGeneratedLogIds.clear();
			clearToasts();
			logRecords = [];
			logMaxEntries = 0;
			hasLoadedSnapshot = false;
			nextUiLogId = -1;
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
			return logRecords;
		},
		get logMaxEntries(): number {
			return logMaxEntries;
		},
		get logUiUpdateHz(): number {
			return logUiUpdateHz;
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
			return toasts;
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
		get hasActiveEditSession(): boolean {
			return hasActiveEditSession;
		},
		get editSessionEpoch(): number {
			return editSessionEpoch;
		},
		getNodeData,
		getSelectedNodes: () => selection.getSelectedNodes(),
		getFirstSelectedNode: () => selection.getFirstSelectedNode(),
		getNodeDescription,
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
		sendIntent,
		setLogUiUpdateHz,
		dismissToast,
		undo,
		redo,
		mount
	};
};
