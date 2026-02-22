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
	import EnableButton from '../../common/EnableButton.svelte';

	const initialProps: PanelProps = $props();
	const panelApi = initialProps.panelApi;

	let panel = $state<PanelState>({
		panelId: initialProps.panelId,
		panelType: initialProps.panelType,
		title: initialProps.title,
		params: initialProps.params
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
		applyPersistedState(next.params);
	};

	let session = $derived(appState.session);

	let selectedNodes = $derived(session?.getSelectedNodes() ?? []);

	let iconURL = $derived(selectedNodes.length === 1 ? getIconURLForNode(selectedNodes[0]) : null);
	let warnings = $derived(
		selectedNodes.length === 1 ? session?.getNodeVisibleWarnings(selectedNodes[0].node_id) : null
	);

	let warningCount = $derived(warnings ? warnings.length : 0);

	let dataInspectorCollapsed = $state(true);

	interface InspectorPersistedState {
		dataInspectorCollapsed?: boolean;
	}

	const applyPersistedState = (params: PanelState['params']): void => {
		const persistedState = readPanelPersistedState<InspectorPersistedState>(params);

		if (
			typeof persistedState.dataInspectorCollapsed === 'boolean' &&
			persistedState.dataInspectorCollapsed !== dataInspectorCollapsed
		) {
			dataInspectorCollapsed = persistedState.dataInspectorCollapsed;
		}
	};

	const persistState = (nextState: Partial<InspectorPersistedState>): void => {
		writePanelPersistedState(panelApi, nextState);
	};

	const toggleDataInspector = (): void => {
		dataInspectorCollapsed = !dataInspectorCollapsed;
		persistState({ dataInspectorCollapsed });
	};

	applyPersistedState(initialProps.params);
</script>

<div class="inspector">
	{#if selectedNodes.length === 0}
		<div class="inspector-header">
			<span>No node selected</span>
		</div>
	{:else}
		<div class="inspector-header">
			<span class="header-icon">
				{#if iconURL}
					<img src={iconURL} alt="" />
				{/if}
			</span>

			<EnableButton node={selectedNodes[0]} />

			<span class="target-id">
				{selectedNodes.length > 0
					? selectedNodes.length === 1
						? selectedNodes[0].meta.label
						: selectedNodes.length + ' selected nodes'
					: ''}

				<button
					class="copy-button"
					title="Copy ID to Clipboard"
					onclick={() => {
						if (selectedNodes.length === 1) {
							navigator.clipboard.writeText(selectedNodes[0].uuid);
						}
					}}>📋</button>
			</span>
		</div>

		{#if warningCount > 0}
			<div class="warning-info" transition:slide={{ duration: 200 }}>
				{#each warnings as warning}
					<div class="warning-item" transition:slide={{ duration: 200 }}>
						{#if warning.sourceNodeId != selectedNodes[0].node_id}
							<strong>{warning.sourceNodeLabel}:</strong>
						{/if}
						{warning.message}
					</div>
				{/each}
			</div>
		{/if}

		<div class="inspector-content">
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

	.inspector-header .target-id {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0;
		font-size: 0.9rem;
		font-weight: bold;
		border-radius: 0.5em;
		background-color: rgba(from var(--panel-bg-color) r g b / 6%);
		color: var(--text-color);
	}

	.inspector-header .copy-button {
		cursor: pointer;
		opacity: 0.5;
		transition: opacity 0.2s ease;
		cursor: pointer;
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
		height: 100%;
		overflow-x: hidden;
		overflow: -moz-scrollbars-vertical;
		overflow-y: auto;
		scrollbar-gutter: stable;
		padding-right: 0.3rem;
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
