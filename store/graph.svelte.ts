import type {
	EventTime,
	NodeId,
	UiEventBatch,
	UiEventDto,
	UiNodeDto,
	UiNodeMetaDto,
	UiParamDto,
	UiSnapshot
} from '../types';

export interface GraphState {
	rootId: NodeId | null;
	nodesById: Map<NodeId, UiNodeDto>;
	childrenById: Map<NodeId, NodeId[]>;
	parentById: Map<NodeId, NodeId>;
	paramsById: Map<NodeId, UiParamDto>;
	lastEventTime?: EventTime;
	requiresResync: boolean;
}

export interface GraphStore {
	readonly state: GraphState;
	loadSnapshot(snapshot: UiSnapshot): void;
	applyEvent(event: UiEventDto): void;
	applyBatch(batch: UiEventBatch): void;
	reset(): void;
}

const createEmptyState = (): GraphState => ({
	rootId: null,
	nodesById: new Map(),
	childrenById: new Map(),
	parentById: new Map(),
	paramsById: new Map(),
	lastEventTime: undefined,
	requiresResync: false
});

const detectRoot = (
	nodesById: Map<NodeId, UiNodeDto>,
	childrenById: Map<NodeId, NodeId[]>
): NodeId | null => {
	const childSet = new Set<NodeId>();
	for (const children of childrenById.values()) {
		for (const child of children) {
			childSet.add(child);
		}
	}

	for (const nodeId of nodesById.keys()) {
		if (!childSet.has(nodeId)) {
			return nodeId;
		}
	}

	return null;
};

const stateFromSnapshot = (snapshot: UiSnapshot): GraphState => {
	const nodesById = new Map<NodeId, UiNodeDto>();
	const childrenById = new Map<NodeId, NodeId[]>();
	const parentById = new Map<NodeId, NodeId>();
	const paramsById = new Map<NodeId, UiParamDto>();

	for (const node of snapshot.nodes) {
		nodesById.set(node.node_id, node);
		childrenById.set(node.node_id, [...node.children]);
		for (const childId of node.children) {
			parentById.set(childId, node.node_id);
		}
		if (node.data.kind === 'parameter') {
			paramsById.set(node.node_id, node.data.param);
		}
	}

	return {
		rootId: detectRoot(nodesById, childrenById),
		nodesById,
		childrenById,
		parentById,
		paramsById,
		lastEventTime: snapshot.at,
		requiresResync: false
	};
};

const removeFromChildren = (
	childrenById: Map<NodeId, NodeId[]>,
	parent: NodeId,
	child: NodeId
): void => {
	const existing = childrenById.get(parent);
	if (!existing) {
		return;
	}
	childrenById.set(
		parent,
		existing.filter((entry) => entry !== child)
	);
};

const addToChildren = (
	childrenById: Map<NodeId, NodeId[]>,
	parent: NodeId,
	child: NodeId
): void => {
	const existing = childrenById.get(parent) ?? [];
	if (existing.includes(child)) {
		return;
	}
	childrenById.set(parent, [...existing, child]);
};

const replaceInChildren = (
	childrenById: Map<NodeId, NodeId[]>,
	parent: NodeId,
	oldChild: NodeId,
	newChild: NodeId
): void => {
	const existing = childrenById.get(parent);
	if (!existing) {
		return;
	}
	childrenById.set(
		parent,
		existing.map((entry) => (entry === oldChild ? newChild : entry))
	);
};

const sameNodeOrder = (left: NodeId[], right: NodeId[]): boolean => {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
};

const syncNodeChildren = (state: GraphState, parent: NodeId): void => {
	const node = state.nodesById.get(parent);
	if (!node) {
		return;
	}
	const nextChildren = state.childrenById.get(parent) ?? [];
	if (sameNodeOrder(node.children, nextChildren)) {
		return;
	}
	state.nodesById.set(parent, {
		...node,
		children: [...nextChildren]
	});
};

const removeSubtree = (state: GraphState, nodeId: NodeId): void => {
	const children = state.childrenById.get(nodeId) ?? [];
	for (const child of children) {
		removeSubtree(state, child);
	}
	state.childrenById.delete(nodeId);
	state.parentById.delete(nodeId);
	state.nodesById.delete(nodeId);
	state.paramsById.delete(nodeId);
};

const applyMetaPatch = (node: UiNodeDto, patch: Partial<UiNodeMetaDto>): UiNodeDto => ({
	...node,
	meta: {
		...node.meta,
		...patch
	}
});

const shouldIgnoreTransportResync = (payload: unknown): boolean => {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		return false;
	}
	const reason = (payload as { reason?: unknown }).reason;
	return reason === 'script_config_updated' || reason === 'script_reload_requested';
};

const cloneState = (state: GraphState): GraphState => ({
	...state,
	nodesById: new Map(state.nodesById),
	childrenById: new Map(state.childrenById),
	parentById: new Map(state.parentById),
	paramsById: new Map(state.paramsById)
});

const reduceEventInPlace = (
	state: GraphState,
	event: UiEventDto
): { requiresRootRecompute: boolean } => {
	state.lastEventTime = event.time;
	let requiresRootRecompute = false;
	switch (event.kind.kind) {
		case 'paramChanged': {
			const node = state.nodesById.get(event.kind.param);
			if (!node || node.data.kind !== 'parameter') {
				state.requiresResync = true;
				break;
			}
			const updatedParam = {
				...node.data.param,
				value: event.kind.new_value
			};
			state.paramsById.set(event.kind.param, updatedParam);
			state.nodesById.set(event.kind.param, {
				...node,
				data: { kind: 'parameter', param: updatedParam }
			});
			break;
		}
		case 'paramControlChanged': {
			const node = state.nodesById.get(event.kind.param);
			if (!node || node.data.kind !== 'parameter') {
				state.requiresResync = true;
				break;
			}
			const updatedParam = {
				...node.data.param,
				control: event.kind.new_state
			};
			state.paramsById.set(event.kind.param, updatedParam);
			state.nodesById.set(event.kind.param, {
				...node,
				data: { kind: 'parameter', param: updatedParam }
			});
			break;
		}
		case 'childAdded': {
			addToChildren(state.childrenById, event.kind.parent, event.kind.child);
			state.parentById.set(event.kind.child, event.kind.parent);
			requiresRootRecompute = true;
			if (!state.nodesById.has(event.kind.parent)) {
				state.requiresResync = true;
			} else {
				syncNodeChildren(state, event.kind.parent);
			}
			if (!state.nodesById.has(event.kind.child)) {
				state.requiresResync = true;
			}
			break;
		}
		case 'childRemoved': {
			removeFromChildren(state.childrenById, event.kind.parent, event.kind.child);
			state.parentById.delete(event.kind.child);
			requiresRootRecompute = true;
			if (!state.nodesById.has(event.kind.parent)) {
				state.requiresResync = true;
			} else {
				syncNodeChildren(state, event.kind.parent);
			}
			if (state.nodesById.has(event.kind.child)) {
				removeSubtree(state, event.kind.child);
			}
			break;
		}
		case 'childReplaced': {
			replaceInChildren(state.childrenById, event.kind.parent, event.kind.old, event.kind.new);
			state.parentById.delete(event.kind.old);
			state.parentById.set(event.kind.new, event.kind.parent);
			requiresRootRecompute = true;
			if (!state.nodesById.has(event.kind.parent)) {
				state.requiresResync = true;
			} else {
				syncNodeChildren(state, event.kind.parent);
			}
			if (state.nodesById.has(event.kind.old)) {
				removeSubtree(state, event.kind.old);
			}
			if (!state.nodesById.has(event.kind.new)) {
				state.requiresResync = true;
			}
			break;
		}
		case 'childMoved': {
			removeFromChildren(state.childrenById, event.kind.old_parent, event.kind.child);
			addToChildren(state.childrenById, event.kind.new_parent, event.kind.child);
			state.parentById.set(event.kind.child, event.kind.new_parent);
			requiresRootRecompute = true;
			if (
				!state.nodesById.has(event.kind.old_parent) ||
				!state.nodesById.has(event.kind.new_parent)
			) {
				state.requiresResync = true;
			} else {
				syncNodeChildren(state, event.kind.old_parent);
				syncNodeChildren(state, event.kind.new_parent);
			}
			break;
		}
		case 'childReordered': {
			state.requiresResync = true;
			break;
		}
		case 'nodeCreated': {
			if (!state.nodesById.has(event.kind.node)) {
				state.requiresResync = true;
			}
			break;
		}
		case 'nodeDeleted': {
			if (state.nodesById.has(event.kind.node)) {
				removeSubtree(state, event.kind.node);
				requiresRootRecompute = true;
			}
			break;
		}
		case 'metaChanged': {
			const node = state.nodesById.get(event.kind.node);
			if (!node) {
				state.requiresResync = true;
				break;
			}
			state.nodesById.set(event.kind.node, applyMetaPatch(node, event.kind.patch));
			break;
		}
		case 'custom': {
			if (event.kind.topic === '__transport.resync_required') {
				if (shouldIgnoreTransportResync(event.kind.payload)) {
					break;
				}
				state.requiresResync = true;
			}
			break;
		}
	}
	return { requiresRootRecompute };
};

export const createGraphStore = (): GraphStore => {
	let state = $state<GraphState>(createEmptyState());

	return {
		get state(): GraphState {
			return state;
		},
		loadSnapshot(snapshot: UiSnapshot): void {
			state = stateFromSnapshot(snapshot);
		},
		applyEvent(event: UiEventDto): void {
			let next = cloneState(state);
			if (reduceEventInPlace(next, event).requiresRootRecompute) {
				next.rootId = detectRoot(next.nodesById, next.childrenById);
			}
			state = next;
		},
		applyBatch(batch: UiEventBatch): void {
			if (batch.events.length === 0) {
				if (batch.to) {
					state = { ...state, lastEventTime: batch.to };
				}
				return;
			}
			let next = cloneState(state);
			let requiresRootRecompute = false;
			for (const event of batch.events) {
				const result = reduceEventInPlace(next, event);
				requiresRootRecompute = requiresRootRecompute || result.requiresRootRecompute;
			}
			if (batch.to) {
				next = { ...next, lastEventTime: batch.to };
			}
			if (requiresRootRecompute) {
				next.rootId = detectRoot(next.nodesById, next.childrenById);
			}
			state = next;
		},
		reset(): void {
			state = createEmptyState();
		}
	};
};
