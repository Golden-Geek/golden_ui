<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived(param?.value.kind === 'enum' ? param.value.value : '');
	let options = $derived(param?.constraints.enum_options ?? []);

	let draftValue = $state('');

	$effect(() => {
		draftValue = value;
	});

	const updateValue = (nextValue: string): void => {
		if (!param || param.value.kind !== 'enum' || readOnly || !enabled) {
			return;
		}
		draftValue = nextValue;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'enum', value: nextValue },
			param.event_behaviour
		);
	};
</script>

<select
	class="dropdown-editor"
	value={draftValue}
	disabled={!enabled}
	class:readonly={readOnly}
	onchange={(event) => {
		updateValue((event.target as HTMLSelectElement).value);
	}}>
	{#each options as { variant_id, label }}
		<option value={variant_id}>{label}</option>
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
