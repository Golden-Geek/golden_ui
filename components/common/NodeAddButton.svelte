<script lang="ts">
	import { sendCreateUserItemIntent } from '../../store/ui-intents';
	import { appState } from '../../store/workbench.svelte';
	import type { UiCreatableUserItem, UiNodeDto } from '../../types';
	import ContextMenu from './ContextMenu.svelte';
	import type { ContextMenuAnchor, ContextMenuItem } from './context-menu';
	import addIcon from '../../style/icons/node/add.svg';

	let { node }: { node: UiNodeDto } = $props();

	let creatableItems = $derived(node.creatable_user_items ?? []);
	let canCreateItems = $derived(creatableItems.length > 0);
	let showsContextMenu = $derived(creatableItems.length > 1);

	let addMenuOpen = $state(false);
	let addMenuTrigger: HTMLButtonElement | null = $state(null);
	let addMenuNodeId = $state<number | null>(null);
	let creatingSingleItem = $state(false);

	$effect(() => {
		const nodeId = node?.node_id ?? null;
		if (addMenuNodeId === nodeId) {
			return;
		}
		addMenuNodeId = nodeId;
		addMenuOpen = false;
	});

	const toggleAddMenu = async (): Promise<void> => {
		if (!canCreateItems || creatingSingleItem) {
			return;
		}
		if (!showsContextMenu) {
			const singleItem = creatableItems[0];
			if (!singleItem) {
				return;
			}
			creatingSingleItem = true;
			try {
				await createItem(singleItem);
			} finally {
				creatingSingleItem = false;
			}
			return;
		}
		addMenuOpen = !addMenuOpen;
	};

	const createItem = async (item: UiCreatableUserItem): Promise<void> => {
		if (!node) {
			return;
		}
		addMenuOpen = false;
		const result = await sendCreateUserItemIntent(node.node_id, item);
		if (result.selectWhenCreated && result.createdNodeId !== null) {
			appState.session?.selectNode(result.createdNodeId, 'REPLACE');
		}
	};

	let menuAnchor = $derived.by((): ContextMenuAnchor | null => {
		if (!addMenuTrigger) {
			return null;
		}
		return {
			kind: 'element',
			element: addMenuTrigger,
			placement: 'bottom-end',
			offsetRem: 0.08
		};
	});

	let menuItems = $derived.by((): ContextMenuItem[] => {
		return creatableItems.map((item) => ({
			id: `${item.node_type}:${item.item_kind}`,
			label: item.label,
			action: () => {
				void createItem(item);
			}
		}));
	});
</script>

{#if canCreateItems}
	<div class="add-item-menu">
		<button
			bind:this={addMenuTrigger}
			class="add-item-trigger"
			type="button"
			aria-label="Add child item"
			title="Add item"
			aria-expanded={showsContextMenu ? addMenuOpen : undefined}
			disabled={creatingSingleItem}
			onclick={toggleAddMenu}>
			<img src={addIcon} alt="" />
		</button>
		{#if showsContextMenu}
			<ContextMenu
				bind:open={addMenuOpen}
				items={menuItems}
				anchor={menuAnchor}
				insideElements={[addMenuTrigger]}
				minWidthRem={10}
				maxWidthCss="min(18rem, calc(100vw - 2rem))" />
		{/if}
	</div>
{/if}

<style>
	.add-item-menu {
		position: relative;
		display: inline-flex;
	}

	.add-item-trigger {
		inline-size: 1.45rem;
		block-size: 1.45rem;
		padding: 0.15rem;
		border-radius: 0.35rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		filter: brightness(1) grayscale(0.7);
	}

	.add-item-trigger img {
		inline-size: 100%;
		block-size: 100%;
		display: block;
	}
</style>
