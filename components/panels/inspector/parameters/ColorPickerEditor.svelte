<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import ColorPicker from '../../../common/ColorPicker.svelte';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let enabled = $derived(node.meta.enabled);
	let value = $derived(node.data.param.value.value);

	let newColor = $state(value);

	let startEdit = () => {
		if (readOnly) return;
	};

	let updateValue = (newValue: any) => {
		newColor = newValue;
	};

	let endEdit = () => {
		if (readOnly) return;
	};

	// let { property = $bindable(), definition, onStartEdit = null, onUpdate = null } = $props();
</script>

<ColorPicker
	previewIsSwitch={enabled && !readOnly}
	bind:color={newColor}
	onchange={updateValue}
	onStartEdit={startEdit}
	onEndEdit={endEdit}></ColorPicker>

<style>
</style>
