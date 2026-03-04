<script lang="ts">
	import type {
		UiNodeDto,
		UiNodeMetaDto,
		UiParamDto,
		UiParameterControlMode,
		UiParameterControlSpec,
		UiParameterControlState
	} from '../../../types';
	import { appState } from '../../../store/workbench.svelte';
	import {
		sendPatchMetaIntent,
		sendSetParamControlStateIntent,
		sendSetParamIntent
	} from '../../../store/ui-intents';
	import EnableButton from '../../common/EnableButton.svelte';
	import NodeWarningBadge from '../../common/NodeWarningBadge.svelte';
	import { propertiesInspectorClass } from './inspector.svelte';
	import resetIcon from '../../../style/icons/reset.svg';
	import referenceIcon from '../../../style/icons/parameter/reference.svg';
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
	let isNameChangeable = $derived(Boolean(meta.user_permissions.can_edit_name));
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
	let currentControlMode: UiParameterControlMode = $derived(param?.control?.mode ?? 'manual');
	let canEditControl = $derived(Boolean(param && enabled && !readOnly));
	let controlMenuOpen = $state(false);
	const nilUuid = '00000000-0000-0000-0000-000000000000';
	const controlModeOptions: ReadonlyArray<{ mode: UiParameterControlMode; label: string }> = [
		{ mode: 'manual', label: 'Manual' },
		{ mode: 'contextLink', label: 'Context Link' },
		{ mode: 'templateText', label: 'Template' },
		{ mode: 'expression', label: 'Expression' },
		{ mode: 'proxy', label: 'Proxy' },
		{ mode: 'binding', label: 'Binding' },
		{ mode: 'animation', label: 'Animation' }
	];

	let renamingState = $state({
		isRenaming: false,
		renameDraft: ''
	});

	async function commitRename(): Promise<void> {
		if (!isNameChangeable) {
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
			case 'file':
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

	function defaultControlSpec(mode: UiParameterControlMode): UiParameterControlSpec {
		switch (mode) {
			case 'contextLink':
				return { mode: 'contextLink', symbol: '' };
			case 'templateText':
				return { mode: 'templateText', template: '' };
			case 'expression':
				return { mode: 'expression', expression: '' };
			case 'proxy':
				return { mode: 'proxy', target: { uuid: nilUuid } };
			case 'binding':
				return { mode: 'binding', target: { uuid: nilUuid } };
			case 'animation':
				return {
					mode: 'animation',
					animation: {
						waveform: 'sine',
						frequency_hz: 1,
						amplitude: 1,
						offset: 0,
						phase: 0
					}
				};
			case 'manual':
			default:
				return { mode: 'manual' };
		}
	}

	function stateForMode(mode: UiParameterControlMode): UiParameterControlState {
		const currentState = param?.control;
		if (currentState && currentState.mode === mode && currentState.spec.mode === mode) {
			return {
				mode,
				spec: currentState.spec,
				diagnostics: []
			};
		}
		return {
			mode,
			spec: defaultControlSpec(mode),
			diagnostics: []
		};
	}

	const applyControlMode = async (mode: UiParameterControlMode): Promise<void> => {
		if (!param || !canEditControl) {
			return;
		}
		const nextState = stateForMode(mode);
		await sendSetParamControlStateIntent(liveNode.node_id, nextState);
		controlMenuOpen = false;
	};
</script>

{#if visible}
	<div
		class="parameter-inspector {order} {'level-' + level} 
		{readOnly ? 'readonly' : ''}"
		class:control-menu-open={controlMenuOpen}
		data-node-id={liveNode.node_id}>
		{#if param}
			<div class="firstline">
				<div class="parameter-info">
					{#if canDisable}
						<EnableButton node={liveNode} />
					{/if}
					{#if isNameChangeable}
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
					<div class="parameter-controls">
						<div class="parameter-wrapper {readOnly ? 'readonly' : ''} {enabled ? '' : 'disabled'}">
							<EditorComponent node={liveNode} />
						</div>
						<div
							class="link-mode-menu"
							onfocusout={(event) => {
								const currentTarget = event.currentTarget as HTMLDivElement | null;
								const nextTarget = event.relatedTarget as Node | null;
								if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) {
									return;
								}
								controlMenuOpen = false;
							}}>
							<button
								type="button"
								class="link-mode-trigger {currentControlMode}"
								aria-label="Choose parameter control mode"
								title="Choose control mode"
								disabled={!canEditControl}
								onclick={() => {
									controlMenuOpen = !controlMenuOpen;
								}}>
								<img src={referenceIcon} alt="Link Mode" />
							</button>
							{#if controlMenuOpen}
								<div class="link-mode-dropdown">
									{#each controlModeOptions as option}
										<button
											type="button"
											class="link-mode-option {option.mode === currentControlMode ? 'active' : ''}"
											onclick={() => {
												void applyControlMode(option.mode);
											}}>
											{option.label}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			{#if currentControlMode != 'manual'}
				<div class="control-mode-line">
					<small>Control Mode: {currentControlMode}</small>
				</div>
			{/if}
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
		position: relative;
		z-index: 0;
	}

	.parameter-inspector.control-menu-open {
		z-index: 30;
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
		flex: 1;
		max-width: 15rem;
	}

	.parameter-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		flex: 1;
	}

	.parameter-wrapper.readonly,
	.parameter-wrapper.disabled {
		pointer-events: none;
		touch-action: none;
	}

	.parameter-inspector.single {
		padding: 0.1rem 0.3rem 0.2rem 0;
		border-bottom: solid 1px rgb(255, 255, 255, 0.5);
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
		border: 1px solid rgba(255, 255, 255, 0.5);
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

	.link-mode-menu {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.parameter-inspector.control-menu-open .link-mode-menu {
		z-index: 40;
	}

	.link-mode-trigger {
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0.15rem;
		opacity: 0.72;
		transition:
			opacity 0.12s ease,
			border-color 0.12s ease;
	}

	.link-mode-trigger img {
		width: 100%;
		height: 100%;
	}

	.link-mode-trigger:hover:not(:disabled) {
		opacity: 1;
	}

	.link-mode-trigger:disabled {
		cursor: default;
		opacity: 0.35;
	}

	.link-mode-dropdown {
		position: absolute;
		top: 110%;
		right: 0;
		z-index: 50;
		min-width: 7rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.25rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.35rem;
		background: var(--gc-color-panel);
		box-shadow: 0 0.35rem 0.8rem rgba(0, 0, 0, 1);
	}

	.link-mode-option {
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-color);
		cursor: pointer;
		padding: 0.25rem 0.4rem;
		text-align: left;
		font-size: 0.74rem;
		opacity: 0.85;
	}

	.link-mode-option:hover {
		background: rgba(255, 255, 255, 0.5);
		opacity: 1;
	}

	.link-mode-option.active {
		background: rgba(from var(--text-color) r g b / 15%);
	}
</style>
