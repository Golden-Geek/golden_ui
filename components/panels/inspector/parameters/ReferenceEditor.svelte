<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let value = $derived(param?.value.kind === 'reference' ? param.value : null);
</script>

<div class="reference-editor">
	{#if value && value.uuid.length > 0}
		<span class="uuid">{value.uuid}</span>
	{:else}
		<span class="empty">No reference</span>
	{/if}
</div>

<style>
	.reference-editor {
		display: flex;
		max-width: 14rem;
	}

	.uuid {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
