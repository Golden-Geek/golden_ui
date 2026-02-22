<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { openNodePickerModal } from '$lib/golden_ui/store/node-picker-modal.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { NodeId, UiNodeDto, UiReferenceConstraints } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	const NIL_UUID = '00000000-0000-0000-0000-000000000000';

	let session = $derived(appState.session);
	let graph = $derived(session?.graph.state ?? null);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let constraints = $derived(param?.constraints.reference);
	let value = $derived(param?.value.kind === 'reference' ? param.value : null);
	let enabled = $derived(liveNode.meta.enabled);
	let readOnly = $derived(Boolean(param?.read_only));
	let allowedTargetIds = $derived(param?.reference_allowed_targets ?? []);
	let visibleNodeIds = $derived(param?.reference_visible_nodes ?? []);
	let hasCustomReferenceFilter = $derived(Boolean(constraints?.custom_filter_key));

	const getNodeByUuid = (uuid: string): UiNodeDto | null => {
		if (!graph || uuid.length === 0) {
			return null;
		}
		for (const candidate of graph.nodesById.values()) {
			if (candidate.uuid === uuid) {
				return candidate;
			}
		}
		return null;
	};

	const resolveDeclPath = (rootId: NodeId, path: string[]): NodeId | null => {
		if (!graph) {
			return null;
		}
		let current = rootId;
		for (const segment of path) {
			const children = graph.childrenById.get(current) ?? [];
			let next: NodeId | null = null;
			for (const childId of children) {
				const child = graph.nodesById.get(childId);
				if (child?.decl_id === segment) {
					next = childId;
					break;
				}
			}
			if (next === null) {
				return null;
			}
			current = next;
		}
		return current;
	};

	const resolveRootNodeId = (
		referenceConstraints: UiReferenceConstraints | undefined
	): NodeId | null => {
		if (!graph) {
			return null;
		}
		if (!referenceConstraints || referenceConstraints.root.kind === 'engineRoot') {
			return graph.rootId;
		}
		if (referenceConstraints.root.kind === 'uuid') {
			return getNodeByUuid(referenceConstraints.root.uuid)?.node_id ?? null;
		}
		if (referenceConstraints.root.kind === 'relativeToOwner') {
			const ownerId = graph.parentById.get(liveNode.node_id);
			if (ownerId === undefined) {
				return null;
			}
			return resolveDeclPath(ownerId, referenceConstraints.root.path);
		}
		return graph.rootId;
	};

	const nodePathFromRoot = (rootNodeId: NodeId, targetNodeId: NodeId): string[] => {
		if (!graph) {
			return [];
		}
		if (rootNodeId === targetNodeId) {
			return [];
		}
		const reversed: string[] = [];
		let current: NodeId | undefined = targetNodeId;
		while (current !== undefined) {
			if (current === rootNodeId) {
				reversed.reverse();
				return reversed;
			}
			const currentNode = graph.nodesById.get(current);
			if (!currentNode) {
				return [];
			}
			reversed.push(currentNode.decl_id);
			current = graph.parentById.get(current);
		}
		return [];
	};

	const labelPathFromRoot = (rootNodeId: NodeId, targetNodeId: NodeId): string => {
		if (!graph) {
			return '';
		}
		const pathIds: NodeId[] = [];
		let current: NodeId | undefined = targetNodeId;
		while (current !== undefined && current !== rootNodeId) {
			pathIds.push(current);
			current = graph.parentById.get(current);
		}
		pathIds.reverse();
		const labels = pathIds
			.map((nodeId) => graph.nodesById.get(nodeId)?.meta.label ?? '')
			.filter((label) => label.length > 0);
		return labels.join(' / ');
	};

	const candidateAllowedByConstraints = (
		candidate: UiNodeDto,
		referenceConstraints: UiReferenceConstraints | undefined
	): boolean => {
		if (hasCustomReferenceFilter) {
			return allowedTargetIds.includes(candidate.node_id);
		}
		if (!referenceConstraints) {
			return true;
		}
		if (
			referenceConstraints.target_kind === 'parameterOnly' &&
			candidate.data.kind !== 'parameter'
		) {
			return false;
		}
		if (
			referenceConstraints.allowed_node_types.length > 0 &&
			!referenceConstraints.allowed_node_types.includes(candidate.node_type)
		) {
			return false;
		}
		if (referenceConstraints.allowed_parameter_types.length > 0) {
			if (candidate.data.kind !== 'parameter') {
				return false;
			}
			if (!referenceConstraints.allowed_parameter_types.includes(candidate.data.param.value.kind)) {
				return false;
			}
		}
		return true;
	};

	const candidateVisibleInPicker = (candidate: UiNodeDto): boolean => {
		if (hasCustomReferenceFilter) {
			return visibleNodeIds.includes(candidate.node_id);
		}
		return candidateAllowedByConstraints(candidate, constraints);
	};

	let rootNodeId = $derived(resolveRootNodeId(constraints));
	let rootNode = $derived(
		rootNodeId !== null && graph ? graph.nodesById.get(rootNodeId) ?? null : null
	);
	let selectedNode = $derived.by(() => {
		if (!value || !graph) {
			return null;
		}
		if (value.cached_id !== undefined) {
			const byId = graph.nodesById.get(value.cached_id);
			if (byId) {
				return byId;
			}
		}
		return getNodeByUuid(value.uuid);
	});

	let triggerElement = $state<HTMLButtonElement | null>(null);

	const applyReference = async (target: UiNodeDto): Promise<void> => {
		if (!param || param.value.kind !== 'reference' || !enabled || readOnly) {
			return;
		}
		if (rootNodeId === null) {
			return;
		}
		const relativePathFromRoot = nodePathFromRoot(rootNodeId, target.node_id);
		await sendSetParamIntent(
			liveNode.node_id,
			{
				kind: 'reference',
				uuid: target.uuid,
				relative_path_from_root: relativePathFromRoot
			},
			param.event_behaviour
		);
	};

	const clearReference = async (): Promise<void> => {
		if (!param || param.value.kind !== 'reference' || !enabled || readOnly) {
			return;
		}
		await sendSetParamIntent(
			liveNode.node_id,
			{
				kind: 'reference',
				uuid: NIL_UUID,
				relative_path_from_root: []
			},
			param.event_behaviour
		);
	};

	const openPicker = async (): Promise<void> => {
		if (!enabled || readOnly || !graph) {
			return;
		}
		const result = await openNodePickerModal({
			rootNode,
			selectedNodeId: selectedNode?.node_id ?? null,
			title: 'Select reference target',
			placeholder: 'No reference',
			searchPlaceholder: 'Search label, type, path',
			defaultSearchQuery: constraints?.default_search_filter ?? '',
			clearable: true,
			initiallyExpandedDepth: 5,
			nodeFilter: pickerFilter,
			nodeVisibilityFilter: pickerVisibilityFilter,
			nodeSearchText: pickerSearchText,
			anchorElement: triggerElement
		});

		if (result.kind === 'pick') {
			await applyReference(result.node);
			return;
		}

		if (result.kind === 'clear') {
			await clearReference();
		}
	};

	const pickerFilter = (candidate: UiNodeDto): boolean => {
		return candidateAllowedByConstraints(candidate, constraints);
	};

	const pickerVisibilityFilter = (candidate: UiNodeDto): boolean => {
		return candidateVisibleInPicker(candidate);
	};

	const pickerSearchText = (candidate: UiNodeDto): string => {
		if (rootNodeId === null) {
			return `${candidate.meta.label} ${candidate.meta.short_name} ${candidate.node_type}`;
		}
		const pathLabel = labelPathFromRoot(rootNodeId, candidate.node_id);
		return `${candidate.meta.label} ${candidate.meta.short_name} ${candidate.node_type} ${pathLabel}`;
	};

</script>

<div class="reference-editor">
	<button
		type="button"
		class="picker-trigger"
		class:selected={selectedNode !== null}
		class:readonly={readOnly}
		disabled={!enabled}
		bind:this={triggerElement}
		onclick={() => {
			void openPicker();
		}}>
		{#if selectedNode}
			{selectedNode.meta.label}
		{:else}
			<span class="placeholder">No reference</span>
		{/if}
	</button>
</div>

{#if value && value.uuid.length > 0 && value.uuid !== NIL_UUID && !selectedNode}
	<div class="status missing">Missing target for uuid {value.uuid}</div>
{:else if value && value.uuid.length > 0 && value.uuid !== NIL_UUID && selectedNode}
	<div class="status linked">Linked to {selectedNode.meta.label}</div>
{:else}
	<div class="status empty-status">No target linked</div>
{/if}

<style>
	.reference-editor {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 14rem;
		max-width: 22rem;
	}

	.picker-trigger {
		height: 1.6rem;
		width: 100%;
		text-align: left;
	}

	.picker-trigger.readonly {
		opacity: 0.7;
	}

	.picker-trigger.selected {
		font-weight: 600;
	}

	.placeholder {
		opacity: 0.6;
	}

	.status {
		font-size: 0.68rem;
	}

	.missing {
		color: color-mix(in srgb, var(--warning-color) 80%, var(--text-color));
	}

	.linked {
		opacity: 0.72;
	}

	.empty-status {
		opacity: 0.6;
	}
</style>
