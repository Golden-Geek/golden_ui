<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import Vec2PadEditor from '$lib/golden_ui/components/panels/inspector/parameters/Vec2PadEditor.svelte';

	let {
		targetNode,
		insideLabel = null
	} = $props<{ targetNode: UiNodeDto; insideLabel?: string | null }>();
</script>

<div class="dashboard-node-widget-vec2-pad">
	{#if targetNode.data.kind === 'parameter' && targetNode.data.param.value.kind === 'vec2'}
		{#if typeof insideLabel === 'string' && insideLabel.trim().length > 0}
			<div class="dashboard-node-widget-vec2-pad-label">{insideLabel.trim()}</div>
		{/if}
		<Vec2PadEditor node={targetNode} layoutMode="widget" />
	{:else}
		<div class="dashboard-node-widget-mode-empty">2D Pad mode only applies to vec2 parameters.</div>
	{/if}
</div>

<style>
	.dashboard-node-widget-vec2-pad {
		display: flex;
		flex: 1 1 auto;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
		position: relative;
	}

	.dashboard-node-widget-vec2-pad-label {
		position: absolute;
		inset-block-start: 0.75rem;
		inset-inline-start: 0.75rem;
		z-index: 1;
		max-inline-size: calc(100% - 1.5rem);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}

	.dashboard-node-widget-mode-empty {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		text-align: center;
	}
</style>
