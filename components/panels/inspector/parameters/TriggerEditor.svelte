<script lang="ts">
	import parameterTriggerIcon from '../../../../style/icons/parameter/trigger.svg';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only) || liveNode.meta.tags.includes('read_only'));
	let enabled = $derived(liveNode.meta.enabled);

	let hitTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
	let isHit = $state(false);

	const hit = (): void => {
		isHit = true;
		if (hitTimeout !== null) {
			clearTimeout(hitTimeout);
		}

		hitTimeout = setTimeout(() => {
			isHit = false;
		}, 40);
	};

	const fireTrigger = (): void => {
		if (!param || param.value.kind !== 'trigger' || readOnly || !enabled) {
			return;
		}
		hit();
		void sendSetParamIntent(liveNode.node_id, { kind: 'trigger' }, param.event_behaviour);
	};
</script>

<button
	type="button"
	class="trigger"
	class:active={isHit}
	disabled={!enabled || readOnly}
	onclick={fireTrigger}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			fireTrigger();
		}
	}}>
	<img src={parameterTriggerIcon} alt="Trigger" />
</button>

<style>
	.trigger {
		color: var(--gc-color-text);
		background: var(--gc-color-trigger);
		border: solid 1px hsl(from var(--gc-color-trigger) h s calc(l * 1.2)) !important;
		border-radius: 0.5rem;
		padding: 0;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 1.2rem;
		box-sizing: border-box;
		filter: brightness(100%);
		transition:
			filter 0.2s,
			background-color 0.2s,
			border-color 0.2s,
			opacity 0.2s;
	}

	.trigger:hover {
		filter: brightness(120%);
	}

	.trigger:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.trigger.active {
		background: var(--gc-color-trigger-on);
		border-color: hsl(from var(--gc-color-trigger-on) h s calc(l * 1.2)) !important;
	}

	.trigger img {
		padding: 0.25rem;
		width: 0.8rem;
		height: 0.8rem;
	}
</style>
