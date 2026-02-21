<script lang="ts">
	import type { UiNodeDto, UiParamDto } from '$lib/golden_ui/types';
	import Slider from '../../../common/Slider.svelte';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let meta = $derived(node.meta);
	let param = $derived(node.data.param);
	let constraints = $derived(param.constraints);
	let readOnly = $derived(meta.tags.includes('read_only') ?? false);
	let value = $derived(param.value.value ?? 0);
	let type = $derived(param.value.kind);

	let min = $derived(constraints.min);
	let max = $derived(constraints.max);
	let step = $derived(constraints.step);
	let stepBase = $derived(constraints.step_base);

	let hasRange = $derived(min !== undefined && max !== undefined);
	let isInteger = $derived(type == 'int');

	let numberInput = $state(null as HTMLInputElement | null);

	function setValueFromField() {
		const newValue = parseFloat(numberInput!.value);
		// console.log('Parsed value:', newValue);
		if (!isNaN(newValue)) {
			// onUpdate && onUpdate();
			startEdit();
			updateValue(newValue);
			endEdit();
		}
	}

	let startEdit = () => {
		if (readOnly) return;
	};

	let updateValue = (newValue: number) => {
		// console.log('Updating value to', newValue);
		return null;
		// to fill
	};

	let endEdit = () => {
		if (readOnly) return;
	};
</script>

<div class="number-property-container" class:infinite={!hasRange}>
	<div class="slider-wrapper">
		<Slider
			bind:value
			{min}
			{max}
			{step}
			{stepBase}
			{readOnly}
			disabled={!node.meta.enabled}
			onValueChange={(value: number) => {
				updateValue(value);
			}}
			onStartEdit={startEdit}
			onEndEdit={endEdit} />
	</div>

	<input
		bind:this={numberInput}
		type="number"
		step="0.01"
		class="number-field"
		disabled={readOnly}
		value={value.toFixed(isInteger ? 0 : 3)}
		onblur={setValueFromField}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				numberInput!.blur();
			} else if (e.key === 'Escape') {
				numberInput!.value = value.toFixed(isInteger ? 0 : 3);
				numberInput!.blur();
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

	/* .expression {
		font-style: italic;
		color: var(--expression-color);
	}

	.expression.error {
		color: var(--error-color);
	} */

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
		/* display: none; <- Crashes Chrome on hover */
		-webkit-appearance: none;
		margin: 0; /* <-- Apparently some margin are still there even though it's hidden */
	}
</style>
