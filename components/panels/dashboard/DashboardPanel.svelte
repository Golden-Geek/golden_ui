<script lang="ts">
	import type { PanelProps, PanelState } from '$lib/golden_ui/dockview/panel-types';
	import type { NodeId, UiNodeDto } from '$lib/golden_ui/types';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import NodeAddButton from '$lib/golden_ui/components/common/NodeAddButton.svelte';

	import DashboardCanvas from './DashboardCanvas.svelte';
	import { getDirectItemChildren } from './dashboard-model';

	type DashboardPanelParams = {
		dashboardNodeId?: NodeId;
		pageNodeId?: NodeId;
		editMode?: boolean;
	};

	let { panelApi, panelId, panelType, title, params }: PanelProps = $props();

	let panel = $state<PanelState>({
		panelId: '',
		panelType: '',
		title: '',
		params: {}
	});
	let pendingPanelParams = $state<DashboardPanelParams | null>(null);
	let publishedTitle = $state('');

	export const setPanelState = (next: PanelState): void => {
		panel = next;
	};

	$effect(() => {
		panel = { panelId, panelType, title, params };
	});

	let session = $derived(appState.session);
	let graph = $derived(session?.graph.state ?? null);
	let panelParams = $derived((panel.params ?? {}) as DashboardPanelParams);
	let selectedNode = $derived.by((): UiNodeDto | null => {
		if (!graph || session?.selectedNodeId === null || session?.selectedNodeId === undefined) {
			return null;
		}
		return graph.nodesById.get(session.selectedNodeId) ?? null;
	});

	let dashboards = $derived.by((): UiNodeDto[] => {
		if (!graph) {
			return [];
		}
		return [...graph.nodesById.values()]
			.filter((candidate) => candidate.node_type === 'dashboard')
			.sort((left, right) => left.meta.label.localeCompare(right.meta.label));
	});

	let selectedDashboard = $derived.by((): UiNodeDto | null => {
		if (dashboards.length === 0) {
			return null;
		}
		return (
			dashboards.find((candidate) => candidate.node_id === panelParams.dashboardNodeId) ??
			dashboards[0]
		);
	});

	let pages = $derived.by((): UiNodeDto[] => {
		return getDirectItemChildren(graph, selectedDashboard, 'dashboard_page');
	});

	let selectedPage = $derived.by((): UiNodeDto | null => {
		if (pages.length === 0) {
			return null;
		}
		return pages.find((candidate) => candidate.node_id === panelParams.pageNodeId) ?? pages[0];
	});

	const samePanelParams = (
		left: DashboardPanelParams | null | undefined,
		right: DashboardPanelParams | null | undefined
	): boolean => {
		return (
			(left?.dashboardNodeId ?? null) === (right?.dashboardNodeId ?? null) &&
			(left?.pageNodeId ?? null) === (right?.pageNodeId ?? null) &&
			(left?.editMode ?? false) === (right?.editMode ?? false)
		);
	};

	const updatePanelParams = (patch: Partial<DashboardPanelParams>): void => {
		const next: DashboardPanelParams = {
			...panelParams,
			...patch
		};
		if (samePanelParams(next, panelParams) || samePanelParams(next, pendingPanelParams)) {
			return;
		}
		pendingPanelParams = next;
		panelApi.updateParams(next as Record<string, unknown>);
	};

	$effect(() => {
		if (!pendingPanelParams) {
			return;
		}
		if (!samePanelParams(panelParams, pendingPanelParams)) {
			return;
		}
		pendingPanelParams = null;
	});

	$effect(() => {
		if (!graph || !selectedNode) {
			return;
		}
		if (selectedNode.node_type === 'dashboard') {
			if (panelParams.dashboardNodeId === selectedNode.node_id) {
				return;
			}
			updatePanelParams({ dashboardNodeId: selectedNode.node_id, pageNodeId: undefined });
			return;
		}
		if (selectedNode.node_type !== 'dashboard_page') {
			return;
		}
		const parentId = graph.parentById.get(selectedNode.node_id);
		const parentNode = parentId !== undefined ? graph.nodesById.get(parentId) ?? null : null;
		if (!parentNode || parentNode.node_type !== 'dashboard') {
			return;
		}
		if (
			panelParams.dashboardNodeId === parentNode.node_id &&
			panelParams.pageNodeId === selectedNode.node_id
		) {
			return;
		}
		updatePanelParams({ dashboardNodeId: parentNode.node_id, pageNodeId: selectedNode.node_id });
	});

	$effect(() => {
		const nextTitle = selectedPage
			? `Dashboard: ${selectedPage.meta.label}`
			: selectedDashboard
				? `Dashboard: ${selectedDashboard.meta.label}`
				: 'Dashboard';
		if (publishedTitle === nextTitle) {
			return;
		}
		panelApi.setTitle(nextTitle);
		publishedTitle = nextTitle;
	});

	const selectPage = (page: UiNodeDto): void => {
		session?.selectNode(page.node_id, 'REPLACE');
		updatePanelParams({ pageNodeId: page.node_id });
	};

	const toggleEditMode = (): void => {
		updatePanelParams({ editMode: !(panelParams.editMode ?? false) });
	};
</script>

<div class="dashboard-panel">
	{#if dashboards.length === 0}
		<div class="dashboard-empty-state">
			<h3>No dashboard nodes are available</h3>
			<p>Create a <code>dashboard</code> node in the engine tree to start authoring pages and widgets.</p>
		</div>
	{:else}
		<div class="dashboard-main">
			<header class="dashboard-strip">
				<!-- <div class="dashboard-strip-meta">
					<span class="dashboard-strip-title">{selectedDashboard?.meta.label ?? 'Dashboard'}</span>
				</div> -->
				<div class="dashboard-page-tabs" role="tablist" aria-label="Dashboard pages">
					{#if pages.length > 0}
						{#each pages as page}
							<button
								type="button"
								role="tab"
								aria-selected={selectedPage?.node_id === page.node_id}
								class:selected={selectedPage?.node_id === page.node_id}
								onclick={() => {
									selectPage(page);
								}}>{page.meta.label}</button>
						{/each}
					{:else}
						<span class="dashboard-pages-empty">No pages yet</span>
					{/if}
				</div>
				<div class="dashboard-strip-actions">
					<button
						type="button"
						class="dashboard-mode-toggle"
						class:active={panelParams.editMode ?? false}
						aria-pressed={panelParams.editMode ?? false}
						onclick={toggleEditMode}>{panelParams.editMode ? 'Editing Layout' : 'Run Widgets'}</button>
					{#if selectedDashboard && (panelParams.editMode ?? false)}
						<NodeAddButton node={selectedDashboard} />
					{/if}
				</div>
			</header>

			<div class="dashboard-main-content">
				{#if selectedPage}
					<DashboardCanvas node={selectedPage} editMode={panelParams.editMode ?? false} />
				{:else}
					<div class="dashboard-empty-state inline">
						<span class="eyebrow">Pages</span>
						<h3>No page selected</h3>
						<p>Use the add button on the right to create the first dashboard page.</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.dashboard-panel {
		inline-size: 100%;
		block-size: 100%;
		min-block-size: 0;
	}

	.dashboard-main,
	.dashboard-empty-state {
		width:100%;
		height:100%;
		box-sizing: border-box;
	}

	.dashboard-main {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		overflow: hidden;
	}

	.dashboard-strip {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0.6rem;
		margin-bottom:.25rem;
		border-bottom: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.35);
	}


	.dashboard-empty-state h3 {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: #eef4ff;
	}

	.dashboard-empty-state p,
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		opacity: 0.75;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.58rem;
	}

	.dashboard-page-tabs {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-inline-size: 0;
		flex: 1 1 auto;
		overflow-x: auto;
		scrollbar-width: thin;
		padding-block: 0.08rem;
	}

	.dashboard-page-tabs button {
		flex: 0 0 auto;
		padding: 0.38rem 0.68rem;
		border-radius: 999rem;
		background: rgb(from var(--gc-color-background) r g b / 0.42);
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.45);
		font-size: 0.74rem;
		line-height: 1;
		color: var(--gc-color-text);
	}

	.dashboard-page-tabs button.selected {
		background: rgb(from var(--gc-color-selection) r g b / 0.22);
		border-color: rgb(from var(--gc-color-selection) r g b / 0.72);
		color: white;
	}

	.dashboard-pages-empty {
		font-size: 0.72rem;
		opacity: 0.7;
		padding-inline: 0.35rem;
	}

	.dashboard-strip-actions {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		flex: 0 0 auto;
	}

	.dashboard-mode-toggle {
		padding: 0.34rem 0.62rem;
		border-radius: 999rem;
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.48);
		background: rgb(from var(--gc-color-background) r g b / 0.42);
		font-size: 0.7rem;
		line-height: 1;
		color: var(--gc-color-text);
	}

	.dashboard-mode-toggle.active {
		background: rgb(from var(--gc-color-selection) r g b / 0.22);
		border-color: rgb(from var(--gc-color-selection) r g b / 0.74);
		color: white;
	}

	.dashboard-main-content {
		flex: 1 1 auto;
		min-block-size: 0;
	}

	.dashboard-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 1.2rem;
		text-align: center;
	}

	.dashboard-empty-state.inline {
		block-size: 100%;
	}

	.dashboard-empty-state :global(code) {
		padding: 0.12rem 0.35rem;
		border-radius: 0.3rem;
		background: rgb(from var(--gc-color-background) r g b / 0.55);
	}
</style>