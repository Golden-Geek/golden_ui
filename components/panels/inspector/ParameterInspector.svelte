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
		createUiEditSession,
		sendPatchMetaIntent,
		sendSetParamControlStateIntent,
		sendSetParamIntent
	} from '../../../store/ui-intents';
	import EnableButton from '../../common/EnableButton.svelte';
	import ContextMenu from '../../common/ContextMenu.svelte';
	import NodeWarningBadge from '../../common/NodeWarningBadge.svelte';
	import type { ContextMenuAnchor, ContextMenuItem } from '../../common/context-menu';
	import { resolveParameterEditor } from './inspector.svelte';
	import { projectionLabel } from '../../../projection-labels';
	import resetIcon from '../../../style/icons/reset.svg';
	import referenceIcon from '../../../style/icons/parameter/reference.svg';
	import expressionIcon from '../../../style/icons/parameter/control/expression.svg';
	import proxyIcon from '../../../style/icons/parameter/control/proxy.svg';
	import bindingIcon from '../../../style/icons/parameter/control/binding.svg';
	import animationIcon from '../../../style/icons/parameter/control/animation.svg';
	import templateIcon from '../../../style/icons/parameter/string.svg';
	import manualIcon from '../../../style/icons/parameter/control/manual.svg';
	import contextIcon from '../../../style/icons/parameter/control/context.svg';
	import settingsIcon from '../../../style/icons/settings.svg';
	import { fade } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import Self from './ParameterInspector.svelte';
	import { beginDashboardParameterDrag } from '../dashboard/dashboard-drag';

	let {
		node,
		level,
		order,
		defaultChildren,
		controlNodeType = '',
		layoutMode = 'default'
	} = $props<{
		node: UiNodeDto;
		level: number;
		order: 'first' | 'last' | 'solo' | '';
		controlNodeType?: String;
		layoutMode?: 'default' | 'dashboard';
		defaultChildren?: Snippet<[String?]>;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let liveNodeId = $derived(liveNode.node_id);
	let isParameterNode = $derived(liveNode.data.kind === 'parameter');

	let isControlNode = $derived(controlNodeType != '');

	let param: UiParamDto | null = $derived(
		liveNode.data.kind === 'parameter' ? liveNode.data.param : null
	);
	let meta: UiNodeMetaDto = $derived(liveNode.meta);
	let type: string = $derived(param?.value.kind ?? '');
	let canDisable = $derived(meta.can_be_disabled ?? false);
	let showsEnableButton = $derived(
		canDisable && !(layoutMode === 'dashboard' && level === 0)
	);
	let enabled = $derived(meta.enabled ?? true);
	let visible = $derived(!meta.tags.includes('hidden'));
	let readOnly = $derived(Boolean(param?.read_only));
	let isNameChangeable = $derived(Boolean(meta.user_permissions.can_edit_name));
	let warnings = $derived(node ? session?.getNodeVisibleWarnings(liveNode.node_id) : null);
	let graphNodesById = $derived(session?.graph.state.nodesById ?? null);
	let editorInfos: any = $derived(resolveParameterEditor(liveNode, graphNodesById));
	let EditorComponent = $derived(editorInfos ? editorInfos.component : null);
	let isValueOverridden = $derived.by((): boolean => {
		if (!param) {
			return false;
		}
		if (currentControlMode !== 'manual') {
			return true;
		}
		return !paramValuesEqual(param.value, param.default_value);
	});
	let currentControlMode: UiParameterControlMode = $derived(param?.control?.mode ?? 'manual');
	let canEditControl = $derived(Boolean(param && enabled && !readOnly));
	let controlMenuOpen = $state(false);
	let controlMenuTrigger: HTMLButtonElement | null = $state(null);
	let controlInfo = $state<UiParamControlInfo | null>(null);
	let controlInfoLoading = $state(false);
	let controlInfoRequestSeq = 0;
	let controlInfoPrevNodeId = $state<number | null>(null);
	let controlInfoPrevMode = $state<UiParameterControlMode | null>(null);
	let controlInfoPrevMenuOpen = $state(false);
	const controlModeOptions: ReadonlyArray<{ mode: UiParameterControlMode; label: string }> = [
		{ mode: 'manual', label: 'Manual' },
		{ mode: 'contextLink', label: 'Context Link' },
		{ mode: 'templateText', label: 'Template' },
		{ mode: 'expression', label: 'Expression' },
		{ mode: 'proxy', label: 'Proxy' },
		{ mode: 'binding', label: 'Binding' },
		{ mode: 'animation', label: 'Animation' }
	];
	const controlModeIcons: Record<UiParameterControlMode, string> = {
		manual: manualIcon,
		contextLink: contextIcon,
		templateText: templateIcon,
		expression: expressionIcon,
		proxy: proxyIcon,
		binding: bindingIcon,
		animation: animationIcon
	};
	let availableControlModes = $derived.by((): Set<UiParameterControlMode> => {
		if (controlInfo && controlInfo.param === liveNodeId) {
			return new Set(controlInfo.available_modes);
		}

		const fallback = new Set(controlModeOptions.map((option) => option.mode));
		// Template mode is context-dependent; keep it hidden until control info confirms context.
		fallback.delete('templateText');
		return fallback;
	});

	let displayedControlModeOptions = $derived.by(
		(): ReadonlyArray<{ mode: UiParameterControlMode; label: string }> =>
			controlModeOptions.filter(
				(option) => availableControlModes.has(option.mode) || option.mode === currentControlMode
			)
	);

	let onlyOneAvailableControlMode = $derived(availableControlModes.size === 1);

	let controlMenuAnchor = $derived.by((): ContextMenuAnchor | null => {
		if (!controlMenuTrigger) {
			return null;
		}
		return {
			kind: 'element',
			element: controlMenuTrigger,
			placement: 'bottom-end',
			offsetRem: 0.08
		};
	});
	let hasCompatibleContextCandidates = $derived.by((): boolean => {
		if (!controlInfo || controlInfo.param !== liveNodeId) {
			return true;
		}
		return controlInfo.context_candidates.some((candidate) => candidate.compatible);
	});
	const controlModeBaseColor = (mode: UiParameterControlMode): string => {
		switch (mode) {
			case 'contextLink':
			case 'templateText':
				return 'var(--gc-color-context)';
			case 'expression':
				return 'var(--gc-color-expression)';
			case 'proxy':
				return 'var(--gc-color-proxy)';
			case 'binding':
				return 'var(--gc-color-binding)';
			case 'animation':
				return 'var(--gc-color-animation)';
			case 'manual':
			default:
				return 'var(--gc-color-text)';
		}
	};
	let controlAccentColor = $derived.by((): string => {
		switch (currentControlMode) {
			case 'contextLink':
			case 'templateText':
				return 'var(--gc-color-context)';
			case 'expression':
				return 'var(--gc-color-expression)';
			case 'proxy':
				return 'var(--gc-color-proxy)';
			case 'binding':
				return 'var(--gc-color-binding)';
			case 'animation':
				return 'var(--gc-color-animation)';
			case 'manual':
			default:
				return 'transparent';
		}
	});
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
		if (!controlInfo || controlInfo.param !== liveNodeId) {
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
			) ??
			contextCandidates.find((candidate) => candidate.symbol === activeContextSymbol) ??
			null
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
			case 'css_value':
				return (
					left.value === (right as typeof left).value && left.unit === (right as typeof left).unit
				);
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
		void resetValueInSinglePass();
	};

	const startParameterLabelDrag = (event: DragEvent): void => {
		if (!param || renamingState.isRenaming) {
			return;
		}
		beginDashboardParameterDrag(event, liveNode);
	};

	const resetValueInSinglePass = async (): Promise<void> => {
		if (!param || readOnly || !enabled || !isValueOverridden) {
			return;
		}
		const defaultValue = param.default_value;
		const eventBehaviour = param.event_behaviour;
		const resetSession = createUiEditSession('Reset parameter', 'param-reset');

		await resetSession.begin();
		try {
			if (currentControlMode !== 'manual') {
				const appliedMode = await sendSetParamControlStateIntent(
					liveNodeId,
					stateForMode('manual')
				);
				if (!appliedMode) {
					return;
				}
			}
			await sendSetParamIntent(liveNodeId, defaultValue, eventBehaviour);
		} finally {
			await resetSession.end();
		}
	};

	function defaultControlSpec(mode: UiParameterControlMode): UiParameterControlSpec {
		switch (mode) {
			case 'contextLink':
				return { mode: 'contextLink', symbol: '', projection: undefined };
			case 'templateText':
				return { mode: 'templateText', template: '' };
			case 'expression':
				return { mode: 'expression' };
			case 'proxy':
				return { mode: 'proxy' };
			case 'binding':
				return { mode: 'binding' };
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
				spec: currentState.spec
			};
		}
		return {
			mode,
			spec: defaultControlSpec(mode)
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
		await sendSetParamControlStateIntent(liveNodeId, nextState);
		controlMenuOpen = false;
	};

	let controlModeMenuItems = $derived.by((): ContextMenuItem[] => {
		return displayedControlModeOptions.map((option) => ({
			id: `control-mode-${option.mode}`,
			label: option.label,
			icon: controlModeIcons[option.mode],
			disabled: isControlModeDisabled(option.mode),
			color:
				option.mode === 'manual'
					? 'var(--gc-color-text)'
					: `color-mix(in srgb, ${controlModeBaseColor(option.mode)} 86%, white 14%)`,
			hoverColor:
				option.mode === 'manual'
					? 'color-mix(in srgb, var(--gc-color-selection) 19%, transparent)'
					: `color-mix(in srgb, ${controlModeBaseColor(option.mode)} 24%, transparent)`,
			// hint: option.mode === currentControlMode ? 'Current' : undefined,
			action: () => {
				void applyControlMode(option.mode);
			}
		}));
	});

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
				(candidate) => candidate.symbol === nextSymbol && candidate.projections.includes(projection)
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
		await sendSetParamControlStateIntent(liveNodeId, {
			mode: 'contextLink',
			spec: {
				mode: 'contextLink',
				symbol: nextSymbol,
				projection: nextProjection
			}
		});
	};

	$effect(() => {
		contextSymbolDraft = activeContextSymbol;
		contextProjectionDraft = activeContextProjection;
	});

	$effect(() => {
		if (!isParameterNode) {
			controlInfo = null;
			controlInfoLoading = false;
			controlInfoRequestSeq += 1;
			return;
		}
		if (controlInfo && controlInfo.param !== liveNodeId) {
			controlInfo = null;
		}
	});

	$effect(() => {
		const previousNodeId = controlInfoPrevNodeId;
		const previousMode = controlInfoPrevMode;
		const previousMenuOpen = controlInfoPrevMenuOpen;
		controlInfoPrevNodeId = liveNodeId;
		controlInfoPrevMode = currentControlMode;
		controlInfoPrevMenuOpen = controlMenuOpen;

		if (!isParameterNode || !session) {
			return;
		}

		const nodeChanged = previousNodeId !== liveNodeId;
		const enteredContextLink =
			currentControlMode === 'contextLink' && previousMode !== 'contextLink';
		const openedMenu = controlMenuOpen && !previousMenuOpen;
		const shouldFetch = nodeChanged || enteredContextLink || openedMenu;
		if (!shouldFetch) {
			return;
		}

		const requestedNodeId = liveNodeId;
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
		class="parameter-inspector {order} {'level-' + level} {controlNodeType}
		{readOnly ? 'readonly' : ''} {currentControlMode !== 'manual' ? 'controlled' : ''}"
		class:control-menu-open={controlMenuOpen}
		class:layout-dashboard={layoutMode === 'dashboard'}
		style="--gc-parameter-accent: {controlAccentColor};"
		data-node-id={liveNode.node_id}>
		{#if param}
			<div class="firstline">
				{#if !isControlNode}
					<div class="parameter-info">
						{#if showsEnableButton}
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
									draggable="true"
									role="textbox"
									tabindex="-1"
									ondragstart={startParameterLabelDrag}
									ondblclick={() => {
										renamingState.renameDraft = liveNode.meta.label;
										renamingState.isRenaming = true;
									}}
									title="Double-click to rename">
									{liveNode.meta.label}
								</span>
							{/if}
						{:else}
							<span
								class="parameter-label"
								draggable="true"
								role="button"
								tabindex="-1"
								ondragstart={startParameterLabelDrag}>
								{liveNode.meta.label}
							</span>
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
				{:else if controlNodeType == 'expression'}
					<span class="expression-icon"></span>
				{:else if controlNodeType == 'proxy'}
					<span class="control-node-label">Proxy</span>
				{:else if controlNodeType == 'binding'}
					<span class="control-node-label">Binding</span>
				{:else}
					{controlNodeType} type
				{/if}

				{#if EditorComponent}
					<div
						class="parameter-controls"
						class:full-width={isControlNode || layoutMode === 'dashboard'}>
						<div class="parameter-wrapper {readOnly ? 'readonly' : ''} {enabled ? '' : 'disabled'}">
							<EditorComponent node={liveNode} />
						</div>

						{#if !readOnly && !onlyOneAvailableControlMode && !isControlNode}
							<div class="control-mode-menu">
								<button
									bind:this={controlMenuTrigger}
									type="button"
									class="control-mode-trigger {currentControlMode}"
									aria-label="Choose parameter control mode"
									title="Choose control mode"
									disabled={!canEditControl}
									onclick={() => {
										controlMenuOpen = !controlMenuOpen;
									}}>
									<img src={settingsIcon} alt="Control Mode" />
								</button>
								<ContextMenu
									bind:open={controlMenuOpen}
									items={controlModeMenuItems}
									anchor={controlMenuAnchor}
									insideElements={[controlMenuTrigger]}
									minWidthRem={8}
									maxWidthCss="min(14rem, calc(100vw - 2rem))"
									zIndex={50}
									menuClassName="control-mode-context-menu" />
							</div>
						{:else}
							<div class="control-mode-placeholder"></div>
						{/if}
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
											{candidate.value_type}
											{' | '}
											{candidate.entry_label}
											{' | '} scope
											{candidate.scope_label}
											{' | '} depth {candidate.lexical_depth}
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
				</div>
			{/if}
			{@render defaultChildren?.(currentControlMode)}
		{:else}
			{liveNode.meta.label} has no parameter data.
		{/if}
	</div>
{/if}

<style>
	.parameter-inspector {
		--gc-parameter-accent: transparent;
		width: 100%;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		transition: opacity 0.2s ease;
		padding-left: 0.2rem;
		padding-bottom: 0.2rem;
		overflow: visible;
		/* padding-right: 0.25rem; */
		position: relative;
		z-index: 0;
	}

	.parameter-inspector.controlled {
		border-left: solid 0.12rem rgb(from var(--gc-parameter-accent) r g b / 85%);
		padding-left: 0.28rem;
		border-radius: 0.3rem;
		background: linear-gradient(
			90deg,
			rgb(from var(--gc-parameter-accent) r g b / 14%) 0%,
			rgb(from var(--gc-parameter-accent) r g b / 6%) 35%,
			transparent 75%
		);
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

	.parameter-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		flex: 1;
	}

	.parameter-wrapper {
		display: flex;
		align-items: center;
		justify-content: right;
		flex: 1;
		min-width: 0;
		max-width: 15rem;
	}

	.custom-prop-name-text,
	.parameter-label {
		cursor: grab;
	}

	.custom-prop-name-text:active,
	.parameter-label:active {
		cursor: grabbing;
	}

	.full-width .parameter-wrapper {
		max-width: none;
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

	.parameter-inspector.layout-dashboard {
		min-width: 0;
		overflow: hidden;
	}

	.parameter-inspector.layout-dashboard .firstline,
	.parameter-inspector.layout-dashboard .parameter-controls,
	.parameter-inspector.layout-dashboard .parameter-wrapper,
	.parameter-inspector.layout-dashboard .parameter-info {
		min-width: 0;
	}

	.parameter-inspector.layout-dashboard .parameter-info {
		flex: 1 1 auto;
		overflow: hidden;
	}

	.parameter-inspector.layout-dashboard .parameter-wrapper {
		max-width: none;
	}

	.parameter-inspector.layout-dashboard .parameter-label,
	.parameter-inspector.layout-dashboard .custom-prop-name-text {
		display: inline-block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	.control-mode-menu {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.parameter-inspector.control-menu-open .control-mode-menu {
		z-index: 40;
	}

	.control-mode-trigger {
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0.15rem;
		opacity: 0.5;
		background: rgba(from var(--text-color) r g b / 6%);
		transition: opacity 0.2s ease;
	}

	.control-mode-trigger img {
		width: 100%;
		height: 100%;
	}

	.control-mode-trigger:hover:not(:disabled) {
		opacity: 1;
	}

	.control-mode-trigger:disabled {
		cursor: default;
		opacity: 0.35;
	}

	.control-mode-placeholder {
		width: 1.2rem;
		height: 1.2rem;
	}

	:global(.control-mode-context-menu .gc-context-item-hint) {
		font-size: 0.62em;
		letter-spacing: 0.03em;
		text-transform: uppercase;
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

	/* Control Nodes */
	.expression-icon {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.25rem;
		background: url('../../../style/icons/parameter/control/expression.svg') no-repeat center center;
		background-size: contain;
		display: inline-block;
	}

	.control-node-label {
		font-size: 0.65rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.8;
	}
</style>
