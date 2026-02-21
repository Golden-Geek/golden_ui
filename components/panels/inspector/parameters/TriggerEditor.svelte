<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import parameterTriggerIcon from '../../../../style/icons/parameter/trigger.svg';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let triggerElem = $state(null as HTMLButtonElement | null);
	let hitTimeout: number | null = null;
	let isHit = $state(false);

	let hit = function () {
		isHit = true;
		if (hitTimeout !== null) {
			clearTimeout(hitTimeout);
		}

		hitTimeout = setTimeout(() => {
			isHit = false;
		}, 20);
	};
</script>

<button bind:this={triggerElem} class="trigger" class:active={isHit} onmousedown={hit}>
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
		transition: filter 0.2s;
		filter: brightness(100%);
		transition:
			filter 0.2s,
			background-color .2s,
			border-color .2s;
	}

	.trigger:hover {
		filter: brightness(120%);
	}

	.trigger.active {
		background: var(--gc-color-trigger-on);
		transition: filter 0.2s;
		border-color: hsl(from var(--gc-color-trigger-on) h s calc(l * 1.2)) !important;
	}

	.trigger img {
		padding: 0.25rem;
        width: .8rem;
        height: .8rem;
	}
</style>
