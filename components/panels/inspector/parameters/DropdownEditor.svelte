<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node, layoutMode = 'default' } = $props<{
		node: UiNodeDto;
		layoutMode?: 'default' | 'widget';
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived(param?.value.kind === 'enum' ? param.value.value : '');
	let options = $derived(param?.constraints.enum_options ?? []);

	let draftValue = $state('');
	let editSession = createUiEditSession('Select option', 'param-enum');

	$effect(() => {
		draftValue = value;
	});

	const updateValue = async (nextValue: string): Promise<void> => {
		if (!param || param.value.kind !== 'enum' || readOnly || !enabled) {
			return;
		}
		draftValue = nextValue;
		await editSession.begin();
		try {
			await sendSetParamIntent(
				liveNode.node_id,
				{ kind: 'enum', value: nextValue },
				param.event_behaviour
			);
		} finally {
			await editSession.end();
		}
	};
</script>

<select
	class="dropdown-editor"
	class:widget-layout={layoutMode === 'widget'}
	value={draftValue}
	disabled={!enabled}
	class:readonly={readOnly}
	onchange={(event) => {
		void updateValue((event.target as HTMLSelectElement).value);
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

	.dropdown-editor.widget-layout {
		inline-size: 100%;
		block-size: 100%;
	}
</style>
