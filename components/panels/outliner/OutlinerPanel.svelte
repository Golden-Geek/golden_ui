<script lang="ts">
	import type { PanelProps, PanelState } from '../../../dockview/panel-types';
	import type { UiNodeDto } from '../../../types';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import OutlinerItem from './OutlinerItem.svelte';

	let { panelId, panelType, title, params }: PanelProps = $props();
	let panel = $state<PanelState>({
		panelId: '',
		panelType: '',
		title: '',
		params: {}
	});

	$effect(() => {
		panel = {
			panelId,
			panelType,
			title,
			params
		};
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
	};

	let mainGraphState = $derived(appState.session?.graph.state);
	let query = $state('');

	let rootNode = $derived(mainGraphState?.nodesById.get(mainGraphState?.rootId ?? 0) ?? null);

	const nodeFilter = (candidate: UiNodeDto): boolean => {
		const normalizedQuery = query.trim().toLowerCase();
		if (normalizedQuery.length === 0) {
			return true;
		}
		const haystack =
			`${candidate.meta.label} ${candidate.meta.short_name} ${candidate.node_type}`.toLowerCase();
		return haystack.includes(normalizedQuery);
	};
</script>

{#if rootNode}
	<div class="outliner-panel">
		<div class="outliner-header">
			<input type="text" placeholder="Search..." class="outliner-search" bind:value={query} />
		</div>
		<div class="outliner-content">
			<div class="outliner-tree">
				<OutlinerItem node={rootNode} {nodeFilter} />
			</div>
		</div>
	</div>
{/if}

<style>
	.outliner-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.outliner-header {
		box-sizing: border-box;
	}
    
	.outliner-search {
		width: 100%;
		padding: 0.25rem;
        box-sizing: border-box;
	}
	.outliner-content {
		flex: 1;
		overflow: auto;
		scrollbar-gutter: stable;
		padding: 0.5rem;
	}
</style>
