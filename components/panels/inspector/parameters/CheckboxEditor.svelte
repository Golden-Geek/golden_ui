<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let value = $derived(node.data.param.value.value);
	let property = $derived(node.data.param);
	let definition = $derived(node.meta.param_definition);

	let momentary = false;

	let updateValue = (newValue: boolean) => {
		console.log('Updating value to', newValue);
		return null;
		// to fill
	};
</script>

<input
	type="checkbox"
	class="editor-checkbox"
	disabled={!node.meta.enabled}
	readonly={readOnly}
	checked={value}
	onclick={(e) => {
		e.preventDefault();
	}}
	onmousedown={(e) => {
		e.preventDefault(); // Prevent focus change
		var elem = e.target as HTMLInputElement;
		let newValue = !elem.checked;
		elem.checked = newValue;
		updateValue(newValue);
	}}
	onmouseup={(e) => {
		e.preventDefault(); // Prevent focus change
		var elem = e.target as HTMLInputElement;
		if (momentary) {
			let newValue = !elem.checked;
			elem.checked = newValue;
			updateValue(newValue);
		}
	}} />

<style>
</style>
