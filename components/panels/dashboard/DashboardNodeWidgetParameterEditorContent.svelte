<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import { propertiesInspectorClass } from '$lib/golden_ui/components/panels/inspector/inspector.svelte';

	let { targetNode } = $props<{
		targetNode: UiNodeDto;
	}>();

	let editorEntry = $derived.by(() => {
		if (targetNode.data.kind !== 'parameter') {
			return null;
		}
		return propertiesInspectorClass[targetNode.data.param.value.kind] ?? null;
	});

	let EditorComponent = $derived(editorEntry?.component ?? null);
</script>

<div class="dashboard-node-widget-parameter-editor">
	{#if targetNode.data.kind !== 'parameter'}
		<div class="dashboard-node-widget-mode-empty">Editor mode only applies to parameters.</div>
	{:else if EditorComponent}
		<div class="dashboard-node-widget-parameter-editor-body">
			<EditorComponent node={targetNode} />
		</div>
	{:else}
		<div class="dashboard-node-widget-mode-empty">No editor is registered for this parameter type.</div>
	{/if}
</div>

<style>
	.dashboard-node-widget-parameter-editor {
		display: flex;
		flex: 1 1 auto;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
	}

	.dashboard-node-widget-parameter-editor-body {
		display: flex;
		flex: 1 1 auto;
		align-items: stretch;
		justify-content: stretch;
		padding: 0.45rem;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-node-widget-parameter-editor :global(.number-property-container),
	.dashboard-node-widget-parameter-editor :global(.slider-wrapper),
	.dashboard-node-widget-parameter-editor :global(.css-value-editor),
	.dashboard-node-widget-parameter-editor :global(.multi-number-editor),
	.dashboard-node-widget-parameter-editor :global(.reference-property-container),
	.dashboard-node-widget-parameter-editor :global(.text-input-editor),
	.dashboard-node-widget-parameter-editor :global(.dropdown-container) {
		inline-size: 100%;
		max-inline-size: none;
		min-inline-size: 0;
	}

	.dashboard-node-widget-parameter-editor :global(.slider-wrapper) {
		flex: 1 1 auto;
	}

	.dashboard-node-widget-parameter-editor :global(textarea),
	.dashboard-node-widget-parameter-editor :global(input[type='text']),
	.dashboard-node-widget-parameter-editor :global(input[type='number']),
	.dashboard-node-widget-parameter-editor :global(select) {
		max-inline-size: none;
	}

	.dashboard-node-widget-mode-empty {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.72;
	}
</style>