<script lang="ts">
	import type { UiNodeDto, UiNodeMetaDto, UiParamDto } from '$lib/golden_ui/types';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import EnableButton from '../../common/EnableButton.svelte';
	import { propertiesInspectorClass } from './inspector.svelte';

	let { node, level, order } = $props<{
		node: UiNodeDto;
		level: number;
		order: 'first' | 'last' | 'solo' | '';
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);

	let param: UiParamDto | null = $derived(
		liveNode.data.kind === 'parameter' ? liveNode.data.param : null
	);
	let meta: UiNodeMetaDto = $derived(liveNode.meta);
	let type: string = $derived(param?.value.kind ?? '');
	let canDisable = $derived(meta.can_be_disabled ?? false);
	let enabled = $derived(meta.enabled ?? true);
	let visible = $derived(!meta.tags.includes('hidden'));
	let readOnly = $derived(Boolean(param?.read_only) || meta.tags.includes('read_only'));
	let isUserMade = $derived(meta.tags.includes('is_user_made'));

	let editorInfos: any = $derived(type.length > 0 ? propertiesInspectorClass[type] ?? null : null);
	let EditorComponent = $derived(editorInfos ? editorInfos.component : null);

	let renamingState = $state({
		isRenaming: false,
		renameDraft: ''
	});

	async function commitRename(): Promise<void> {
		if (!isUserMade) {
			return;
		}
		const nextName = String(renamingState.renameDraft ?? '').trim();
		if (!nextName || nextName === liveNode.meta.label) {
			renamingState.isRenaming = false;
			return;
		}

		await sendPatchMetaIntent(liveNode.node_id, { label: nextName });
		renamingState.isRenaming = false;
	}
</script>

{#if visible}
	<div
		class="parameter-inspector {order} {'level-' + level} {enabled ? '' : 'disabled'}
		{readOnly ? 'readonly' : ''}">
		{#if param}
			<div class="firstline">
				<div class="parameter-label">
					{#if canDisable}
						<EnableButton node={liveNode} />
					{/if}
					{#if isUserMade}
						{#if renamingState.isRenaming}
							<input
								class="custom-prop-name"
								bind:value={renamingState.renameDraft}
								onblur={() => {
									void commitRename();
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										void commitRename();
									}
									if (e.key === 'Escape') {
										renamingState.isRenaming = false;
										renamingState.renameDraft = liveNode.meta.label;
									}
								}} />
						{:else}
							<span
								class="custom-prop-name-text"
								role="textbox"
								tabindex="-1"
								ondblclick={() => {
									renamingState.renameDraft = liveNode.meta.label;
									renamingState.isRenaming = true;
								}}
								title="Double-click to rename">
								{liveNode.meta.label}
							</span>
						{/if}
					{:else}
						{liveNode.meta.label}
					{/if}
				</div>

				{#if EditorComponent}
					<div class="parameter-wrapper {readOnly ? 'readonly' : ''}">
						<EditorComponent node={liveNode} />
					</div>
				{/if}
			</div>
		{:else}
			{liveNode.meta.label} has no parameter data.
		{/if}
	</div>
{/if}

<style>
	.parameter-inspector {
		width: 100%;
		display: flex;
		gap: 0.25rem;
		flex-direction: column;
		box-sizing: border-box;
		transition: opacity 0.2s ease;
		padding-left: 0.2rem;
		padding-bottom: 0.2rem;
		overflow: hidden;
	}

	.parameter-inspector:not(.last):not(.solo):not(.level-0) {
		border-bottom: solid 1px rgba(255, 255, 255, 0.05);
	}

	.parameter-inspector .firstline {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
	}

	.parameter-inspector.disabled,
	.parameter-inspector.readonly {
		opacity: 0.5;
		user-select: none;
		touch-action: none;
		pointer-events: none;
	}

	.parameter-wrapper {
		display: flex;
		align-items: center;
		justify-content: right;
		flex-basis: 50%;
	}

	.parameter-wrapper.readonly {
		opacity: 0.6;
		pointer-events: none;
		touch-action: none;
	}

	.parameter-inspector.single {
		padding: 0.1rem 0.3rem 0.2rem 0;
		border-bottom: solid 1px rgb(from var(--border-color) r g b / 5%);
		min-height: 1.5rem;
	}

	.parameter-label {
		display: flex;
		align-items: center;
		min-width: max-content;
	}

	.parameter-label.error {
		color: var(--error-color);
		font-weight: bold;
	}

	.enable-property {
		font-size: 0.5rem;
		padding: 0.2rem 0.2rem 0.1rem;
		vertical-align: middle;
		cursor: pointer;
		pointer-events: all;
	}

	.custom-prop-name-text {
		cursor: text;
	}

	.custom-prop-name {
		height: 1.5rem;
		background-color: var(--bg-color);
		color: var(--text-color);
		font-size: 0.8rem;
		border: 1px solid rgba(from var(--border-color) r g b / 20%);
		border-radius: 0.25rem;
		padding: 0 0.35rem;
	}
</style>
