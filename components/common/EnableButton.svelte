<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let enabled = $derived(liveNode.meta.enabled);
	let canBeDisabled = $derived(liveNode.meta.can_be_disabled);

	const toggleEnabled = (): void => {
		if (!canBeDisabled) {
			return;
		}
		void sendPatchMetaIntent(liveNode.node_id, { enabled: !enabled });
	};
</script>

<button
	type="button"
	class="enable-button"
	role="switch"
	aria-label="Toggle node enabled"
	aria-checked={enabled}
	disabled={!canBeDisabled}
	class:enabled
	tabindex="0"
	onclick={toggleEnabled}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggleEnabled();
		}
	}}></button>

<style>
	.enable-button {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 2rem;
		display: inline-block;
		background-color: rgba(50, 50, 50, 0.5);
		cursor: pointer;
		vertical-align: text-top;
		transition:
			background-color 0.2s ease,
			box-shadow 0.2s ease;
		border: none;
		padding: 0;
	}

	.enable-button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.enable-button.enabled {
		background-color: var(--gc-color-node-enabled);
		box-shadow: 0 0 0.3rem var(--gc-color-node-enabled);
	}
</style>
