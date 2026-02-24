<script lang="ts">
	import { onDestroy } from 'svelte';
	import Slider from '$lib/golden_ui/components/common/Slider.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived(
		param && (param.value.kind === 'vec2' || param.value.kind === 'vec3') ? param.value.value : []
	);

	let draftValue = $state<number[]>([]);
	let isEditing = $state(false);
	let editSession = createUiEditSession('Edit vector', 'param-vector');

	
	$effect(() => {
		if (isEditing) {
			return;
		}
		draftValue = [...value];
	});

	onDestroy(() => {
		void editSession.end();
	});

	const startEdit = (): void => {
		if (readOnly || !enabled) {
			return;
		}
		isEditing = true;
		void editSession.begin();
	};

	const endEdit = (): void => {
		if (!isEditing) {
			return;
		}
		isEditing = false;
		void editSession.end();
	};

	const commitValue = (nextValue: number, index: number): void => {
		if (!param || readOnly || !enabled) {
			return;
		}
		if (param.value.kind !== 'vec2' && param.value.kind !== 'vec3') {
			return;
		}
		if (!Number.isFinite(nextValue)) {
			return;
		}

		const next = [...draftValue];
		next[index] = nextValue;
		draftValue = next;

		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: param.value.kind, value: next as [number, number] | [number, number, number] },
			param.event_behaviour
		);
	};
</script>

<div class="multi-number-editor">
	{#if draftValue.length > 0}
		{#each draftValue as item, index}
			<div class="single-number-editor">
				<Slider
					value={draftValue[index]}
					min={param?.constraints.min}
					max={param?.constraints.max}
					step={param?.constraints.step}
					stepBase={param?.constraints.step_base}
					{readOnly}
					disabled={!enabled}
					onValueChange={(nextValue: number) => commitValue(nextValue, index)}
					onStartEdit={startEdit}
					onEndEdit={endEdit} />
				<input
					type="text"
					class="number-field"
					disabled={!enabled}
					class:readonly={readOnly}
					value={item.toFixed(2)}
					onchange={(event) => {
						const nextValue = Number((event.target as HTMLInputElement).value);
						if (Number.isFinite(nextValue)) {
							commitValue(nextValue, index);
						}
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							const nextValue = Number((event.target as HTMLInputElement).value);
							if (Number.isFinite(nextValue)) {
								commitValue(nextValue, index);
							}
							(event.target as HTMLInputElement).blur();
						} else if (event.key === 'Escape') {
							const reverted = [...draftValue];
							reverted[index] = value[index] ?? 0;
							draftValue = reverted;
							(event.target as HTMLInputElement).blur();
						}
					}} />
			</div>
		{/each}
	{:else}
		<span class="empty">No values</span>
	{/if}
</div>

<style>
	.multi-number-editor {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.single-number-editor {
		display: flex;
		justify-content: right;
		gap: 0.25rem;
	}

	.number-field {
		height: 1.2rem;
		width: 30%;
	}
</style>
