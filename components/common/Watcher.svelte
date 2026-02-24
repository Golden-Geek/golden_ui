<script lang="ts">
	import type { UiNodeDto, UiParamDto } from '$lib/golden_ui/types';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { watcherVisualizerRegistry } from './watcher/watcher-registry';
	import { getFixedRange, type WatcherRangeMode } from './watcher/watcher-utils';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	const timeWindowOptionsSec = [2, 5, 10, 20, 40];

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived.by((): UiParamDto | null => {
		return liveNode.data.kind === 'parameter' ? liveNode.data.param : null;
	});
	let visualizer = $derived(param ? watcherVisualizerRegistry[param.value.kind] : null);
	let fixedRange = $derived(getFixedRange(param?.constraints));

	let timeWindowSec = $state(10);
	let rangeMode = $state<WatcherRangeMode>('adaptive');

	let timeWindowMs = $derived(timeWindowSec * 1000);
	let streamKey = $derived(param ? `${liveNode.node_id}:${param.value.kind}` : `${liveNode.node_id}:none`);

	$effect(() => {
		if (!visualizer?.supportsRangeMode && rangeMode !== 'adaptive') {
			rangeMode = 'adaptive';
		}
		if (rangeMode === 'fixed' && !fixedRange) {
			rangeMode = 'adaptive';
		}
	});
</script>

{#if param && visualizer}
	<section class="watcher-panel" data-visualizer={visualizer.id} data-kind={param.value.kind}>
		<header class="watcher-header">
			<div class="watcher-title">
				<strong>Watcher</strong>
				<span>{visualizer.label}</span>
			</div>

			<div class="watcher-controls">
				<div class="segmented" role="group" aria-label="Watcher time window">
					{#each timeWindowOptionsSec as optionSec}
						<button
							type="button"
							class:selected={timeWindowSec === optionSec}
							onclick={() => {
								timeWindowSec = optionSec;
							}}>
							{optionSec}s
						</button>
					{/each}
				</div>

				{#if visualizer.supportsRangeMode}
					<div class="segmented" role="group" aria-label="Watcher range mode">
						<button
							type="button"
							class:selected={rangeMode === 'adaptive'}
							onclick={() => {
								rangeMode = 'adaptive';
							}}>
							Adaptive
						</button>
						<button
							type="button"
							class:selected={rangeMode === 'fixed'}
							disabled={!fixedRange}
							title={fixedRange ? 'Use parameter min/max constraints' : 'No min/max constraints available'}
							onclick={() => {
								if (fixedRange) {
									rangeMode = 'fixed';
								}
							}}>
							Fixed
						</button>
					</div>
				{/if}
			</div>
		</header>

		<visualizer.component
			sampleValue={param.value}
			constraints={param.constraints}
			timeWindowMs={timeWindowMs}
			rangeMode={rangeMode}
			unit={param.ui_hints.unit ?? ''}
			{streamKey} />
	</section>
{/if}

<style>
	.watcher-panel {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.45rem;
		border-radius: 0.5rem;
		border: solid 0.06rem rgba(255 255 255 / 0.11);
		background: linear-gradient(180deg, rgba(255 255 255 / 0.07), rgba(255 255 255 / 0.03));
	}

	.watcher-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.watcher-title {
		display: inline-flex;
		flex-direction: column;
		line-height: 1.1;
		gap: 0.12rem;
		font-size: 0.68rem;
	}

	.watcher-title strong {
		font-size: 0.74rem;
		letter-spacing: 0.02em;
	}

	.watcher-title span {
		opacity: 0.72;
	}

	.watcher-controls {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
	}

	.segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.15rem;
		justify-content: flex-end;
	}

	.segmented button {
		font-size: 0.62rem;
		padding: 0.15rem 0.35rem;
		border-radius: 0.35rem;
		border: solid 0.06rem rgba(255 255 255 / 0.13);
		background: rgba(255 255 255 / 0.05);
		color: inherit;
		opacity: 0.8;
	}

	.segmented button:hover:not(:disabled) {
		opacity: 1;
		background: rgba(255 255 255 / 0.09);
	}

	.segmented button.selected {
		opacity: 1;
		border-color: rgba(130 225 255 / 0.55);
		background: rgba(130 225 255 / 0.18);
	}

	.segmented button:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
