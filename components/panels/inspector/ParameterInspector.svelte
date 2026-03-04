<script lang="ts">
	import type {
		UiNodeDto,
		UiNodeMetaDto,
		UiParamControlInfo,
		UiParamDto,
		UiParamValueProjection,
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
	let controlInfo = $state<UiParamControlInfo | null>(null);
	let controlInfoLoading = $state(false);
	let controlInfoRequestSeq = 0;
	let graphNodesById = $derived(session?.graph.state.nodesById ?? null);
	const controlModeOptions: ReadonlyArray<{ mode: UiParameterControlMode; label: string }> = [
		{ mode: 'manual', label: 'Manual' },
		{ mode: 'contextLink', label: 'Context Link' },
		{ mode: 'templateText', label: 'Template' },
		{ mode: 'expression', label: 'Expression' },
		{ mode: 'link', label: 'Link' },
		{ mode: 'animation', label: 'Animation' }
	];
	let availableControlModes = $derived.by((): Set<UiParameterControlMode> => {
		if (controlInfo && controlInfo.param === liveNode.node_id) {
			return new Set(controlInfo.available_modes);
		}

		const fallback = new Set(controlModeOptions.map((option) => option.mode));
		if (type !== 'str') {
			fallback.delete('templateText');
		}
		return fallback;
	});
	let hasCompatibleContextCandidates = $derived.by((): boolean => {
		if (!controlInfo || controlInfo.param !== liveNode.node_id) {
			return true;
		}
		return controlInfo.context_candidates.some((candidate) => candidate.compatible);
	});
	let controlDiagnostics = $derived(param?.control?.diagnostics ?? []);
	let activeContextSymbol = $derived.by((): string => {
		if (
			!param ||
			param.control.mode !== 'contextLink' ||
			param.control.spec.mode !== 'contextLink'
		) {
			return '';
		}
		return param.control.spec.symbol.trim();
	});
	let activeContextProjection = $derived.by((): UiParamValueProjection | undefined => {
		if (
			!param ||
			param.control.mode !== 'contextLink' ||
			param.control.spec.mode !== 'contextLink'
		) {
			return undefined;
		}
		return param.control.spec.projection;
	});
	let contextSymbolDraft = $state('');
	let contextSearchDraft = $state('');
	let contextProjectionDraft = $state<UiParamValueProjection | undefined>(undefined);
	let contextCandidates = $derived.by(() => {
		if (!controlInfo || controlInfo.param !== liveNode.node_id) {
			return [];
		}
		const nodesById = graphNodesById;
		return controlInfo.context_candidates.map((candidate) => ({
			...candidate,
			scope_label:
				nodesById?.get(candidate.scope_owner)?.meta.label ?? `Node ${candidate.scope_owner}`,
			entry_label:
				nodesById?.get(candidate.entry_param)?.meta.label ?? `Node ${candidate.entry_param}`
		}));
	});
	let compatibleContextCount = $derived(
		contextCandidates.filter((candidate) => candidate.compatible).length
	);
	let filteredContextCandidates = $derived.by(() => {
		const query = contextSearchDraft.trim().toLowerCase();
		if (query.length === 0) {
			return contextCandidates;
		}
		return contextCandidates.filter(
			(candidate) =>
				candidate.symbol.toLowerCase().includes(query) ||
				candidate.value_type.toLowerCase().includes(query) ||
				candidate.scope_label.toLowerCase().includes(query) ||
				candidate.entry_label.toLowerCase().includes(query)
		);
	});
	let activeContextCandidate = $derived.by(() => {
		if (activeContextSymbol.length === 0) {
			return null;
		}
		return (
			contextCandidates.find(
				(candidate) => candidate.symbol === activeContextSymbol && !candidate.shadowed
			) ?? contextCandidates.find((candidate) => candidate.symbol === activeContextSymbol) ?? null
		);
	});
	let activeContextProjectionOptions = $derived.by((): UiParamValueProjection[] => {
		if (activeContextSymbol.length === 0) {
			return [];
		}
		const options = new Set<UiParamValueProjection>();
		for (const candidate of contextCandidates) {
			if (candidate.symbol !== activeContextSymbol) {
				continue;
			}
			for (const projection of candidate.projections) {
				options.add(projection);
			}
		}
		return [...options];
	});

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
					return (
						left.uuid === (right as typeof left).uuid &&
						left.projection === (right as typeof left).projection
					);
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
				return { mode: 'contextLink', symbol: '', projection: undefined };
			case 'templateText':
				return { mode: 'templateText', template: '' };
			case 'expression':
				return { mode: 'expression', expression: '' };
			case 'link':
				return { mode: 'link' };
			case 'animation':
				return { mode: 'animation' };
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

	function isControlModeDisabled(mode: UiParameterControlMode): boolean {
		if (!canEditControl) {
			return true;
		}
		if (!availableControlModes.has(mode)) {
			return true;
		}
		if (mode === 'contextLink') {
			if (controlInfoLoading) {
				return true;
			}
			if (!hasCompatibleContextCandidates) {
				return true;
			}
		}
		return false;
	}

	const applyControlMode = async (mode: UiParameterControlMode): Promise<void> => {
		if (!param || isControlModeDisabled(mode)) {
			return;
		}
		const nextState = stateForMode(mode);
		await sendSetParamControlStateIntent(liveNode.node_id, nextState);
		controlMenuOpen = false;
	};

	const projectionLabel = (projection: UiParamValueProjection): string => {
		switch (projection) {
			case 'floatToVec2X0':
				return 'Float -> Vec2 (v,0)';
			case 'floatToVec20Y':
				return 'Float -> Vec2 (0,v)';
			case 'floatToVec2XX':
				return 'Float -> Vec2 (v,v)';
			case 'floatToVec3X00':
				return 'Float -> Vec3 (v,0,0)';
			case 'floatToVec30Y0':
				return 'Float -> Vec3 (0,v,0)';
			case 'floatToVec300Z':
				return 'Float -> Vec3 (0,0,v)';
			case 'floatToVec3XXX':
				return 'Float -> Vec3 (v,v,v)';
			case 'vec2X':
				return 'Vec2 X';
			case 'vec2Y':
				return 'Vec2 Y';
			case 'vec2ToVec3XY0':
				return 'Vec2 -> Vec3 (X,Y,0)';
			case 'vec2ToVec3X0Y':
				return 'Vec2 -> Vec3 (X,0,Y)';
			case 'vec2ToColorHs':
				return 'Vec2 -> Color (Hue,Sat)';
			case 'vec3X':
				return 'Vec3 X';
			case 'vec3Y':
				return 'Vec3 Y';
			case 'vec3Z':
				return 'Vec3 Z';
			case 'vec3ToVec2XY':
				return 'Vec3 -> Vec2 (X,Y)';
			case 'vec3ToVec2XZ':
				return 'Vec3 -> Vec2 (X,Z)';
			case 'vec3ToVec2YZ':
				return 'Vec3 -> Vec2 (Y,Z)';
			case 'vec3ToColorRgb':
				return 'Vec3 -> Color (RGB)';
			case 'vec3ToColorHsv':
				return 'Vec3 -> Color (HSV)';
			case 'colorR':
				return 'Color R';
			case 'colorG':
				return 'Color G';
			case 'colorB':
				return 'Color B';
			case 'colorA':
				return 'Color A';
			case 'colorToVec3Rgb':
				return 'Color -> Vec3 (RGB)';
			case 'colorToVec3Hsv':
				return 'Color -> Vec3 (HSV)';
			case 'colorToVec2Hs':
				return 'Color -> Vec2 (Hue,Sat)';
		}
	};

	const applyContextLinkSymbol = async (
		symbol: string,
		projection: UiParamValueProjection | undefined = contextProjectionDraft
	): Promise<void> => {
		if (!param || !canEditControl || currentControlMode !== 'contextLink') {
			return;
		}
		const nextSymbol = symbol.trim();
		const nextProjection =
			projection === undefined ||
			contextCandidates.some(
				(candidate) =>
					candidate.symbol === nextSymbol && candidate.projections.includes(projection)
			)
				? projection
				: undefined;
		if (nextSymbol === activeContextSymbol && nextProjection === activeContextProjection) {
			contextSymbolDraft = activeContextSymbol;
			contextProjectionDraft = activeContextProjection;
			return;
		}
		contextSymbolDraft = nextSymbol;
		contextProjectionDraft = nextProjection;
		await sendSetParamControlStateIntent(liveNode.node_id, {
			mode: 'contextLink',
			spec: {
				mode: 'contextLink',
				symbol: nextSymbol,
				projection: nextProjection
			},
			diagnostics: []
		});
	};

	$effect(() => {
		contextSymbolDraft = activeContextSymbol;
		contextProjectionDraft = activeContextProjection;
	});

	$effect(() => {
		if (!param) {
			controlInfo = null;
			controlInfoLoading = false;
			controlInfoRequestSeq += 1;
			return;
		}
		if (controlInfo && controlInfo.param !== liveNode.node_id) {
			controlInfo = null;
		}
	});

	$effect(() => {
		if ((!controlMenuOpen && currentControlMode !== 'contextLink') || !param || !session) {
			return;
		}

		const requestedNodeId = liveNode.node_id;
		const requestSeq = ++controlInfoRequestSeq;
		controlInfoLoading = true;

		void session.client
			.paramControlInfo(requestedNodeId)
			.then((info) => {
				if (requestSeq !== controlInfoRequestSeq) {
					return;
				}
				controlInfo = info;
			})
			.catch(() => {
				if (requestSeq !== controlInfoRequestSeq) {
					return;
				}
				controlInfo = null;
			})
			.finally(() => {
				if (requestSeq !== controlInfoRequestSeq) {
					return;
				}
				controlInfoLoading = false;
			});
	});
</script>

{#if visible}
	<div
		class="parameter-inspector {order} {'level-' + level} 
		{readOnly ? 'readonly' : ''} {currentControlMode !== 'manual' ? 'controlled' : ''}"
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
											class="link-mode-option {option.mode === currentControlMode ? 'active' : ''} {isControlModeDisabled(option.mode) ? 'disabled' : ''}"
											disabled={isControlModeDisabled(option.mode)}
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

			{#if currentControlMode === 'contextLink'}
				<div class="context-link-editor">
					<div class="context-link-toolbar">
						<label class="context-link-symbol-field">
							<span class="context-link-field-label">Symbol</span>
							<input
								type="text"
								class="context-link-symbol-input"
								value={contextSymbolDraft}
								disabled={!canEditControl}
								placeholder="tempo"
								oninput={(event) => {
									contextSymbolDraft = (event.target as HTMLInputElement).value;
								}}
								onblur={() => {
									void applyContextLinkSymbol(contextSymbolDraft);
								}}
								onkeydown={(event) => {
									if (event.key === 'Enter') {
										void applyContextLinkSymbol(contextSymbolDraft);
										(event.target as HTMLInputElement).blur();
									}
									if (event.key === 'Escape') {
										contextSymbolDraft = activeContextSymbol;
										contextProjectionDraft = activeContextProjection;
										(event.target as HTMLInputElement).blur();
									}
								}} />
						</label>
						<label class="context-link-projection-field">
							<span class="context-link-field-label">Projection</span>
							<select
								class="context-link-projection-select"
								disabled={!canEditControl || activeContextProjectionOptions.length === 0}
								value={contextProjectionDraft ?? ''}
								onchange={(event) => {
									const value = (event.target as HTMLSelectElement).value;
									const nextProjection =
										value.length > 0 ? (value as UiParamValueProjection) : undefined;
									contextProjectionDraft = nextProjection;
									void applyContextLinkSymbol(contextSymbolDraft, nextProjection);
								}}>
								<option value="">Auto</option>
								{#each activeContextProjectionOptions as projection}
									<option value={projection}>{projectionLabel(projection)}</option>
								{/each}
							</select>
						</label>
						<input
							type="search"
							class="context-link-search"
							value={contextSearchDraft}
							placeholder="Filter"
							disabled={controlInfoLoading}
							oninput={(event) => {
								contextSearchDraft = (event.target as HTMLInputElement).value;
							}} />
					</div>

					{#if controlInfoLoading}
						<div class="context-link-status">Loading context candidates...</div>
					{:else if contextCandidates.length === 0}
						<div class="context-link-status warning">
							No context candidates were found for this parameter.
						</div>
					{:else}
						<div class="context-link-status">
							{compatibleContextCount} compatible / {contextCandidates.length} total
							{#if activeContextCandidate}
								<span class="context-link-active-candidate">
									Active: {activeContextCandidate.symbol} from
									{activeContextCandidate.scope_label}
								</span>
								{#if activeContextProjection}
									<span class="context-link-active-candidate">
										using {projectionLabel(activeContextProjection)}
									</span>
								{/if}
							{:else if activeContextSymbol.length > 0}
								<span class="context-link-active-candidate warning">
									Active symbol is not currently resolvable.
								</span>
							{/if}
						</div>

						{#if filteredContextCandidates.length > 0}
							<div class="context-link-candidates">
								{#each filteredContextCandidates as candidate (`${candidate.symbol}:${candidate.scope_owner}:${candidate.entry_param}`)}
									<button
										type="button"
										class="context-link-candidate
											{candidate.symbol === activeContextSymbol ? 'active' : ''}
											{candidate.compatible ? 'compatible' : 'incompatible'}
											{candidate.shadowed ? 'shadowed' : ''}"
										disabled={!canEditControl || !candidate.compatible}
										title={candidate.compatible
											? `Use '${candidate.symbol}' from ${candidate.scope_label}`
											: `Incompatible: ${candidate.value_type}`}
										onclick={() => {
											contextSymbolDraft = candidate.symbol;
											const nextProjection =
												contextProjectionDraft !== undefined &&
												candidate.projections.includes(contextProjectionDraft)
													? contextProjectionDraft
													: candidate.projections[0];
											void applyContextLinkSymbol(candidate.symbol, nextProjection);
										}}>
										<span class="symbol">{candidate.symbol}</span>
										<span class="meta">
											{candidate.value_type} {' | '} {candidate.entry_label} {' | '} scope
											{candidate.scope_label} {' | '} depth {candidate.lexical_depth}
										</span>
										{#if candidate.shadowed}
											<span class="badge shadowed">shadowed</span>
										{/if}
										{#if !candidate.compatible}
											<span class="badge incompatible">incompatible</span>
										{:else if candidate.projections.length > 0}
											<span class="badge projected">
												{candidate.projections.length} projections
											</span>
										{/if}
									</button>
								{/each}
							</div>
						{:else}
							<div class="context-link-status">No candidates match this filter.</div>
						{/if}
					{/if}

					{#if controlDiagnostics.length > 0}
						<div class="context-link-diagnostics">
							{#each controlDiagnostics as diagnostic (`${diagnostic.code}:${diagnostic.message}:${diagnostic.detail ?? ''}`)}
								<div class="context-link-diagnostic">
									<strong>{diagnostic.code}</strong>
									<span>{diagnostic.message}</span>
									{#if diagnostic.detail}
										<small>{diagnostic.detail}</small>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
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

	.parameter-inspector:not(.controlled):not(.last):not(.solo):not(.level-0) {
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

	.link-mode-option.disabled,
	.link-mode-option:disabled {
		cursor: default;
		opacity: 0.35;
	}

	.link-mode-option.disabled:hover,
	.link-mode-option:disabled:hover {
		background: transparent;
		opacity: 0.35;
	}

	.link-mode-option.active {
		background: rgba(from var(--text-color) r g b / 15%);
	}

	.context-link-editor {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.25rem 0.15rem 0 0.05rem;
		border-top: 0.0625rem solid rgba(from var(--text-color) r g b / 15%);
	}

	.context-link-toolbar {
		display: flex;
		align-items: flex-end;
		gap: 0.3rem;
	}

	.context-link-symbol-field {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		flex: 1;
		min-width: 0;
	}

	.context-link-projection-field {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		flex: 0 0 auto;
	}

	.context-link-field-label {
		font-size: 0.65rem;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.context-link-symbol-input,
	.context-link-search,
	.context-link-projection-select {
		height: 1.35rem;
		font-size: 0.72rem;
		padding: 0 0.35rem;
		box-sizing: border-box;
		min-width: 0;
	}

	.context-link-search {
		max-width: 8rem;
		flex: 0 0 35%;
	}

	.context-link-status {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		font-size: 0.65rem;
		opacity: 0.82;
	}

	.context-link-status.warning {
		color: var(--gc-color-warning);
	}

	.context-link-active-candidate {
		opacity: 0.85;
	}

	.context-link-active-candidate.warning {
		color: var(--gc-color-warning);
	}

	.context-link-candidates {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.2rem;
	}

	.context-link-candidate {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.08rem;
		padding: 0.22rem 0.3rem;
		border: 1px solid rgba(from var(--text-color) r g b / 12%);
		border-radius: 0.25rem;
		background: rgba(from var(--text-color) r g b / 2%);
		cursor: pointer;
		text-align: left;
		color: var(--text-color);
		min-width: 0;
	}

	.context-link-candidate .symbol {
		font-weight: 600;
		font-size: 0.72rem;
	}

	.context-link-candidate .meta {
		font-size: 0.62rem;
		opacity: 0.7;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.context-link-candidate:hover:not(:disabled) {
		background: rgba(from var(--text-color) r g b / 10%);
	}

	.context-link-candidate.active {
		border-color: rgba(from var(--gc-color-success) r g b / 65%);
		background: rgba(from var(--gc-color-success) r g b / 10%);
	}

	.context-link-candidate.shadowed {
		border-style: dashed;
	}

	.context-link-candidate.incompatible,
	.context-link-candidate:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.context-link-candidate.incompatible:hover,
	.context-link-candidate:disabled:hover {
		background: rgba(from var(--text-color) r g b / 2%);
	}

	.context-link-candidate .badge {
		font-size: 0.58rem;
		line-height: 1;
		padding: 0.1rem 0.24rem;
		border-radius: 0.35rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.context-link-candidate .badge.shadowed {
		color: rgba(from var(--text-color) r g b / 80%);
		background: rgba(from var(--text-color) r g b / 15%);
	}

	.context-link-candidate .badge.incompatible {
		color: rgb(from var(--gc-color-warning) r g b / 90%);
		background: rgb(from var(--gc-color-warning) r g b / 18%);
	}

	.context-link-candidate .badge.projected {
		color: rgb(from var(--gc-color-success) r g b / 90%);
		background: rgb(from var(--gc-color-success) r g b / 18%);
	}

	.context-link-diagnostics {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.2rem 0.25rem;
		border-radius: 0.25rem;
		background: rgba(from var(--gc-color-warning) r g b / 10%);
	}

	.context-link-diagnostic {
		display: flex;
		flex-direction: column;
		gap: 0.04rem;
		font-size: 0.66rem;
		color: rgb(from var(--gc-color-warning) r g b / 95%);
	}

	.context-link-diagnostic small {
		opacity: 0.8;
	}
</style>
