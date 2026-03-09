import { createGraphStore, type GraphStore } from './graph.svelte';
import { createWebSocketUiClient, type UiTransportConnectionState } from '../transport/ws';
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
import type { PanelController } from '../dockview/panel-types';
import {
	loadPersistedSelection,
	savePersistedSelection
} from './ui-persistence';
import { DEFAULT_LOG_UI_UPDATE_HZ, normalizeLogUiUpdateHz } from './logger-ui-config';
import {
	handleCommandShortcut,
	registerCommandHandler,
	type CommandId
} from './commands.svelte';
import {
	openProjectFile,
	reopenLastProjectFile,
	saveProjectFile,
	saveProjectFileAs
} from './project-files.svelte';

export type SelectionMode = 'REPLACE' | 'ADD' | 'REMOVE' | 'TOGGLE';

export interface WorkbenchSessionOptions {
	wsUrl?: string;
	httpBaseUrl?: string;
	pollIntervalMs?: number;
	scope?: UiSubscriptionScope;
	bootstrapRetryMs?: number;
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

export interface NodeWarningRecord {
	targetNodeId: NodeId;
	targetNodeLabel: string;
	sourceNodeId: NodeId;
	sourceNodeLabel: string;
	warningId: string;
	message: string;
	detail?: string;
	distance: number;
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
const DEFAULT_WARNING_ID = '';
const MAX_TOASTS = 3;
const DEFAULT_TOAST_DURATION_MS = 5000;
const UI_LOG_TAG_INTENT = 'intent';
const UI_LOG_TAG_TRANSPORT = 'transport';

type PendingLogMutation =
	| { kind: 'clear' }
	| { kind: 'replaceRecord'; record: UiLogRecord }
	| { kind: 'append'; records: UiLogRecord[] };

interface NodeClipboardEntry {
	node_type: string;
	label: string;
}

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

interface NormalizedNodeWarning {
	id: string;
	message: string;
	detail?: string;
}

interface VisibleWarningCacheEntry {
	version: number;
	warnings: NodeWarningRecord[];
}

const normalizeWarningId = (warningId: string | undefined): string =>
	typeof warningId === 'string' ? warningId : DEFAULT_WARNING_ID;

const normalizeNodeWarning = (warning: UiNodeWarningDto): NormalizedNodeWarning | null => {
	const message = String(warning.message ?? '').trim();
	if (message.length === 0) {
		return null;
	}

	const detailText = typeof warning.detail === 'string' ? warning.detail.trim() : '';
	return {
		id: normalizeWarningId(warning.id),
		message,
		detail: detailText.length > 0 ? detailText : undefined
	};
};

const normalizeWarningDepth = (value: unknown): number => {
	const rawDepth = Number(value);
	if (!Number.isFinite(rawDepth)) {
		return 0;
	}
	return Math.max(0, Math.floor(rawDepth));
};

export const appState = $state({
	session: null as WorkbenchSession | null,
	panels: null as PanelController | null
});


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
	let selectedNodeIds = $state<NodeId[]>([]);
	let nodeClipboard = $state<NodeClipboardEntry[]>([]);
	const persistedSelection = loadPersistedSelection();
	let shouldRestorePersistedSelection = persistedSelection.length > 0;
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
		return normalizeDescription(node.meta.description) ?? nodeTypeDescriptions.get(node.node_type) ?? null;
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

	const client = createWebSocketUiClient({
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
	});

	let warningCacheVersion = 0;
	let activeWarningsCacheVersion = -1;
	let activeWarningsCache: NodeWarningRecord[] = [];
	const visibleWarningsCache = new Map<NodeId, VisibleWarningCacheEntry>();

	const invalidateWarningCaches = (): void => {
		warningCacheVersion += 1;
		activeWarningsCacheVersion = -1;
		activeWarningsCache = [];
		visibleWarningsCache.clear();
	};

	const batchAffectsWarnings = (batch: UiEventBatch): boolean => {
		for (const event of batch.events) {
			switch (event.kind.kind) {
				case 'metaChanged':
				case 'childAdded':
				case 'childRemoved':
				case 'childReplaced':
				case 'childMoved':
				case 'childReordered':
				case 'nodeCreated':
				case 'nodeDeleted':
					return true;
				default:
					break;
			}
		}
		return false;
	};

	const getNodeData = (nodeId: NodeId): UiNodeDto | null => {
		return graph.state.nodesById.get(nodeId) ?? null;
	};

	const getMetaWarningsForNode = (node: UiNodeDto): Map<string, NormalizedNodeWarning> => {
		const rawEntries = node.meta.presentation?.warnings;
		const entries = Array.isArray(rawEntries) ? rawEntries : [];
		const warningsById = new Map<string, NormalizedNodeWarning>();
		for (const rawWarning of entries) {
			const normalized = normalizeNodeWarning(rawWarning);
			if (!normalized) {
				continue;
			}
			warningsById.set(normalized.id, normalized);
		}
		return warningsById;
	};

	const getNodeOwnWarnings = (nodeId: NodeId): NormalizedNodeWarning[] => {
		const node = graph.state.nodesById.get(nodeId);
		if (!node) {
			return [];
		}
		return [...getMetaWarningsForNode(node).values()];
	};

	const getNodeWarningChildDepth = (nodeId: NodeId): number => {
		const node = graph.state.nodesById.get(nodeId);
		if (!node) {
			return 0;
		}
		return normalizeWarningDepth(node.meta.presentation?.show_child_warnings_max_depth ?? 0);
	};

	const labelForNode = (nodeId: NodeId): string => {
		return graph.state.nodesById.get(nodeId)?.meta.label ?? `Node ${nodeId}`;
	};

	const computeNodeVisibleWarnings = (nodeId: NodeId): NodeWarningRecord[] => {
		const targetNode = graph.state.nodesById.get(nodeId);
		if (!targetNode) {
			return [];
		}

		const maxDepth = getNodeWarningChildDepth(nodeId);
		const pending: Array<{ nodeId: NodeId; depth: number }> = [{ nodeId, depth: 0 }];
		const seenMinDepth = new Map<NodeId, number>();
		const warningRecordsByKey = new Map<string, NodeWarningRecord>();

		while (pending.length > 0) {
			const current = pending.shift();
			if (!current) {
				continue;
			}

			const knownDepth = seenMinDepth.get(current.nodeId);
			if (knownDepth !== undefined && knownDepth <= current.depth) {
				continue;
			}
			seenMinDepth.set(current.nodeId, current.depth);

			const ownWarnings = getNodeOwnWarnings(current.nodeId);
			for (const warning of ownWarnings) {
				const key = `${current.nodeId}:${warning.id}`;
				if (warningRecordsByKey.has(key)) {
					continue;
				}
				warningRecordsByKey.set(key, {
					targetNodeId: nodeId,
					targetNodeLabel: targetNode.meta.label,
					sourceNodeId: current.nodeId,
					sourceNodeLabel: labelForNode(current.nodeId),
					warningId: warning.id,
					message: warning.message,
					detail: warning.detail,
					distance: current.depth
				});
			}

			if (current.depth >= maxDepth) {
				continue;
			}

			const children = graph.state.childrenById.get(current.nodeId) ?? [];
			for (const childNodeId of children) {
				pending.push({ nodeId: childNodeId, depth: current.depth + 1 });
			}
		}

		return [...warningRecordsByKey.values()].sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			const byLabel = left.sourceNodeLabel.localeCompare(right.sourceNodeLabel);
			if (byLabel !== 0) {
				return byLabel;
			}
			const byWarningId = left.warningId.localeCompare(right.warningId);
			if (byWarningId !== 0) {
				return byWarningId;
			}
			return left.message.localeCompare(right.message);
		});
	};

	const getNodeVisibleWarnings = (nodeId: NodeId): NodeWarningRecord[] => {
		// Keep Svelte dependency on graph state even when serving from cache.
		void graph.state.lastEventTime;

		const cached = visibleWarningsCache.get(nodeId);
		if (cached && cached.version === warningCacheVersion) {
			return cached.warnings;
		}

		const warnings = computeNodeVisibleWarnings(nodeId);
		visibleWarningsCache.set(nodeId, {
			version: warningCacheVersion,
			warnings
		});
		return warnings;
	};

	const computeActiveWarnings = (): NodeWarningRecord[] => {
		const allWarnings: NodeWarningRecord[] = [];
		for (const node of graph.state.nodesById.values()) {
			for (const warning of getNodeOwnWarnings(node.node_id)) {
				allWarnings.push({
					targetNodeId: node.node_id,
					targetNodeLabel: node.meta.label,
					sourceNodeId: node.node_id,
					sourceNodeLabel: node.meta.label,
					warningId: warning.id,
					message: warning.message,
					detail: warning.detail,
					distance: 0
				});
			}
		}

		return allWarnings.sort((left, right) => {
			const byLabel = left.sourceNodeLabel.localeCompare(right.sourceNodeLabel);
			if (byLabel !== 0) {
				return byLabel;
			}
			const byWarningId = left.warningId.localeCompare(right.warningId);
			if (byWarningId !== 0) {
				return byWarningId;
			}
			return left.message.localeCompare(right.message);
		});
	};

	const getActiveWarnings = (): NodeWarningRecord[] => {
		// Keep Svelte dependency on graph state even when serving from cache.
		void graph.state.lastEventTime;

		if (activeWarningsCacheVersion === warningCacheVersion) {
			return activeWarningsCache;
		}

		activeWarningsCache = computeActiveWarnings();
		activeWarningsCacheVersion = warningCacheVersion;
		return activeWarningsCache;
	};

	const hasNodeWarnings = (nodeId: NodeId): boolean => {
		return getNodeVisibleWarnings(nodeId).length > 0;
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

	const persistSelection = (): void => {
		savePersistedSelection(selectedNodeIds);
	};

	const setSelection = (nextSelection: NodeId[]): void => {
		selectedNodeIds = nextSelection;
		persistSelection();
	};

	const restorePersistedSelection = (): void => {
		if (!shouldRestorePersistedSelection) {
			return;
		}

		shouldRestorePersistedSelection = false;
		const validSelection = persistedSelection.filter((nodeId) => graph.state.nodesById.has(nodeId));
		setSelection(validSelection);
	};

	const reconcileSelection = (): void => {
		const nextSelection = selectedNodeIds.filter((nodeId) => graph.state.nodesById.has(nodeId));
		if (
			nextSelection.length === selectedNodeIds.length &&
			nextSelection.every((nodeId, index) => nodeId === selectedNodeIds[index])
		) {
			return;
		}

		setSelection(nextSelection);
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
		setSelection([]);
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
			setSelection(validUniqueIds);
			return;
		}

		if(selectionMode === 'REMOVE') {
			setSelection(selectedNodeIds.filter((id) => !validUniqueIds.includes(id)));
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
			setSelection(Array.from(toggled));
			return;
		}

		const merged = [...selectedNodeIds];
		for (const nodeId of validUniqueIds) {
			if (!merged.includes(nodeId)) {
				merged.push(nodeId);
			}
		}
		setSelection(merged);
	};

	const selectNode = (nodeId: NodeId | null, selectionMode: SelectionMode = 'REPLACE'): void => {
		if (nodeId === null) {
			clearSelection();
			return;
		}
		selectNodes([nodeId], selectionMode);
	};

	const getNodeDepth = (nodeId: NodeId): number => {
		let depth = 0;
		let current = graph.state.parentById.get(nodeId);
		while (current !== undefined) {
			depth += 1;
			current = graph.state.parentById.get(current);
		}
		return depth;
	};

	const isNodeRemovable = (node: UiNodeDto): boolean => {
		if (graph.state.rootId === node.node_id) {
			return false;
		}
		return node.meta.user_permissions.can_remove_and_duplicate;
	};

	const isFolderNode = (node: UiNodeDto): boolean => node.node_type === 'folder';

	const canParentCreateNodeType = (parentId: NodeId, nodeType: string): boolean => {
		const parent = graph.state.nodesById.get(parentId);
		if (!parent) {
			return false;
		}
		return parent.creatable_user_items.some((item) => item.node_type === nodeType);
	};

	const nextLabelInParent = (parentId: NodeId, baseLabel: string): string => {
		const parent = graph.state.nodesById.get(parentId);
		if (!parent) {
			return baseLabel;
		}
		const usedLabels = new Set<string>();
		for (const childId of parent.children) {
			const sibling = graph.state.nodesById.get(childId);
			if (!sibling) {
				continue;
			}
			const label = sibling.meta.label.trim();
			if (label.length > 0) {
				usedLabels.add(label);
			}
		}

		if (!usedLabels.has(baseLabel)) {
			return baseLabel;
		}

		let suffix = 2;
		while (usedLabels.has(`${baseLabel} ${suffix}`)) {
			suffix += 1;
		}
		return `${baseLabel} ${suffix}`;
	};

	const waitForCreatedChild = async (
		parentId: NodeId,
		knownChildren: Set<NodeId>,
		expectedNodeType: string
	): Promise<NodeId | null> => {
		const deadline = Date.now() + 450;
		while (Date.now() <= deadline) {
			const parent = graph.state.nodesById.get(parentId);
			if (parent) {
				for (const childId of parent.children) {
					if (knownChildren.has(childId)) {
						continue;
					}
					const child = graph.state.nodesById.get(childId);
					if (!child) {
						continue;
					}
					if (child.node_type === expectedNodeType) {
						return childId;
					}
				}
			}
			await new Promise((resolve) => {
				setTimeout(resolve, 16);
			});
		}
		return null;
	};

	const waitForCreatedChildLabel = async (
		parentId: NodeId,
		knownChildren: Set<NodeId>,
		expectedLabel: string
	): Promise<NodeId | null> => {
		const deadline = Date.now() + 450;
		while (Date.now() <= deadline) {
			const parent = graph.state.nodesById.get(parentId);
			if (parent) {
				for (const childId of parent.children) {
					if (knownChildren.has(childId)) {
						continue;
					}
					const child = graph.state.nodesById.get(childId);
					if (!child) {
						continue;
					}
					if (child.meta.label.trim() === expectedLabel.trim()) {
						return childId;
					}
				}
			}
			await new Promise((resolve) => {
				setTimeout(resolve, 16);
			});
		}
		return null;
	};

	const createNodeUnderParent = async (
		parentId: NodeId,
		nodeType: string,
		label: string,
		insertAfterNodeId: NodeId | null
	): Promise<NodeId | null> => {
		const parentBefore = graph.state.nodesById.get(parentId);
		if (!parentBefore) {
			return null;
		}
		const knownChildren = new Set(parentBefore.children);
		await sendIntent({
			kind: 'createUserItem',
			parent: parentId,
			node_type: nodeType,
			label
		});
		const createdNodeId = await waitForCreatedChild(parentId, knownChildren, nodeType);
		if (createdNodeId === null || insertAfterNodeId === null) {
			return createdNodeId;
		}
		await sendIntent({
			kind: 'moveNode',
			node: createdNodeId,
			new_parent: parentId,
			new_prev_sibling: insertAfterNodeId
		});
		return createdNodeId;
	};

	const removeSelectedNodesCommand = async (): Promise<boolean> => {
		const selected = getSelectedNodes();
		if (selected.length === 0) {
			return false;
		}

		const removable = selected.filter((node) => isNodeRemovable(node));
		if (removable.length === 0) {
			return false;
		}

		removable.sort((left, right) => getNodeDepth(right.node_id) - getNodeDepth(left.node_id));
		await sendIntent({
			kind: 'removeNodes',
			nodes: removable.map((node) => node.node_id)
		});
		return true;
	};

	const selectSiblingNodesCommand = (): boolean => {
		const anchorNode = getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}
		const parentId = graph.state.parentById.get(anchorNode.node_id);
		if (parentId === undefined) {
			return false;
		}
		const parent = graph.state.nodesById.get(parentId);
		if (!parent || parent.children.length === 0) {
			return false;
		}
		selectNodes([...parent.children], 'REPLACE');
		return true;
	};

	const copySelectedNodesCommand = (): boolean => {
		const selected = getSelectedNodes();
		if (selected.length === 0) {
			return false;
		}
		nodeClipboard = selected.map((node) => ({
			node_type: node.node_type,
			label: node.meta.label.trim().length > 0 ? node.meta.label.trim() : node.node_type
		}));
		return true;
	};

	const cutSelectedNodesCommand = async (): Promise<boolean> => {
		if (!copySelectedNodesCommand()) {
			return false;
		}
		return removeSelectedNodesCommand();
	};

	const duplicateSelectedNodesCommand = async (): Promise<boolean> => {
		const selectedSet = new Set(selectedNodeIds);
		const anchorNode = getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}
		const parentId = graph.state.parentById.get(anchorNode.node_id);
		if (parentId === undefined) {
			return false;
		}
		const parent = graph.state.nodesById.get(parentId);
		if (!parent) {
			return false;
		}

		const selectedSiblingIds = parent.children.filter((childId) => selectedSet.has(childId));
		if (selectedSiblingIds.length === 0) {
			return false;
		}

		let insertAfterNodeId: NodeId | null = selectedSiblingIds[selectedSiblingIds.length - 1] ?? null;
		const createdNodeIds: NodeId[] = [];
		for (const sourceId of selectedSiblingIds) {
			const source = graph.state.nodesById.get(sourceId);
			if (!source) {
				continue;
			}
			if (!source.meta.user_permissions.can_remove_and_duplicate) {
				continue;
			}
			if (!canParentCreateNodeType(parentId, source.node_type)) {
				continue;
			}

			const baseLabel =
				source.meta.label.trim().length > 0
					? `${source.meta.label.trim()} Copy`
					: `${source.node_type} Copy`;
			const label = nextLabelInParent(parentId, baseLabel);
			const parentBefore = graph.state.nodesById.get(parentId);
			if (!parentBefore) {
				continue;
			}
			const knownChildren = new Set(parentBefore.children);
			await sendIntent({
				kind: 'duplicateNode',
				source: sourceId,
				new_parent: parentId,
				new_prev_sibling: insertAfterNodeId,
				label
			});
			const createdNodeId = await waitForCreatedChildLabel(parentId, knownChildren, label);
			if (createdNodeId === null) {
				continue;
			}
			createdNodeIds.push(createdNodeId);
			insertAfterNodeId = createdNodeId;
		}

		if (createdNodeIds.length === 0) {
			return false;
		}
		selectNodes(createdNodeIds, 'REPLACE');
		return true;
	};

	const pasteNodesCommand = async (): Promise<boolean> => {
		if (nodeClipboard.length === 0) {
			return false;
		}

		const anchorNode = getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}

		let targetParentId: NodeId | undefined;
		let insertAfterNodeId: NodeId | null = null;
		if (isFolderNode(anchorNode)) {
			targetParentId = anchorNode.node_id;
		} else {
			targetParentId = graph.state.parentById.get(anchorNode.node_id);
			insertAfterNodeId = anchorNode.node_id;
		}
		if (targetParentId === undefined) {
			return false;
		}

		const createdNodeIds: NodeId[] = [];
		for (const entry of nodeClipboard) {
			if (!canParentCreateNodeType(targetParentId, entry.node_type)) {
				continue;
			}
			const label = nextLabelInParent(targetParentId, entry.label);
			const createdNodeId = await createNodeUnderParent(
				targetParentId,
				entry.node_type,
				label,
				insertAfterNodeId
			);
			if (createdNodeId === null) {
				continue;
			}
			createdNodeIds.push(createdNodeId);
			if (insertAfterNodeId !== null) {
				insertAfterNodeId = createdNodeId;
			}
		}

		if (createdNodeIds.length === 0) {
			return false;
		}
		selectNodes(createdNodeIds, 'REPLACE');
		return true;
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
		invalidateWarningCaches();
		restorePersistedSelection();
		reconcileSelection();
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
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) -
				fetchStartedAt;
			const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			applySnapshotToState(snapshot);
			if (successMessage) {
				appendUiLogRecord('info', UI_LOG_TAG_TRANSPORT, successMessage);
			}
			const applyElapsedMs =
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) -
				applyStartedAt;
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
				if (isRecord(event.kind.payload) && Number.isFinite(Number(event.kind.payload.max_entries))) {
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
			queuePendingLogMutations(
				shouldClearLogs,
				[...replaceLogRecords.values()],
				pendingLogRecords
			);
		}

		if (graphEvents.length > 0) {
			const warningDataChanged = batchAffectsWarnings({
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
				invalidateWarningCaches();
			}
			reconcileSelection();
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
				appendUiLogRecord(
					'error',
					UI_LOG_TAG_INTENT,
					`Error: ${message}`
				);
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
				const message =
					firstFailure.error_message ?? firstFailure.error_code ?? 'unknown error';
				appendUiLogRecord(
					'error',
					UI_LOG_TAG_INTENT,
					`Error: ${message}`
				);
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

	const registerWorkbenchCommandHandlers = (): (() => void) => {
		type CommandHandlerResult = boolean | void | Promise<boolean | void>;
		const cleanups: Array<() => void> = [];
		const bind = (commandId: CommandId, handler: () => CommandHandlerResult, priority = 10): void => {
			cleanups.push(
				registerCommandHandler(
					commandId,
					() => handler(),
					{ priority }
				)
			);
		};

		bind('edit.undo', () => {
			void undo();
			return true;
		}, 20);
		bind('edit.redo', () => {
			void redo();
			return true;
		}, 20);
		bind('edit.deleteSelection', () => removeSelectedNodesCommand(), 10);
		bind('select.all', () => selectSiblingNodesCommand(), 10);
		bind('edit.copy', () => copySelectedNodesCommand(), 10);
		bind('edit.cut', () => cutSelectedNodesCommand(), 10);
		bind('edit.duplicate', () => duplicateSelectedNodesCommand(), 10);
		bind('edit.paste', () => pasteNodesCommand(), 10);
		bind('file.save', () => saveProjectFile(), 15);
		bind('file.saveAs', () => saveProjectFileAs(), 15);
		bind('file.open', () => openProjectFile(), 15);
		bind('file.reopenLast', () => reopenLastProjectFile(), 15);

		return (): void => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		};
	};

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
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) -
					fetchStartedAt;
				if (stopped) {
					return;
				}
				const applyStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
				applySnapshotToState(snapshot);
				const applyElapsedMs =
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) -
					applyStartedAt;
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

		unregisterCommands = registerWorkbenchCommandHandlers();
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
			invalidateWarningCaches();
			resetPendingLogMutations();
			nodeTypeDescriptions = new Map();
			declaredDescriptions = new Map();
			footerHoverStack = [];
			selectedNodeIds = [];
			nodeClipboard = [];
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
			return selectedNodeIds;
		},
		get selectedNodeId(): NodeId | null {
			return selectedNodeIds[0] ?? null;
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
		getSelectedNodes,
		getFirstSelectedNode,
		getNodeDescription,
		getFooterHoverInfo,
		getNodeVisibleWarnings,
		getActiveWarnings,
		hasNodeWarnings,
		isNodeEnabledInHierarchy,
		isNodeSelected,
		setFooterHover,
		clearFooterHover,
		selectNode,
		selectNodes,
		clearSelection,
		sendIntent,
		setLogUiUpdateHz,
		dismissToast,
		undo,
		redo,
		mount
	};
};
