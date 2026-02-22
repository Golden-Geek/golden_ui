<script lang="ts">
	import type { UiNodeDto, UiNodeMetaDto, UiParamDto } from '../../../types';
	import { appState } from '../../../store/workbench.svelte';
	import { sendPatchMetaIntent, sendSetParamIntent } from '../../../store/ui-intents';
	import EnableButton from '../../common/EnableButton.svelte';
	import NodeWarningBadge from '../../common/NodeWarningBadge.svelte';
	import { propertiesInspectorClass } from './inspector.svelte';
	import resetIcon from '../../../style/icons/reset.svg';
	import { fade } from 'svelte/transition';

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
	let readOnly = $derived(Boolean(param?.read_only));
	let isUserMade = $derived(meta.tags.includes('is_user_made'));
	let warnings = $derived(node ? session?.getNodeVisibleWarnings(liveNode.node_id) : null);
	let editorInfos: any = $derived(
		type.length > 0 ? (propertiesInspectorClass[type] ?? null) : null
	);
	let EditorComponent = $derived(editorInfos ? editorInfos.component : null);
	let isValueOverridden = $derived.by((): boolean => {
		if (!param) {
			return false;
		}
		return !paramValuesEqual(param.value, param.default_value);
	});

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

	function paramValuesEqual(left: UiParamDto['value'], right: UiParamDto['value']): boolean {
		if (left.kind !== right.kind) {
			return false;
		}
		switch (left.kind) {
			case 'trigger':
				return true;
			case 'int':
			case 'float':
			case 'str':
			case 'enum':
			case 'bool':
				return left.value === (right as typeof left).value;
			case 'vec2':
				return (
					left.value[0] === (right as typeof left).value[0] &&
					left.value[1] === (right as typeof left).value[1]
				);
			case 'vec3':
				return (
					left.value[0] === (right as typeof left).value[0] &&
					left.value[1] === (right as typeof left).value[1] &&
					left.value[2] === (right as typeof left).value[2]
				);
			case 'color':
				return (
					left.value[0] === (right as typeof left).value[0] &&
					left.value[1] === (right as typeof left).value[1] &&
					left.value[2] === (right as typeof left).value[2] &&
					left.value[3] === (right as typeof left).value[3]
				);
			case 'reference':
				return left.uuid === (right as typeof left).uuid;
		}
	}

	const resetValue = (): void => {
		if (!param || readOnly || !enabled || !isValueOverridden) {
			return;
		}
		void sendSetParamIntent(liveNode.node_id, param.default_value, param.event_behaviour);
	};
</script>

{#if visible}
	<div
		class="parameter-inspector {order} {'level-' + level} 
		{readOnly ? 'readonly' : ''}">
		{#if param}
			<div class="firstline">
				<div class="parameter-info">
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
						<span class="parameter-label">{liveNode.meta.label}</span>
					{/if}
					<NodeWarningBadge {warnings} />
					{#if !readOnly && enabled && isValueOverridden}
						<button
							type="button"
							class="reset-value"
							aria-label="Reset parameter value"
							title="Reset to default value"
							onclick={resetValue}
							transition:fade={{ duration: 100 }}>
							<img src={resetIcon} alt="Reset Value" />
						</button>
					{/if}
				</div>
				{#if EditorComponent}
					<div class="parameter-wrapper {readOnly ? 'readonly' : ''} {enabled ? '' : 'disabled'}">
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
		overflow: visible;
		padding-right: 0.25rem;
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

	.parameter-wrapper {
		display: flex;
		align-items: center;
		justify-content: right;
		flex-basis: 50%;
	}

	.parameter-wrapper.readonly, .parameter-wrapper.disabled {
		pointer-events: none;
		touch-action: none;
	}

	.parameter-inspector.single {
		padding: 0.1rem 0.3rem 0.2rem 0;
		border-bottom: solid 1px rgb(from var(--border-color) r g b / 5%);
		min-height: 1.5rem;
	}

	.parameter-info {
		display: flex;
		align-items: center;
		min-width: max-content;
		gap: 0.25rem;
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

	.reset-value {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.7rem;
		color: var(--text-color);
		padding: 0;
		opacity: 0.55;
		transition: opacity 0.2s;
		height: 0.8rem;
	}

	.reset-value img {
		height: 100%;
	}

	.reset-value:hover {
		opacity: 1;
	}
</style>
