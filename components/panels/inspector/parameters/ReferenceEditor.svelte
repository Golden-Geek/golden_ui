<script lang="ts">
	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let readOnly = $derived(node.meta.tags.includes('read_only') ?? false);
	let value = $derived(node.data.param.value.value);
</script>

<div class="reference-editor">
	{#if value}
		{value}
	{:else}
		<span class="empty">No reference</span>
	{/if}
</div>

<style>
</style>
