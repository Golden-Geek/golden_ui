<script lang="ts">
	import { sendCreateUserItemIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiCreatableUserItem, UiNodeDto } from '$lib/golden_ui/types';
	import { slide } from 'svelte/transition';
	import addIcon from '../../style/icons/node/add.svg';

	let { node }: { node: UiNodeDto } = $props();

	let creatableItems = $derived(node.creatable_user_items ?? []);
	let canCreateItems = $derived(creatableItems.length > 0);

	let addMenuOpen = $state(false);
	let addMenuElem: HTMLDivElement | null = $state(null as HTMLDivElement | null);
	let addMenuNodeId = $state<number | null>(null);

	$effect(() => {
		const nodeId = node?.node_id ?? null;
		if (addMenuNodeId === nodeId) {
			return;
		}
		addMenuNodeId = nodeId;
		addMenuOpen = false;
	});

	$effect(() => {
		if (!addMenuOpen || typeof window === 'undefined') {
			return;
		}

		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target as globalThis.Node | null;
			if (target && addMenuElem?.contains(target)) {
				return;
			}
			addMenuOpen = false;
		};

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				addMenuOpen = false;
			}
		};

		window.addEventListener('pointerdown', handlePointerDown, true);
		window.addEventListener('keydown', handleKeyDown, true);
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown, true);
			window.removeEventListener('keydown', handleKeyDown, true);
		};
	});

	const toggleAddMenu = (): void => {
		if (!canCreateItems) {
			return;
		}
		addMenuOpen = !addMenuOpen;
	};

	const createItem = async (item: UiCreatableUserItem): Promise<void> => {
		if (!node) {
			return;
		}
		addMenuOpen = false;
		await sendCreateUserItemIntent(node.node_id, item);
	};
</script>

{#if canCreateItems}
	<div class="add-item-menu" bind:this={addMenuElem}>
		<button
			class="add-item-trigger"
			type="button"
			aria-label="Add child item"
			title="Add item"
			aria-expanded={addMenuOpen}
			onclick={toggleAddMenu}>
			<img src={addIcon} alt="" />
		</button>
		{#if addMenuOpen}
			<div
				class="add-item-dropdown"
				role="menu"
				aria-label="Creatable items"
				transition:slide={{ duration: 200 }}>
				{#each creatableItems as item (`${item.node_type}:${item.item_kind}`)}
					<button
						type="button"
						class="add-item-option"
						role="menuitem"
						title={`Add ${item.label}`}
						onclick={() => {
							void createItem(item);
						}}>
						{item.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.add-item-menu {
		position: relative;
		display: inline-flex;
	}

	.add-item-trigger {
		width: 1.45rem;
		height: 1.45rem;
		padding: 0.15rem;
		border-radius: 0.35rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
        filter: brightness(1) grayscale(.7);
	}

	.add-item-trigger img {
		width: 100%;
		height: 100%;
		display: block;
	}

	.add-item-dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		right: 0;
		min-width: 10rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.2rem;
		border-radius: 0.35rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.15);
		background-color: rgba(30, 30, 30, 0.96);
		box-shadow: 0 0.4rem 1.2rem rgba(0, 0, 0, 0.45);
		z-index: 10;
	}

	.add-item-option {
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-color);
		font-size: 0.72rem;
		text-align: left;
		padding: 0.3rem 0.4rem;
		cursor: pointer;
	}

	.add-item-option:hover {
		background-color: rgba(255, 255, 255, 0.12);
	}


</style>