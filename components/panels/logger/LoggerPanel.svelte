<script lang="ts">
	import { onMount } from 'svelte';
	import type { NodeId } from '$lib/golden_ui/types';
	import {
		readPanelPersistedState,
		writePanelPersistedState
	} from '$lib/golden_ui/dockview/panel-persistence';
	import type { PanelProps, PanelState } from '../../../dockview/panel-types';
	import { appState } from '../../../store/workbench.svelte';
	import {
		sendClearLogsIntent,
		sendSetLogMaxEntriesIntent
	} from '../../../store/ui-intents';

	const initialProps: PanelProps = $props();
	const panelApi = initialProps.panelApi;

	let panel = $state<PanelState>({
		panelId: initialProps.panelId,
		panelType: initialProps.panelType,
		title: initialProps.title,
		params: initialProps.params
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
		restoreListScroll(next.params);
	};

	let session = $derived(appState.session);
	let records = $derived(session?.logRecords ?? []);
	let orderedRecords = $derived([...records].reverse());
	let recordEntries = $derived.by(() => {
		const seenByBaseKey = new Map<string, number>();
		return orderedRecords.map((record) => {
			const baseKey = `${record.id}:${record.timestamp_ms}:${record.level}:${record.tag}`;
			const seenCount = seenByBaseKey.get(baseKey) ?? 0;
			seenByBaseKey.set(baseKey, seenCount + 1);
			return {
				key: `${baseKey}:${seenCount}`,
				record
			};
		});
	});
	let maxEntries = $derived(session?.logMaxEntries ?? 0);
	let desiredMaxEntries = $state(128);
	let loggerList = $state<HTMLDivElement | null>(null);
	let listRestoreRaf = $state<number | null>(null);
	let listPersistRaf = $state<number | null>(null);

	interface LoggerPersistedState {
		listScrollTop?: number;
	}

	const normalizeScrollTop = (value: unknown): number | undefined => {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return undefined;
		}
		return Math.max(0, value);
	};

	const restoreListScroll = (params: PanelState['params']): void => {
		if (listRestoreRaf !== null) {
			cancelAnimationFrame(listRestoreRaf);
		}

		const persistedState = readPanelPersistedState<LoggerPersistedState>(params);
		const listScrollTop = normalizeScrollTop(persistedState.listScrollTop);
		if (listScrollTop === undefined) {
			listRestoreRaf = null;
			return;
		}

		listRestoreRaf = requestAnimationFrame(() => {
			listRestoreRaf = null;
			if (!loggerList) {
				return;
			}
			loggerList.scrollTop = listScrollTop;
		});
	};

	$effect(() => {
		if (maxEntries > 0) {
			desiredMaxEntries = maxEntries;
		}
	});

	const selectOrigin = (origin: NodeId | undefined): void => {
		if (origin === undefined || origin === null) {
			return;
		}
		session?.selectNode(origin);
	};

	const applyMaxEntries = (): void => {
		void sendSetLogMaxEntriesIntent(desiredMaxEntries);
	};

	const clearLogs = (): void => {
		void sendClearLogsIntent();
	};

	const persistListScroll = (): void => {
		if (listPersistRaf !== null) {
			return;
		}

		listPersistRaf = requestAnimationFrame(() => {
			listPersistRaf = null;
			if (!loggerList) {
				return;
			}
			writePanelPersistedState(panelApi, {
				listScrollTop: loggerList.scrollTop
			});
		});
	};

	const formatTimestamp = (timestampMs: number): string => {
		const date = new Date(timestampMs);
		return date.toLocaleTimeString([], {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	};

	$effect(() => {
		orderedRecords.length;
		restoreListScroll(panel.params);
	});

	onMount(() => {
		restoreListScroll(panel.params);
		return () => {
			if (listRestoreRaf !== null) {
				cancelAnimationFrame(listRestoreRaf);
			}
			if (listPersistRaf !== null) {
				cancelAnimationFrame(listPersistRaf);
			}
		};
	});
</script>

<section class="logger-panel">
	<header class="logger-toolbar">
		<div class="logger-stats">
			<strong>{records.length}</strong>
			<span>records</span>
		</div>
		<label class="max-input">
			<span>Max</span>
			<input
				type="number"
				min="1"
				step="1"
				bind:value={desiredMaxEntries}
				onchange={applyMaxEntries}
			/>
		</label>
		<button type="button" class="clear-button" onclick={clearLogs}>Clear</button>
	</header>

	<div class="logger-list" bind:this={loggerList} onscroll={persistListScroll}>
		{#if orderedRecords.length === 0}
			<div class="empty-state">No logs yet.</div>
		{:else}
			{#each recordEntries as entry (entry.key)}
				{@const record = entry.record}
				{@const nodeLabel = session?.graph.state.nodesById.get(record.origin ?? -1)?.meta.label ?? 'unknown node'}
				<article class={`record level-${record.level}`}>
					<div class="record-head">
						<span class="time">{formatTimestamp(record.timestamp_ms)}</span>
						<span class="level">{record.level}</span>
						<span class="tag">{record.tag}</span>
						{#if record.origin !== undefined}
							<button type="button" class="origin" onclick={() => selectOrigin(record.origin)}>
								{nodeLabel}
							</button>
						{/if}
					</div>
					<p class="message">{record.message}</p>
				</article>
			{/each}
		{/if}
	</div>
</section>

<style>
	.logger-panel {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
	}

	.logger-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-bottom: 0.0625rem solid color-mix(in srgb, var(--gc-color-panel-outline) 85%, transparent);
	}

	.logger-stats {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-size: 0.75rem;
	}

	.max-input {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
	}

	.max-input input {
		inline-size: 5rem;
		padding: 0.2rem 0.3rem;
		border: 0.0625rem solid var(--gc-color-panel-outline);
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--gc-color-panel-row) 80%, black);
		color: inherit;
	}

	.clear-button {
		margin-inline-start: auto;
		padding: 0.25rem 0.5rem;
		border: 0.0625rem solid color-mix(in srgb, var(--gc-color-focus) 45%, transparent);
		border-radius: 0.35rem;
		background: color-mix(in srgb, var(--gc-color-focus-muted) 72%, black);
		color: inherit;
		cursor: pointer;
	}

	.logger-list {
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

	.record {
		padding: 0.4rem 0.5rem;
		border: 0.0625rem solid color-mix(in srgb, var(--gc-color-panel-outline) 70%, transparent);
		border-radius: 0.35rem;
		background: color-mix(in srgb, var(--gc-color-panel-row) 80%, black);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.record-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.time {
		opacity: 0.75;
	}

	.level {
		font-weight: 600;
	}

	.tag {
		padding: 0.05rem 0.3rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--gc-color-panel-alt) 85%, black);
	}

	.origin {
		margin-inline-start: auto;
		border: 0;
		background: transparent;
		color: color-mix(in srgb, var(--gc-color-focus) 85%, white 15%);
		font-size: 0.66rem;
	}

	.message {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.3;
		word-break: break-word;
	}

	.level-info {
		border-inline-start: 0.2rem solid color-mix(in srgb, #3ca36b 75%, white 25%);
	}

	.level-warning {
		border-inline-start: 0.2rem solid color-mix(in srgb, #cf9b37 75%, white 25%);
	}

	.level-error {
		border-inline-start: 0.2rem solid color-mix(in srgb, #bf4d43 75%, white 25%);
	}
</style>
