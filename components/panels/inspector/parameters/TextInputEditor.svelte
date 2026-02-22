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
	let value = $derived(param?.value.kind === 'str' ? param.value.value : '');

	let draftValue = $state('');

	$effect(() => {
		draftValue = value;
	});

	const commitValue = (nextValue: string): void => {
		if (!param || param.value.kind !== 'str' || readOnly || !enabled) {
			return;
		}
		if (nextValue === value) {
			return;
		}
		draftValue = nextValue;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'str', value: nextValue },
			param.event_behaviour
		);
	};
</script>

<input
	type="text"
	class="string-editor"
	value={draftValue}
	disabled={!enabled}
	class:readonly={readOnly}
	onchange={(event) => {
		const nextValue = (event.target as HTMLInputElement).value;
		commitValue(nextValue);
	}}
	onkeydown={(event) => {
		if (event.key === 'Enter') {
			const target = event.target as HTMLInputElement;
			commitValue(target.value);
			target.blur();
		}
		if (event.key === 'Escape') {
			draftValue = value;
			(event.target as HTMLInputElement).blur();
		}
	}} />

<style>
	.string-editor {
		height: 100%;
		box-sizing: border-box;
		font-size: 0.75rem;
	}

</style>
