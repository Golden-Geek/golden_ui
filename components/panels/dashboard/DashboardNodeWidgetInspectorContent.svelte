<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import NodeInspector from '$lib/golden_ui/components/panels/inspector/NodeInspector.svelte';

	let { targetNode, includeChildren = true } = $props<{
		targetNode: UiNodeDto;
		includeChildren?: boolean;
	}>();
</script>

<div class="dashboard-node-widget-inspector-scroll">
	<div class="dashboard-node-widget-inspector-natural">
		<NodeInspector nodes={[targetNode]} level={0} {includeChildren} />
	</div>
</div>

<style>
	.dashboard-node-widget-inspector-scroll {
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
	}

	.dashboard-node-widget-inspector-natural {
		display: block;
		inline-size: 100%;
		max-inline-size: 100%;
		min-inline-size: 0;
		min-block-size: 100%;
	}

	.dashboard-node-widget-inspector-natural :global(.node-inspector.root) {
		inline-size: 100%;
		max-inline-size: 100%;
		min-inline-size: 0;
	}
</style>