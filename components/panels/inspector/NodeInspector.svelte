<script lang="ts">
	import { slide } from "svelte/transition";
	import type { NodeId, UiNodeDto } from "$lib/golden_ui/types";
	import Self from "./NodeInspector.svelte";
	import { appState } from "$lib/golden_ui/store/workbench.svelte";
	import ParameterInspector from "./ParameterInspector.svelte";
	import { getIconURLForNode } from "$lib/golden_ui/store/node-types";
	import EnableButton from "../../common/EnableButton.svelte";

	let {
		nodes = [],
		level = 0,
		order = "",
	} = $props<{
		nodes: UiNodeDto[];
		level: number;
		order?: "first" | "last" | "solo" | "";
	}>();

	let session = $derived(appState.session);
	let node = $derived(nodes.length > 0 ? nodes[0] : null);

	let isRoot = $derived(level === 0);
	let isFirstLevel = $derived(level === 1);

	let collapsed = $derived(level > 3);

	//for now default to level
	let levelColors = [
		"rgba(255, 99, 132)",
		"rgba(54, 162, 235)",
		"rgba(255, 206, 86)",
		"rgba(75, 192, 192)",
		"rgba(153, 102, 255)",
		"rgba(255, 159, 64)",
	];
	let color = $derived(levelColors[level % levelColors.length]); // TODO: color by node type
	let children = $derived(node?.children ?? []);
	let isParameter = $derived(node?.data.kind === "parameter");
	let showAsContainer = $derived(!isParameter);
	let hasChildren = $derived(children.length > 0);
	let canBeDisabled = $derived(node?.meta?.can_be_disabled ?? false);
	$inspect("node", node?.meta);
	let iconURL = $derived(getIconURLForNode(node));

	let titleTextElem : HTMLSpanElement = $state(null as HTMLSpanElement | null);
	let arrowElem : HTMLSpanElement = $state(null as HTMLSpanElement | null);
</script>

{#if node}
	<div
		class="node-inspector {node?.data.kind} 
			{isRoot ? 'root' : !isFirstLevel ? 'nested' : ''}
		{isParameter ? 'parameter' : 'container'}"
		style="--container-color: {color}"
	>
		{#if showAsContainer && !isRoot}
			<div class="node-header">
				<span
					class="node-title"
					role="switch"
					aria-checked={!collapsed}
					tabindex="0"
					onclick={(e) => {
						if (e.target == arrowElem || e.target == titleTextElem)
							collapsed = !collapsed;
					}}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							collapsed = !collapsed;
						}
					}}
				>
					{#if hasChildren}
						<span
							class="arrow {collapsed ? '' : 'down'}"
							bind:this={arrowElem}
						></span>
					{/if}
					<span class="header-icon">
						<img src={iconURL} alt="" />
					</span>

					{#if canBeDisabled}
						<EnableButton {node} />
					{/if}

					<span class="title-text" bind:this={titleTextElem}>
						{node.meta.label || "Container"}
					</span>
				</span>
			</div>
		{/if}

		{#if isParameter}
			<ParameterInspector {node} {level} {order} />
		{/if}

		{#if showAsContainer}
			<div class="node-inspector-children">
				{#if !collapsed}
					<div
						class="node-inspector-children-wrapper"
						transition:slide={{ duration: 200 }}
					>
						{#each children as childId, index}
							<Self
								nodes={[session?.getNodeData(childId)!]}
								level={level + 1}
								order={children.length === 1
									? "solo"
									: index === 0
										? "first"
										: index === children.length - 1
											? "last"
											: ""}
							/>
						{/each}
					</div>
				{/if}
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
		padding-right: 0.15rem;
	}

	.node-inspector.nested {
		margin-left: 0.5rem;
	}

	.node-inspector:not(.root) {
		padding-top: 1rem;
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
			display: inline-block;
			background-color: rgba(from var(--container-color) r g b / 40%);
			border-radius: 0.5rem 0.5rem 0 0;
			padding: 0.25rem;
			box-sizing: border-box;
			border-left: solid 3px var(--container-color);
			vertical-align: middle;
		}

		.node-title .title-text {
			padding: 0 0.15rem;
			vertical-align: top;
		}

		.node-inspector-children {
			min-height: 0.5rem;
			border-radius: 0 0.5rem 0.5rem 0.5rem;
			background-color: rgba(from var(--container-color) r g b / 10%);
			border-bottom: solid 1px
				rgba(from var(--container-color) r g b / 50%);
			border-left: solid 3px var(--container-color);
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
</style>
