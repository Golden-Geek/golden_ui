import type {
	NodeId,
	ParamEventBehaviour,
	ParamValue,
	UiEditIntent,
	UiNodeMetaDto,
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

export const createUiEditSession = (
	label?: string,
	prefix = 'ui-edit'
): UiEditSession => {
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
