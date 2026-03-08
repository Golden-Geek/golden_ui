<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node, layoutMode = 'default' } = $props<{
		node: UiNodeDto;
		layoutMode?: 'default' | 'widget';
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let enabled = $derived(liveNode.meta.enabled);
	let readOnly = $derived(Boolean(param?.read_only));
	let value = $derived(param?.value.kind === 'bool' ? param.value.value : false);

	let draftValue = $state(false);

	$effect(() => {
		draftValue = value;
	});

	const updateValue = (nextValue: boolean): void => {
		if (!param || param.value.kind !== 'bool' || readOnly) {
			return;
		}
		draftValue = nextValue;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'bool', value: nextValue },
			param.event_behaviour
		);
	};
</script>

<div class="editor-checkbox-shell" class:widget-layout={layoutMode === 'widget'}>
	<input
		type="checkbox"
		class="editor-checkbox"
		disabled={!enabled}
		class:readonly={readOnly}
		class:widget-layout={layoutMode === 'widget'}
		checked={draftValue}
		onchange={(event) => {
			updateValue((event.target as HTMLInputElement).checked);
		}} />
</div>

<style>
	.editor-checkbox-shell {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 100%;
	}

	.editor-checkbox-shell.widget-layout {
		block-size: 100%;
		padding: 0.4rem;
	}

	.editor-checkbox.widget-layout {
		inline-size: min(100%, 4rem);
		block-size: min(100%, 4rem);
		aspect-ratio: 1;
	}
</style>
