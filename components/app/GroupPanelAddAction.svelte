<script lang="ts">
	import type { PanelDefinition } from '$lib/golden_ui/dockview/panel-types';
	import ContextMenu from '../common/ContextMenu.svelte';
	import type { ContextMenuAnchor, ContextMenuItem } from '../common/context-menu';
	import addTabIcon from '../../style/icons/panels/add_tab.svg';

	let {
		availablePanels = [],
		onAddPanel
	}: {
		availablePanels: ReadonlyArray<PanelDefinition>;
		onAddPanel: (panelType: string) => void;
	} = $props();

	let menuOpen = $state(false);
	let triggerElement: HTMLButtonElement | null = $state(null);

	const canAddPanels = $derived(availablePanels.length > 0);

	let menuAnchor = $derived.by((): ContextMenuAnchor | null => {
		if (!triggerElement) {
			return null;
		}
		return {
			kind: 'element',
			element: triggerElement,
			placement: 'bottom-start',
			offsetRem: 0.08
		};
	});

	let menuItems = $derived.by((): ContextMenuItem[] => {
		return availablePanels.map((panel) => ({
			id: panel.panelType,
			label: panel.title,
			action: () => {
				onAddPanel(panel.panelType);
			}
		}));
	});

	export const closeMenu = (): void => {
		menuOpen = false;
	};
</script>

<div class="gc-group-panel-add">
	<button
		bind:this={triggerElement}
		type="button"
		class="gc-group-panel-add-trigger"
		aria-label="Add panel in this group"
		title="Add panel"
		disabled={!canAddPanels}
		onclick={() => {
			if (!canAddPanels) {
				return;
			}
			menuOpen = !menuOpen;
		}}>
		<img src={addTabIcon} alt="" />
	</button>

	<ContextMenu
		bind:open={menuOpen}
		items={menuItems}
		anchor={menuAnchor}
		insideElements={[triggerElement]}
		minWidthRem={9}
		maxWidthCss="min(14rem, calc(100vw - 2rem))"
		zIndex={20} />
</div>

<style>
	.gc-group-panel-add {
		position: relative;
		display: flex;
		align-items: center;
		block-size: 100%;
	}

	.gc-group-panel-add-trigger {
		inline-size: 1.4rem;
		block-size: 1.4rem;
		padding: 0.16rem;
		border-radius: 0.35rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		opacity: 0.9;
		transition: opacity 0.14s ease;
	}

	.gc-group-panel-add-trigger:hover:not(:disabled) {
		opacity: 1;
	}

	.gc-group-panel-add-trigger:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.gc-group-panel-add-trigger img {
		inline-size: 100%;
		block-size: 100%;
		display: block;
	}
</style>
