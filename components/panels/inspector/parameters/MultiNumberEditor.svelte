<script lang="ts">
	import Slider from '$lib/golden_ui/components/common/Slider.svelte';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let value = $derived(node.data.param.value.value);
	let property = $derived(node.data.param);

	let tmpVal = $state($state.snapshot(value));

	let numValues = $derived(Array.isArray(value) ? value.length : 0);
	let hasRange = $derived(
		property.constraints &&
			property.constraints.min !== undefined &&
			property.constraints.max !== undefined
	);

	let updateValue = (newValue: any, index: number) => {
		console.log('Updating value to', newValue, 'at index', index);
		tmpVal[index] = newValue;
		return null;
		// to fill
	};
</script>

<div class="multi-number-editor">
	{#if numValues > 0}
		{#each value as val, index}
			<div class="single-number-editor">
				<Slider
					bind:value={tmpVal[index]}
					min={property.constraints.min}
					max={property.constraints.max}
					step={property.constraints.step}
					stepBase={property.constraints.step_base}
					{readOnly}
					onValueChange={(v: number) => updateValue(v, index)} />
				<input
					type="text"
					class="number-field"
					disabled={!node.meta.enabled}
					readonly={readOnly}
					value={tmpVal[index].toFixed(2)}
					onchange={(e) => {
						const elem = e.target as HTMLInputElement;
						const newValue = parseFloat(elem.value);
						if (!isNaN(newValue)) {
							updateValue(newValue, index);
						}
						elem.blur();
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							const elem = e.target as HTMLInputElement;
							const newValue = parseFloat(elem.value);
							if (!isNaN(newValue)) {
								updateValue(newValue, index);
							}
							elem.blur();
						} else if (e.key === 'Escape') {
							tmpVal[index] = value[index]; // Revert to original value
							const elem = e.target as HTMLInputElement;
							elem.value = tmpVal[index].toFixed(2);
							elem.blur();
						}
					}} />
				/>
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
