<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import Self from './NodeInspector.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import ParameterInspector from './ParameterInspector.svelte';
	import { getIconURLForNode } from '$lib/golden_ui/store/node-types';
	import EnableButton from '../../common/EnableButton.svelte';
	import NodeWarningBadge from '../../common/NodeWarningBadge.svelte';
	import { resolveNodeInspector, type NodeInspectorOrder } from './node-inspector-registry';

	let {
		nodes = [],
		level = 0,
		order = ''
	} = $props<{
		nodes: UiNodeDto[];
		level: number;
		order?: NodeInspectorOrder;
	}>();

	let session = $derived(appState.session);
	let node = $derived(
		nodes.length > 0 ? (session?.graph.state.nodesById.get(nodes[0]?.node_id) ?? nodes[0]) : null
	);

	let isRoot = $derived(level === 0);
	let isFirstLevel = $derived(level === 1);
	let collapsed = $derived(level > 3);

	//for now default to level
	let levelColors = [
		'rgba(255, 99, 132)',
		'rgba(54, 162, 235)',
		'rgba(255, 206, 86)',
		'rgba(255, 100, 0)',
		'rgba(153, 102, 255)',
		'rgba(255, 159, 64)'
	];
	let color = $derived(levelColors[level % levelColors.length]); // TODO: color by node type
	let children = $derived(node?.children ?? []);
	let isParameter = $derived(node?.data.kind === 'parameter');
	let showAsContainer = $derived(!isParameter);
	let hasChildren = $derived(children.length > 0);
	let canBeDisabled = $derived(node?.meta?.can_be_disabled ?? false);
	let isNameChangeable = $derived(node?.meta?.user_permissions.can_edit_name ?? false);
	let iconURL = $derived(getIconURLForNode(node));
	let warnings = $derived(node ? session?.getNodeVisibleWarnings(node.node_id) : null);
	let customInspectorEntry = $derived(
		node && showAsContainer ? resolveNodeInspector(node.node_type) : null
	);
	let CustomInspectorComponent = $derived(customInspectorEntry?.component ?? null);

	let titleTextElem: HTMLSpanElement | null = $state(null as HTMLSpanElement | null);
	let renameInputElem: HTMLInputElement | null = $state(null as HTMLInputElement | null);
	let renamingState = $state({
		isRenaming: false,
		renameDraft: ''
	});

	$effect(() => {
		if (!renamingState.isRenaming || !renameInputElem) {
			return;
		}

		renameInputElem.focus();
		renameInputElem.select();
	});

	const startRename = (): void => {
		if (!node || !isNameChangeable) {
			return;
		}
		renamingState.renameDraft = node.meta.label;
		renamingState.isRenaming = true;
	};

	const cancelRename = (): void => {
		if (!node) {
			renamingState.isRenaming = false;
			return;
		}
		renamingState.renameDraft = node.meta.label;
		renamingState.isRenaming = false;
	};

	const commitRename = async (): Promise<void> => {
		if (!node || !isNameChangeable) {
			renamingState.isRenaming = false;
			return;
		}

		const nextName = String(renamingState.renameDraft ?? '').trim();
		if (!nextName || nextName === node.meta.label) {
			renamingState.isRenaming = false;
			return;
		}

		await sendPatchMetaIntent(node.node_id, { label: nextName });
		renamingState.isRenaming = false;
	};

	const toggleCollapsed = (): void => {
		collapsed = !collapsed;
	};

	const setCollapsed = (nextCollapsed: boolean): void => {
		collapsed = nextCollapsed;
	};
</script>

{#if node}
	<div
		class="node-inspector {node.data.kind} 
			{isRoot ? 'root' : !isFirstLevel ? 'nested' : ''}
		{isParameter ? 'parameter' : 'container'}"
		data-node-id={node.node_id}
		style="--container-color: {color}">
		{#snippet builtInHeader()}
			{#if !isRoot}
				<div class="node-header">
					<span
						class="node-title"
						role="switch"
						class:name-changeable={isNameChangeable}
						aria-checked={!collapsed}
						tabindex="0"
						onclick={(e) => {
							if (renamingState.isRenaming) {
								return;
							}

							const target = e.target as HTMLElement;
							const clickedTitle = Boolean(
								titleTextElem && target && titleTextElem.contains(target)
							);
							if (!isNameChangeable || !clickedTitle) {
								toggleCollapsed();
							}
						}}
						onkeydown={(e) => {
							if (renamingState.isRenaming) {
								return;
							}
							if (e.key === 'Enter' || e.key === ' ') {
								toggleCollapsed();
							}
						}}>
						{#if hasChildren}
							<span class="arrow {collapsed ? '' : 'down'}"></span>
						{/if}
						<span class="header-icon">
							<img src={iconURL} alt="" />
						</span>

						{#if canBeDisabled}
							<EnableButton {node} />
						{/if}

						{#if renamingState.isRenaming}
							<input
								class="node-title-input"
								bind:this={renameInputElem}
								bind:value={renamingState.renameDraft}
								onclick={(e) => {
									e.stopPropagation();
								}}
								onblur={() => {
									void commitRename();
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										void commitRename();
										return;
									}
									if (e.key === 'Escape') {
										cancelRename();
									}
								}} />
						{:else}
							<span
								class="title-text"
								bind:this={titleTextElem}
								role="textbox"
								tabindex="-1"
								ondblclick={(e) => {
									if (!isNameChangeable) {
										return;
									}
									e.stopPropagation();
									startRename();
								}}
								title={isNameChangeable ? 'Double-click to rename' : undefined}>
								{node.meta.label || 'Container'}
							</span>
						{/if}

						<NodeWarningBadge {warnings} />
					</span>
				</div>
			{/if}
		{/snippet}

		{#snippet builtInChildren()}
			<div class="node-inspector-children">
				{#if !collapsed}
					<div class="node-inspector-children-wrapper" transition:slide={{ duration: 200 }}>
						{#each children as childId, index}
							<Self
								nodes={[session?.getNodeData(childId)!]}
								level={level + 1}
								order={children.length === 1
									? 'solo'
									: index === 0
										? 'first'
										: index === children.length - 1
											? 'last'
											: ''} />
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}

		{#if isParameter}
			<ParameterInspector {node} {level} {order} />
		{:else if CustomInspectorComponent}
			<CustomInspectorComponent
				{node}
				{level}
				{order}
				{collapsed}
				{hasChildren}
				{toggleCollapsed}
				{setCollapsed}>
				{#snippet defaultHeader()}
					{@render builtInHeader()}
				{/snippet}
				{#snippet defaultChildren()}
					{@render builtInChildren()}
				{/snippet}
			</CustomInspectorComponent>
		{:else}
			{@render builtInHeader()}
			<div class="node-inspector-content">
				{@render builtInChildren()}
			</div>
		{/if}
	</div>
{/if}

<style>
	.node-inspector {
		display: flex;
		flex-direction: column;
		border-radius: 0.5rem;
		font-size: 0.7rem;
		overflow: hidden;
	}

	.node-inspector.nested {
		margin-left: 0.3rem;
	}

	.node-inspector {
		padding-top: 1rem;
	}

	.node-inspector.parameter {
		padding-top: 0.5rem;
	}

	.node-inspector.root {
		padding-top: 0.2rem;
		box-sizing: border-box;
		flex: 1;

		:global(.node-inspector-content) {
			flex: 1;
		}
	}

	.node-inspector.nested {
		padding-top: 0.5rem;
	}

	.node-inspector.nested:not(.parameter) {
		padding-right: 0.2rem;
	}

	.node-inspector:not(.parameter):not(.root) {
		border-top-left-radius: 0.5rem;
		border-top-right-radius: 0.5rem;
		/* border-left: solid 3px var(--container-color); */
	}

	.header-icon {
		display: inline-flex;
		width: 1rem;
		height: 1rem;
		margin-right: 0.25rem;
	}

	.arrow {
		width: 1rem;
		height: 1rem;
		display: inline-block;
	}

	.node-inspector:not(.root) {
		.node-title {
			display: inline-flex;
			align-items: center;
			gap: 0.25rem;
			/* background: linear-gradient(
				to bottom,
				rgb(from var(--container-color) r g b / 40%),
				rgb(from var(--container-color) r g b / 5%)
			); */
			background-color: rgb(from var(--container-color) r g b / 30%);
			border-radius: 0.5rem 0.5rem 0 0;
			padding: 0.25rem;
			box-sizing: border-box;
			border-left: solid 2px var(--container-color);
			vertical-align: middle;
			cursor: pointer;
		}

		.node-title .title-text {
			padding: 0 0.15rem;
			line-height: 0.5rem;
			vertical-align: text-top;
		}

		:global(.node-inspector-content) {
			min-height: 0.5rem;
			border-radius: 0 0.5rem 0.5rem 0.5rem;
			background-color: rgba(from var(--container-color) r g b / 5%);
			border-bottom: solid 1px rgba(from var(--container-color) r g b / 20%);
			border-left: solid 2px var(--container-color);
			padding-bottom: 0.25rem;
			box-sizing: border-box;
		}
	}

	.child-row {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
	}

	.title-text {
		margin: 0;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
		color: var(--panel-accent-text-color);
		font-weight: bold;
	}

	.name-changeable .title-text {
		cursor: text;
	}

	.node-title-input {
		height: 0.9rem;
		min-width: 8rem;
		background-color: var(--bg-color);
		color: var(--text-color);
		font-size: 0.7rem;
		outline: 1px solid rgba(255, 255, 255, 0.2);
		/* border-radius: 0.25rem; */
		padding: 0 0.15rem;
		box-sizing: border-box;
		margin: 0;
	}
</style>
