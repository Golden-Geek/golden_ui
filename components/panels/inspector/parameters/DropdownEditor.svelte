<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let param = $derived(node.data.param);
	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let value = $derived(param.value.value);

	let options = $derived(param.constraints.enum_options);
	let updateValue = (newValue: any) => {
		console.log('Updating value to', newValue);
		return null;
		// to fill
	};
	$inspect(options, value);
</script>

<select
	class="dropdown-editor"
	{value}
	onchange={(event) => {
		let elem = event.target as HTMLSelectElement;
		let newValue = elem.value;
		// Apply filter function if defined
		updateValue(newValue);
		elem.blur();
	}}>
	{#each options as { variant_id, value, label }}
		<option value={variant_id} selected={variant_id === value}>{label}</option>
	{/each}
</select>

<style>
	.dropdown-editor {
		height: 100%;
		width: 100%;
		box-sizing: border-box;
		font-size: 0.75rem;
	}
</style>
