<script lang="ts">
	import NodeDataInspector from './NodeDataInspector.svelte';
	import NodeInspector from './NodeInspector.svelte';

	import { appState } from '../../../store/workbench.svelte.ts';
	import {
		readPanelPersistedState,
		writePanelPersistedState
	} from '../../../dockview/panel-persistence';
	import type { PanelProps, PanelState } from '../../../dockview/panel-types.ts';
	import { slide } from 'svelte/transition';
	import { getIconURLForNode } from '$lib/golden_ui/store/node-types';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import EnableButton from '../../common/EnableButton.svelte';
	import Watcher from '../../common/Watcher.svelte';
	import type { WatcherUiSettings } from '../../common/watcher/watcher-utils';

	let { panelApi, panelId, panelType, title, params }: PanelProps = $props();

	let panel = $state<PanelState>({
		panelId: '',
		panelType: '',
		title: '',
		params: {}
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
		applyPersistedState(next.params);
	};

	let session = $derived(appState.session);

	let selectedNodes = $derived(session?.getSelectedNodes() ?? []);
	let node = $derived(selectedNodes.length === 1 ? selectedNodes[0] : null);
	let iconURL = $derived(selectedNodes.length === 1 ? getIconURLForNode(selectedNodes[0]) : null);
	let isNameChangeable = $derived(node?.meta.user_permissions.can_edit_name ?? false);
	let warnings = $derived(
		selectedNodes.length === 1 ? session?.getNodeVisibleWarnings(selectedNodes[0].node_id) : null
	);

	let warningCount = $derived(warnings ? warnings.length : 0);
	let renameInputElem: HTMLInputElement | null = $state(null as HTMLInputElement | null);
	let renamingState = $state({
		isRenaming: false,
		renameDraft: ''
	});

	let dataInspectorCollapsed = $state(true);
	let watcherSettingsByParam = $state<Record<string, Partial<WatcherUiSettings>>>({});

	const WATCHER_SETTINGS_CACHE_LIMIT = 256;
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		typeof value === 'object' && value !== null && !Array.isArray(value);
	const sanitizeWatcherSettingsMap = (
		value: unknown
	): Record<string, Partial<WatcherUiSettings>> => {
		if (!isRecord(value)) {
			return {};
		}
		const entries: Array<[string, Partial<WatcherUiSettings>]> = [];
		for (const [paramKey, rawSettings] of Object.entries(value)) {
			if (!isRecord(rawSettings)) {
				continue;
			}
			entries.push([paramKey, rawSettings as Partial<WatcherUiSettings>]);
		}
		return Object.fromEntries(entries);
	};

	interface InspectorPersistedState {
		dataInspectorCollapsed?: boolean;
		watcherSettingsByParam?: Record<string, Partial<WatcherUiSettings>>;
	}

	const applyPersistedState = (params: PanelState['params']): void => {
		const persistedState = readPanelPersistedState<InspectorPersistedState>(params);

		if (
			typeof persistedState.dataInspectorCollapsed === 'boolean' &&
			persistedState.dataInspectorCollapsed !== dataInspectorCollapsed
		) {
			dataInspectorCollapsed = persistedState.dataInspectorCollapsed;
		}

		watcherSettingsByParam = sanitizeWatcherSettingsMap(persistedState.watcherSettingsByParam);
	};

	const persistState = (nextState: Partial<InspectorPersistedState>): void => {
		writePanelPersistedState(panelApi, nextState);
	};

	const toggleDataInspector = (): void => {
		dataInspectorCollapsed = !dataInspectorCollapsed;
		persistState({ dataInspectorCollapsed });
	};

	let selectedWatcherParamKey = $derived(node && node.data.kind === 'parameter' ? node.uuid : null);
	let selectedWatcherSettings = $derived(
		selectedWatcherParamKey ? (watcherSettingsByParam[selectedWatcherParamKey] ?? {}) : {}
	);

	const persistWatcherSettingsForSelectedParam = (
		nextPatch: Partial<WatcherUiSettings>
	): void => {
		if (!selectedWatcherParamKey) {
			return;
		}

		const currentSettings = watcherSettingsByParam[selectedWatcherParamKey] ?? {};
		const mergedSettings = {
			...currentSettings,
			...nextPatch
		};

		let didChange = false;
		for (const [key, value] of Object.entries(nextPatch)) {
			if ((currentSettings as Record<string, unknown>)[key] !== value) {
				didChange = true;
				break;
			}
		}
		if (!didChange) {
			return;
		}

		let nextMap: Record<string, Partial<WatcherUiSettings>> = {
			...watcherSettingsByParam,
			[selectedWatcherParamKey]: mergedSettings
		};

		const keys = Object.keys(nextMap);
		if (keys.length > WATCHER_SETTINGS_CACHE_LIMIT) {
			nextMap = Object.fromEntries(
				Object.entries(nextMap).slice(keys.length - WATCHER_SETTINGS_CACHE_LIMIT)
			);
		}

		watcherSettingsByParam = nextMap;
		persistState({ watcherSettingsByParam: nextMap });
	};

	$effect(() => {
		if (!renamingState.isRenaming || !renameInputElem) {
			return;
		}

		renameInputElem.focus();
		renameInputElem.select();
	});

	const startRename = (): void => {
		if (!node || !isNameChangeable) {
			return;
		}
		renamingState.renameDraft = node.meta.label;
		renamingState.isRenaming = true;
	};

	const cancelRename = (): void => {
		if (!node) {
			renamingState.isRenaming = false;
			return;
		}
		renamingState.renameDraft = node.meta.label;
		renamingState.isRenaming = false;
	};

	const commitRename = async (): Promise<void> => {
		if (!node || !isNameChangeable) {
			renamingState.isRenaming = false;
			return;
		}

		const nextName = String(renamingState.renameDraft ?? '').trim();
		if (!nextName || nextName === node.meta.label) {
			renamingState.isRenaming = false;
			return;
		}

		await sendPatchMetaIntent(node.node_id, { label: nextName });
		renamingState.isRenaming = false;
	};

	$effect(() => {
		panel = {
			panelId,
			panelType,
			title,
			params
		};
		applyPersistedState(params);
	});
</script>

<div class="inspector">
	{#if node == null}
		<div class="inspector-header">
			<span>No node selected</span>
		</div>
	{:else}
		<div class="inspector-header" data-node-id={node.node_id}>
			<span class="header-icon">
				{#if iconURL}
					<img src={iconURL} alt="" />
				{/if}
			</span>

			{#if node.meta.can_be_disabled}
				<EnableButton {node} />
			{/if}

			{#if renamingState.isRenaming}
				<input
					class="title-input"
					bind:this={renameInputElem}
					bind:value={renamingState.renameDraft}
					onblur={() => {
						void commitRename();
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							void commitRename();
							return;
						}
						if (e.key === 'Escape') {
							cancelRename();
						}
					}} />
			{:else}
				<span
					class="title-text {isNameChangeable ? 'name-changeable' : ''}"
					role="textbox"
					tabindex="-1"
					ondblclick={() => {
						startRename();
					}}
					title={isNameChangeable ? 'Double-click to rename' : undefined}>
					{node.meta.label}
				</span>
			{/if}
			<div class="node-id-badge">
				<span class="node-id">{node.decl_id}</span>
				<button
					class="copy-button"
					title="Copy path to Clipboard"
					onclick={() => {
						if (node) {
							navigator.clipboard.writeText(node.uuid);
						}
					}}>📋</button>
			</div>
		</div>

		{#if warningCount > 0}
			<div class="warning-info" transition:slide={{ duration: 200 }}>
				{#each warnings as warning}
					<div class="warning-item" transition:slide={{ duration: 200 }}>
						{#if warning.sourceNodeId != node.node_id}
							<strong>{warning.sourceNodeLabel}:</strong>
						{/if}
						{warning.message}
					</div>
				{/each}
			</div>
		{/if}

		<div class="inspector-content">

			{#if node && node.data.kind === 'parameter'}
				<div class="watcher-wrapper">
					<Watcher
						{node}
						persistedSettings={selectedWatcherSettings}
						onSettingsChange={persistWatcherSettingsForSelectedParam} />
				</div>
			{/if}
			<NodeInspector nodes={selectedNodes} level={0} />
		</div>

		<div class="data-inspector {dataInspectorCollapsed ? 'collapsed' : ''}">
			<div
				class="data-inspector-header"
				role="button"
				tabindex="0"
				onclick={toggleDataInspector}
				onkeydown={(e) => {
					if (e.key !== 'Enter' && e.key !== ' ') return;
					e.preventDefault();
					toggleDataInspector();
				}}>
				<span>Raw Data</span>
				<div class="arrow {dataInspectorCollapsed ? 'up' : 'down'}"></div>
			</div>
			{#if !dataInspectorCollapsed}
				<div class="data-inspector-content" transition:slide|local={{ duration: 200 }}>
					<NodeDataInspector nodes={selectedNodes} />
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.inspector-header {
		border-bottom: solid 1px rgba(255, 255, 255, 0.1);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem;
	}

	.inspector-header .header-icon img {
		width: 1.2rem;
		height: 1.2rem;
		vertical-align: middle;
	}

	.inspector-header .title-text {
		font-weight: 600;
	}

	.inspector-header .title-text.name-changeable {
		cursor: text;
	}

	.inspector-header .title-input {
		height: 1.5rem;
		min-width: 10rem;
		background-color: var(--bg-color);
		color: var(--text-color);
		font-size: 0.8rem;
		outline: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
		padding: 0 0.35rem;
	}

	.inspector-header .node-id-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		border-radius: 1rem;
		padding: 0.2rem 0.5rem;
		background-color: rgb(255, 255, 255, 0.1);
		border: solid 1px rgba(255, 255, 255, 0.07);
		color: var(--text-color);
	}

	.inspector-header .copy-button {
		cursor: pointer;
		opacity: 0.5;
		transition: opacity 0.2s ease;
		cursor: pointer;
		padding: 0;
	}

	.inspector-header .copy-button:hover {
		opacity: 1;
	}

	.warning-info {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.25rem;
		font-size: 0.8rem;
		color: var(--gc-color-warning);
		background-color: rgb(from var(--gc-color-warning) r g b / 20%);
		background-image: url('../../../style/icons/warning.svg');
		background-position: top 0.2rem right 0.3rem;
		background-repeat: no-repeat;
		background-size: 1rem;
		margin: 0.25rem 0;
		border-radius: 0.25rem;
		gap: 0.15rem;
	}

	.inspector-content {
		flex: 1 1 auto;
		min-height: 0;
		overflow-x: hidden;
		overflow: -moz-scrollbars-vertical;
		overflow-y: auto;
		scrollbar-gutter: stable;
		padding-right: 0.3rem;
	}

	.watcher-wrapper {
		padding: 0.35rem 0.15rem 0.2rem;
	}

	.data-inspector {
		max-height: 50%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.data-inspector .data-inspector-header {
		display: flex;
		padding: 0.3rem 0.5rem;
		border-radius: 0.3rem 0.3rem 0 0;
		justify-content: center;
		font-size: 0.7rem;
		background-color: rgba(255, 255, 255, 0.05);
		border-bottom: none;
		font-size: 0.7rem;
		cursor: pointer;
		transition: background-color 0.2s ease;
		border-top: solid 1px rgba(255, 255, 255, 0.1);
	}

	.data-inspector.collapsed .data-inspector-header {
		border-radius: 0.3rem;
	}

	.data-inspector .data-inspector-header:hover {
		background-color: rgba(255, 255, 255, 0.1);
	}

	.arrow {
		margin-left: 0.5rem;
	}

	.data-inspector-content {
		overflow-y: auto;
		scrollbar-gutter: stable;
		background-color: rgba(0, 0, 0, 0.6);
		border-top: solid 2px rgba(255, 255, 255, 0.2);
		padding: 0.5rem;
		box-sizing: border-box;
		border-radius: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-color);
		width: 100%;
		height: 100%;
	}
</style>
