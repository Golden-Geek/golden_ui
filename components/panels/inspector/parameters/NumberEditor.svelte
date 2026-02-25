<script lang="ts">
	import { onDestroy } from 'svelte';
	import Slider from '../../../common/Slider.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let constraints = $derived(param?.constraints);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);

	let kind = $derived(param?.value.kind ?? 'float');
	let isInteger = $derived(kind === 'int');
	let value = $derived(
		param && (param.value.kind === 'int' || param.value.kind === 'float') ? param.value.value : 0
	);

	let min = $derived(
		constraints?.range?.kind === 'uniform' ? constraints.range.min : undefined
	);
	let max = $derived(
		constraints?.range?.kind === 'uniform' ? constraints.range.max : undefined
	);
	let step = $derived(constraints?.step);
	let stepBase = $derived(constraints?.step_base);
	let hasRange = $derived(min !== undefined && max !== undefined);

	let numberInput = $state(null as HTMLInputElement | null);
	let draftValue = $state(0);
	let isEditing = $state(false);
	let editSession = createUiEditSession('Edit number', 'param-number');
	const NUMERIC_EPSILON = 1e-9;

	$effect(() => {
		if (isEditing) {
			return;
		}
		draftValue = value;
	});

	onDestroy(() => {
		void editSession.end();
	});

	const normalizeValue = (candidate: number): number | null => {
		let nextValue = candidate;
		if (!Number.isFinite(nextValue)) {
			return null;
		}
		const policy = constraints?.policy ?? 'ClampAdapt';
		if (min !== undefined && max !== undefined && min > max) {
			return null;
		}

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

		if (step !== undefined) {
			if (step <= 0) {
				return null;
			}
			const base = stepBase ?? min ?? 0;
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

		if (isInteger) {
			const rounded = Math.round(nextValue);
			if (policy === 'Reject' && Math.abs(nextValue - rounded) > NUMERIC_EPSILON) {
				return null;
			}
			nextValue = Math.round(nextValue);
		}
		return nextValue;
	};

	const commitValue = (candidate: number): void => {
		if (!param || readOnly || !enabled) {
			return;
		}
		if (param.value.kind !== 'int' && param.value.kind !== 'float') {
			return;
		}
		const nextValue = normalizeValue(candidate);
		if (nextValue === null) {
			return;
		}
		if (Math.abs(nextValue - value) <= NUMERIC_EPSILON) {
			draftValue = nextValue;
			return;
		}
		draftValue = nextValue;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: param.value.kind, value: nextValue },
			param.event_behaviour
		);
	};

	function setValueFromField(): void {
		if (!numberInput) {
			return;
		}
		const parsedValue = Number(numberInput.value);
		if (Number.isFinite(parsedValue)) {
			commitValue(parsedValue);
		} else {
			numberInput.value = draftValue.toFixed(isInteger ? 0 : 3);
		}
	}

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
</script>

<div class="number-property-container" class:infinite={!hasRange}>
	<div class="slider-wrapper">
		<Slider
			bind:value={draftValue}
			{min}
			{max}
			{step}
			{stepBase}
			{readOnly}
			disabled={!enabled}
			onValueChange={(nextValue: number) => {
				commitValue(nextValue);
			}}
			onStartEdit={startEdit}
			onEndEdit={endEdit} />
	</div>

	<input
		bind:this={numberInput}
		type="number"
		step={isInteger ? 1 : 0.01}
		class="number-field"
		disabled={!enabled}
		class:readonly={readOnly}
		value={draftValue.toFixed(isInteger ? 0 : 3)}
		onblur={setValueFromField}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				numberInput?.blur();
			} else if (event.key === 'Escape') {
				if (numberInput) {
					numberInput.value = value.toFixed(isInteger ? 0 : 3);
					numberInput.blur();
				}
			}
		}} />
</div>

<style>
	.slider-wrapper {
		display: flex;
		flex-grow: 1;
		justify-content: right;
		height: 70%;
	}

	.number-property-container {
		display: flex;
		align-items: center;
		justify-content: right;
		gap: 0.25rem;
		width: 100%;
		height: 1.2rem;
	}

	.number-field {
		height: 100%;
		box-sizing: border-box;
		max-width: 4rem;
		margin-left: 0.25rem;
		width: 40%;
	}

	.infinite .number-field {
		width: 100%;
	}

	input::-webkit-outer-spin-button,
	input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
