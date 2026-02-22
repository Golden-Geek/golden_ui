<script lang="ts">
	import type { PanelProps, PanelState } from '../../../dockview/panel-types';
	import { appState } from '../../../store/workbench.svelte';
	import type { NodeId } from '../../../types';

	const initialProps: PanelProps = $props();

	let panel = $state<PanelState>({
		panelId: initialProps.panelId,
		panelType: initialProps.panelType,
		title: initialProps.title,
		params: initialProps.params
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
	};

	let session = $derived(appState.session);
	let warnings = $derived(session?.getActiveWarnings() ?? []);

	let warningElems = $state<Record<string, HTMLElement>>({});
	let lastFlashedWarningKey = $state<string | null>(null);

	$effect(() => {
		if (typeof panel.params.sourceNodeId !== 'number') {
			lastFlashedWarningKey = null;
			return;
		}

		const warningId = typeof panel.params.warningId === 'string' ? panel.params.warningId : '';
		const warningKey = `${panel.params.sourceNodeId}:${warningId}`;
		if (warningKey === lastFlashedWarningKey) {
			return;
		}

		const warning = warnings.find(
			(w) => w.warningId === warningId && w.sourceNodeId === panel.params.sourceNodeId
		);
		if (!warning) {
			return;
		}

		flashWarning(warning);
		lastFlashedWarningKey = warningKey;
	});

	const flashWarning = (warning: { warningId: string; sourceNodeId: NodeId }): void => {
		const warningElement = warningElems[`${warning.sourceNodeId}:${warning.warningId}`];
		if (warningElement) {
			warningElement.classList.add('flashing');

			//focus on element
			warningElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

			setTimeout(() => {
				warningElement.classList.remove('flashing');
			}, 20);
		}
	};

	const warningIdLabel = (warningId: string): string => {
		return warningId.length > 0 ? warningId : 'default';
	};

	const selectNode = (nodeId: NodeId): void => {
		session?.selectNode(nodeId);
	};
</script>

<section class="warnings-panel">
	<header class="warnings-toolbar">
		<div class="warnings-stats">
			<strong>{warnings.length}</strong>
			<span>warnings</span>
		</div>
	</header>

	<div class="warnings-list">
		{#if warnings.length === 0}
			<div class="empty-state">No active warnings.</div>
		{:else}
			{#each warnings as warning (`${warning.sourceNodeId}:${warning.warningId}`)}
				<article
					bind:this={warningElems[`${warning.sourceNodeId}:${warning.warningId}`]}
					class="warning-item">
					<div class="warning-head">
						<button
							type="button"
							class="warning-node"
							onclick={() => selectNode(warning.sourceNodeId)}>
							{warning.sourceNodeLabel}
						</button>
						<span class="warning-id">{warningIdLabel(warning.warningId)}</span>
					</div>
					<p class="warning-message">{warning.message}</p>
					{#if warning.detail}
						<p class="warning-detail">{warning.detail}</p>
					{/if}
				</article>
			{/each}
		{/if}
	</div>
</section>

<style>
	.warnings-panel {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
	}

	.warnings-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-bottom: 0.0625rem solid
			color-mix(in srgb, var(--gc-color-panel-outline) 85%, transparent);
	}

	.warnings-stats {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-size: 0.75rem;
	}

	.warnings-list {
		flex: 1;
		min-block-size: 0;
		overflow: auto;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.empty-state {
		opacity: 0.7;
		font-size: 0.78rem;
	}

	.warning-item {
		padding: 0.4rem 0.5rem;
		border: 0.0625rem solid color-mix(in srgb, var(--gc-color-panel-outline) 70%, transparent);
		border-inline-start: 0.2rem solid color-mix(in srgb, #cf9b37 75%, white 25%);
		border-radius: 0.35rem;
		background: color-mix(in srgb, var(--gc-color-panel-row) 80%, black);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		transition: background-color 0.5s ease;
	}

	.warning-item:global(.flashing) {
		background-color: rgb(from var(--gc-color-warning) r g b / 30%);
		transition: none;
	}

	.warning-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.66rem;
	}

	.warning-node {
		border: 0;
		background: transparent;
		padding: 0;
		color: color-mix(in srgb, var(--gc-color-focus) 85%, white 15%);
		font-size: 0.7rem;
	}

	.warning-id {
		padding: 0.05rem 0.3rem;
		border-radius: 0.3rem;
		font-size: 0.62rem;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--gc-color-panel-alt) 85%, black);
		color: color-mix(in srgb, #cf9b37 85%, white 15%);
	}

	.warning-message {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.3;
		word-break: break-word;
	}

	.warning-detail {
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.3;
		opacity: 0.8;
		word-break: break-word;
	}
</style>
