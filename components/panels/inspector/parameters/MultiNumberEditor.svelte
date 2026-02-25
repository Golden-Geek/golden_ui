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
	const NUMERIC_EPSILON = 1e-9;

	
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
		const normalized = normalizeComponentValue(nextValue, index);
		if (normalized === null) {
			return;
		}
		if (Math.abs((value[index] ?? 0) - normalized) <= NUMERIC_EPSILON) {
			const next = [...draftValue];
			next[index] = normalized;
			draftValue = next;
			return;
		}

		const next = [...draftValue];
		next[index] = normalized;
		draftValue = next;

		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: param.value.kind, value: next as [number, number] | [number, number, number] },
			param.event_behaviour
		);
	};

	const componentMin = (index: number): number | undefined => {
		if (!param) {
			return undefined;
		}
		const range = param.constraints.range;
		if (!range) {
			return undefined;
		}
		if (range.kind === 'uniform') {
			return range.min;
		}
		if (range.kind === 'components') {
			return range.min?.[index];
		}
		return undefined;
	};

	const componentMax = (index: number): number | undefined => {
		if (!param) {
			return undefined;
		}
		const range = param.constraints.range;
		if (!range) {
			return undefined;
		}
		if (range.kind === 'uniform') {
			return range.max;
		}
		if (range.kind === 'components') {
			return range.max?.[index];
		}
		return undefined;
	};

	const normalizeComponentValue = (candidate: number, index: number): number | null => {
		if (!Number.isFinite(candidate)) {
			return null;
		}
		if (!param) {
			return null;
		}

		const min = componentMin(index);
		const max = componentMax(index);
		if (min !== undefined && max !== undefined && min > max) {
			return null;
		}

		const policy = param.constraints.policy ?? 'ClampAdapt';
		let nextValue = candidate;

		if (min !== undefined && nextValue < min) {
			if (policy === 'ClampAdapt') {
				nextValue = min;
			} else {
				return null;
			}
		}

		if (max !== undefined && nextValue > max) {
			if (policy === 'ClampAdapt') {
				nextValue = max;
			} else {
				return null;
			}
		}

		const step = param.constraints.step;
		if (step !== undefined) {
			if (step <= 0) {
				return null;
			}
			const base = param.constraints.step_base ?? min ?? 0;
			const scaled = (nextValue - base) / step;
			const nearest = Math.round(scaled);
			if (policy === 'ClampAdapt') {
				nextValue = base + nearest * step;
			} else if (Math.abs(scaled - nearest) > NUMERIC_EPSILON) {
				return null;
			}
		}

		if (policy === 'ClampAdapt') {
			if (min !== undefined) {
				nextValue = Math.max(min, nextValue);
			}
			if (max !== undefined) {
				nextValue = Math.min(max, nextValue);
			}
		}

		return nextValue;
	};
</script>

<div class="multi-number-editor">
	{#if draftValue.length > 0}
		{#each draftValue as item, index}
			<div class="single-number-editor">
				<div class="slider-wrapper">
					<Slider
						value={draftValue[index]}
						min={componentMin(index)}
						max={componentMax(index)}
						step={param?.constraints.step}
						stepBase={param?.constraints.step_base}
						{readOnly}
						disabled={!enabled}
						onValueChange={(nextValue: number) => commitValue(nextValue, index)}
						onStartEdit={startEdit}
						onEndEdit={endEdit} />
				</div>
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
		width: 100%;
	}

	.single-number-editor {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		height: 1.2rem;
	}

	.slider-wrapper {
		display: flex;
		flex: 1 1 auto;
		justify-content: right;
		min-width: 0;
		height: 70%;
	}

	.number-field {
		height: 100%;
		box-sizing: border-box;
		width: 30%;
	}
</style>
