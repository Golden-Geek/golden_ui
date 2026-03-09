import type {
	UiCreatableUserItem,
	UiAnimationCurveBezierFitOptions,
	UiAnimationCurveFitPoint,
	NodeId,
	ParamEventBehaviour,
	ParamValue,
	UiCreateUserItemInitialParam,
	UiEditIntent,
	UiNodeMetaDto,
	UiParameterControlState,
	UiScriptConfig
} from '../types';
import { appState } from './workbench.svelte';

let intentSequence = 0;

const nextIntentId = (prefix: string): string => {
	intentSequence += 1;
	return `${prefix}-${Date.now().toString(36)}-${intentSequence.toString(36)}`;
};

export interface UiEditSession {
	readonly active: boolean;
	begin(): Promise<void>;
	end(): Promise<void>;
}

export interface UiIntentBatchResult {
	readonly success: boolean;
	readonly appliedCount: number;
}

const sendUiIntent = async (intent: UiEditIntent): Promise<boolean> => {
	const session = appState.session;
	if (!session) {
		return false;
	}

	try {
		await session.sendIntent(intent);
		return true;
	} catch (error) {
		console.error('failed to send ui intent', intent, error);
		return false;
	}
};

export const sendUiIntentBatch = async (intents: UiEditIntent[]): Promise<UiIntentBatchResult> => {
	const session = appState.session;
	if (!session) {
		return { success: false, appliedCount: 0 };
	}
	if (intents.length === 0) {
		return { success: true, appliedCount: 0 };
	}

	try {
		const acks = await session.client.sendIntents(intents);
		const appliedCount = acks.filter((ack) => ack.success).length;
		return {
			success: appliedCount === intents.length,
			appliedCount
		};
	} catch (error) {
		console.error('failed to send ui intent batch', intents, error);
		return { success: false, appliedCount: 0 };
	}
};

export const sendSetParamIntent = async (
	node: NodeId,
	value: ParamValue,
	behaviour: ParamEventBehaviour
): Promise<boolean> => {
	return sendUiIntent({
		kind: 'setParam',
		node,
		value,
		behaviour
	});
};

export const sendSetParamControlStateIntent = async (
	node: NodeId,
	state: UiParameterControlState
): Promise<boolean> => {
	return sendUiIntent({
		kind: 'setParamControlState',
		node,
		state
	});
};

export const sendPatchMetaIntent = async (
	node: NodeId,
	patch: Partial<UiNodeMetaDto>
): Promise<boolean> => {
	return sendUiIntent({
		kind: 'patchMeta',
		node,
		patch
	});
};

export const sendClearLogsIntent = async (): Promise<boolean> => {
	return sendUiIntent({ kind: 'clearLogs' });
};

export const sendSetLogMaxEntriesIntent = async (max_entries: number): Promise<boolean> => {
	return sendUiIntent({
		kind: 'setLogMaxEntries',
		max_entries: Math.max(1, Math.round(max_entries))
	});
};

export const sendRemoveNodeIntent = async (node: NodeId): Promise<boolean> => {
	return sendUiIntent({
		kind: 'removeNode',
		node
	});
};

export const sendRemoveNodesIntent = async (nodes: NodeId[]): Promise<boolean> => {
	if (nodes.length === 0) {
		return false;
	}
	return sendUiIntent({
		kind: 'removeNodes',
		nodes
	});
};

export const sendMoveNodeIntent = async (
	node: NodeId,
	new_parent: NodeId,
	new_prev_sibling?: NodeId
): Promise<boolean> => {
	return sendUiIntent({
		kind: 'moveNode',
		node,
		new_parent,
		new_prev_sibling
	});
};

export const sendCreateUserItemIntent = async (
	parent: NodeId,
	item: UiCreatableUserItem
): Promise<boolean> => {
	return sendCreateUserItemByTypeIntent(parent, item.node_type, item.label);
};

interface CreateUserItemOptions {
	initial_params?: UiCreateUserItemInitialParam[];
}

export const sendCreateUserItemByTypeIntent = async (
	parent: NodeId,
	node_type: string,
	label?: string,
	options?: CreateUserItemOptions
): Promise<boolean> => {
	return sendUiIntent({
		kind: 'createUserItem',
		parent,
		node_type,
		label,
		initial_params: options?.initial_params
	});
};

export const sendFitAnimationCurvePathIntent = async (
	curve: NodeId,
	points: UiAnimationCurveFitPoint[],
	options: UiAnimationCurveBezierFitOptions
): Promise<boolean> => {
	if (points.length < 2) {
		return false;
	}
	return sendUiIntent({
		kind: 'fitAnimationCurvePath',
		curve,
		points,
		options
	});
};

export const sendSetScriptConfig = async (
	node: NodeId,
	config: UiScriptConfig,
	forceReload = false
): Promise<boolean> => {
	const session = appState.session;
	if (!session) {
		return false;
	}

	try {
		await session.client.setScriptConfig(node, config, forceReload);
		return true;
	} catch (error) {
		console.error('failed to set script config', { node, forceReload }, error);
		return false;
	}
};

export const sendReloadScript = async (node: NodeId): Promise<boolean> => {
	const session = appState.session;
	if (!session) {
		return false;
	}

	try {
		await session.client.reloadScript(node);
		return true;
	} catch (error) {
		console.error('failed to reload script', { node }, error);
		return false;
	}
};

export const createUiEditSession = (label?: string, prefix = 'ui-edit'): UiEditSession => {
	const clientEditId = nextIntentId(prefix);
	let active = false;

	return {
		get active(): boolean {
			return active;
		},
		async begin(): Promise<void> {
			if (active) {
				return;
			}
			const ok = await sendUiIntent({
				kind: 'beginEdit',
				client_edit_id: clientEditId,
				label
			});
			if (ok) {
				active = true;
			}
		},
		async end(): Promise<void> {
			if (!active) {
				return;
			}
			active = false;
			await sendUiIntent({
				kind: 'endEdit',
				client_edit_id: clientEditId
			});
		}
	};
};
