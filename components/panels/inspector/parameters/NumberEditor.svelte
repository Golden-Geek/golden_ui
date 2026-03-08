<script lang="ts">
	import { onDestroy } from 'svelte';
	import Slider from '../../../common/Slider.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	interface NumberEditorPresentation {
		show_value_field?: boolean;
		max_decimals?: number;
	}

	let { node, layoutMode = 'default', presentation = {} } = $props<{
		node: UiNodeDto;
		layoutMode?: 'default' | 'widget';
		presentation?: NumberEditorPresentation;
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
	let showValueField = $derived(presentation.show_value_field !== false);
	let fractionDigits = $derived(isInteger ? 0 : Math.max(0, Math.min(8, Math.round(presentation.max_decimals ?? 3))));
	let fieldStep = $derived(
		isInteger ? 1 : fractionDigits <= 0 ? 1 : Number(`1e-${fractionDigits}`)
	);
	let formattedDraftValue = $derived(draftValue.toFixed(fractionDigits));
	let formattedValue = $derived(value.toFixed(fractionDigits));

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
			numberInput.value = formattedDraftValue;
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

<div class="number-property-container" class:infinite={!hasRange} class:widget-layout={layoutMode === 'widget'}>
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

	{#if showValueField}
		<input
			bind:this={numberInput}
			type="number"
			step={fieldStep}
			class="number-field"
			disabled={!enabled}
			class:readonly={readOnly}
			value={formattedDraftValue}
			onblur={setValueFromField}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					numberInput?.blur();
				} else if (event.key === 'Escape') {
					if (numberInput) {
						numberInput.value = formattedValue;
						numberInput.blur();
					}
				}
			}} />
	{/if}
</div>

<style>
	.slider-wrapper {
		display: flex;
		flex-grow: 1;
		justify-content: right;
		height: 70%;
		min-width: 0;
	}

	.number-property-container {
		display: flex;
		align-items: center;
		justify-content: right;
		gap: 0.25rem;
		width: 100%;
		height: 1.2rem;
	}

	.number-property-container.widget-layout {
		height: 100%;
		align-items: stretch;
		gap: 0.5rem;
	}

	.number-property-container.widget-layout .slider-wrapper {
		height: 100%;
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

	.number-property-container.widget-layout .number-field {
		width: clamp(4.5rem, 28%, 8rem);
		max-width: none;
		margin-left: 0;
	}

	input::-webkit-outer-spin-button,
	input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
