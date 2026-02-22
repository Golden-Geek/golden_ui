<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { showPanel } from '$lib/golden_ui/store/ui-panels';
	import type { NodeWarningRecord } from '$lib/golden_ui/store/workbench.svelte';

	let { warnings = [] } = $props<{
		warnings?: NodeWarningRecord[] | null;
	}>();

	let safeCount = $derived(Math.max(0, Math.floor(warnings?.length ?? 0)));
	let computedTitle = $derived(safeCount == 1 ? warnings[0].message : `${safeCount} warnings`);

	let showMessage = $state(false);

	function showWarningInPanel(): void {
		const warning = warnings?.[0];
		if (!warning) {
			return;
		}

		showPanel({
			panelType: 'warnings',
			panelId: 'warnings',
			params: {
				warningId: warning.warningId,
				targetNodeId: warning.targetNodeId,
				sourceNodeId: warning.sourceNodeId
			}
		});
	}
</script>

{#if safeCount > 0}
	<button
		transition:fade ={{ duration: 100 }}
		class="warning-badge"
		title={computedTitle}
		aria-label={computedTitle}
		tabindex="-1"
		onmouseenter={() => (showMessage = true)}
		onmouseleave={() => (showMessage = false)}
		onfocus={() => (showMessage = true)}
		onblur={() => (showMessage = false)}
		onclick={() => showWarningInPanel()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				showWarningInPanel();
			}
		}}>
		<div class="warning-wrapper">
			<div class="warning-icon"></div>

			{#if showMessage}
				<div class="warning-message" transition:slide={{ duration: 150, axis: 'x' }}>
					{computedTitle}
				</div>
			{/if}
		</div>
	</button>
{/if}

<style>
	.warning-badge {
		position: relative;
		display: inline-flex;
		align-items: center;
		font-size: 0.65rem;
		font-weight: 700;
		vertical-align: middle;
		min-width: 1.5rem;
		min-height: 1rem;
		cursor: pointer;
		color: var(--gc-color-warning);
	}

	.warning-wrapper {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		position: absolute;
		left: 0;
		transition: background-color 0.2s ease;
		background-color: rgb(from var(--gc-color-warning) r g b / 0%);
		padding: 0.1rem 0.3rem;
		border-radius: 0.45rem;
		gap: 0.2rem;
		z-index: 100;
	}

	.warning-badge:hover .warning-wrapper {
		background-color: hsl(from var(--gc-color-warning) h s calc(l * 0.4));
	}

	.warning-message {
		max-height: 100%;
		white-space: nowrap;
	}
</style>
