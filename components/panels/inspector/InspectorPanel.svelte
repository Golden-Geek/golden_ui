<script lang="ts">
	import { Menu } from "./inspector.svelte.ts";
	// import DataInspector from "./DataInspector.svelte";
	// import GenericInspector from "./GenericInspector.svelte";
	import { slide } from "svelte/transition";
	import { appState } from "../../../store/workbench.svelte.ts";
	import type {
		PanelProps,
		PanelState,
	} from "../../../dockview/panel-types.ts";

	const initialProps: PanelProps = $props();

	let panel = $state<PanelState>({
		panelId: initialProps.panelId,
		panelType: initialProps.panelType,
		title: initialProps.title,
		params: initialProps.params,
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
	};

	let session = $derived(appState.session);
	let mainGraphState = $derived(session?.graph.state);

	let currentMenu = Menu.Node; // $derived(mainState.editor?.inspectorMenu);

	let selectedNodes = $derived(session?.getSelectedNodes() ?? []);
	$inspect("nodes", selectedNodes);

	// $effect(() => {
	// 	switch (currentMenu) {
	// 		case Menu.Widget:
	// 			targets = selectedWidgets;
	// 			break;
	//
	// case Menu.Board:
	// 	targets = mainState.selectedBoard
	// 		? [mainState.selectedBoard]
	// 		: [];
	// 	break;

	// case Menu.Server:
	// 	targets = mainState.selectedServer
	// 		? [mainState.selectedServer]
	// 		: [];
	// 	break;
	//
	// 		case Menu.Global:
	// 			targets = mainState.globalSettings
	// 				? [mainState.globalSettings]
	// 				: [];
	// 			break;
	// 	}
	// });

	function setCurrentMenu(menu: Menu) {
		// mainState.editor.inspectorMenu = menu;
		// saveData("Change Inspector Menu", {
		// 	coalesceID: "change-inspector-menu",
		// });
	}

	let dataInspectorCollapsed = $state(true);
</script>

<div class="inspector">
	<div class="inspector-header">
		<span class="target-id"
			>{selectedNodes.length > 0
				? selectedNodes.length === 1
					? selectedNodes[0].uuid
					: selectedNodes.length + " selected nodes"
				: ""}
			<button
				class="copy-button"
				title="Copy ID to Clipboard"
				onclick={() => {
					if (selectedNodes.length === 1) {
						navigator.clipboard.writeText(selectedNodes[0].uuid);
					}
				}}>📋</button
			>
		</span>
	</div>
	<div class="menu-bar">
		{#each Object.values(Menu) as menu}
			<button
				class="menu-button {menu === currentMenu ? 'active' : ''}"
				style="--accent-color: var(--{menu.toLowerCase()}-color)"
				onclick={() => setCurrentMenu(menu)}
			>
				{menu}
			</button>
		{/each}
	</div>

	<div class="inspector-content">
		<!-- <GenericInspector {selectedNodes} /> -->
	</div>
	<div class="data-inspector {dataInspectorCollapsed ? 'collapsed' : ''}">
		<div
			class="data-inspector-header"
			onclick={() => (dataInspectorCollapsed = !dataInspectorCollapsed)}
		>
			<span>Raw Data</span>
			<div class="arrow {dataInspectorCollapsed ? 'up' : 'down'}"></div>
		</div>
		{#if !dataInspectorCollapsed}
			<div
				class="data-inspector-content"
				transition:slide|local={{ duration: 200 }}
			>
				<!-- <DataInspector {selectedNodes} /> -->
			</div>
		{/if}
	</div>
</div>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.inspector-header .target-id {
		font-size: 0.7rem;
		padding: 0.5em 0.8em;
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

	.menu-bar {
		position: relative;
		display: flex;
		margin-top: 0.25em;
		justify-content: space-around;
		background-color: var(--panel-background-color);
		border-bottom: 1px solid var(--border-color);
	}

	button.menu-button {
		background-color: var(--panel-background-color);
		border: none;
		padding: 0.5em 1em;
		cursor: pointer;
		color: var(--text-color);
		font-size: 0.8rem;
		border-bottom: solid 2px transparent;
		transition:
			color 0.1s,
			border-bottom-color 0.1s;
		border-radius: 0px;
	}

	button.menu-button:hover {
		color: var(--accent-color);
		border-bottom-color: var(--accent-color);
	}

	button.menu-button.active {
		font-weight: bold;
		border-bottom-color: var(--accent-color);
	}

	.inspector-content {
		height: 100%;
		overflow-x: hidden;
		overflow: -moz-scrollbars-vertical;
		overflow-y: auto;
		scrollbar-gutter: stable;
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
		border-top: solid 1px var(--border-color);
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
		overflow-x: hidden;
		overflow-y: visible;
		background-color: var(--bg-color);
		border-top: solid 1px var(--border-color);
		padding: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-color);
		width: 100%;
		height: 100%;
	}
</style>
