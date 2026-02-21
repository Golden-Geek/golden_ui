<script lang="ts">
	import type { UiNodeDto } from '$lib/golden_ui/types';

	// let {
	// 	property = $bindable(),
	// 	definition,
	// 	expressionMode,
	// 	expressionResultTag,
	// 	onStartEdit = null,
	// 	onUpdate = null
	// } = $props();

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let value = $derived(node.data.param.value.value);

	let updateValue = () => {
		if (readOnly) return;
	};
</script>

<input
	type="text"
	class="string-editor	"
	{value}
	disabled={readOnly}
	onchange={(e) => {
		let newValue = (e.target as HTMLInputElement).value;
		// Apply filter function if defined
	}}
	onkeydown={(e) => {
		if (e.key === 'Enter') {
			updateValue();
			(e.target as HTMLInputElement).blur();
		}
	}} />

<style>
	.string-editor	{
		height: 100%;
		box-sizing: border-box;
		font-size: 0.75rem;
	}

	.string-editor:disabled {
		background-color: var(--inspector-input-disabled-bg);
		color: rgba(from var(--text-color) r g b / 50%);
	}
</style>
