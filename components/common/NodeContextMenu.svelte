<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import Self from './NodeContextMenu.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import {
		closeNodeContextMenu,
		nodeContextMenuState,
		openNodeContextMenu
	} from '$lib/golden_ui/store/node-context-menu.svelte';
	import type { NodeId, UiColorDto, UiNodeDto } from '$lib/golden_ui/types';
	import { getMainViewportBounds, remToPx } from '$lib/golden_ui/components/common/floating-panel';

	type MenuTone = 'default' | 'danger';

	type MenuItem = {
		id?: string;
		separator?: boolean;
		label?: string;
		tone?: MenuTone;
		disabled?: boolean;
		visible?: boolean;
		action?: () => void;
		submenu?: () => MenuItem[];
	};

	interface ResolvedNodeTarget {
		nodeId: NodeId;
		host: HTMLElement;
	}

	let { submenu = null, offsetX = 0, offsetY = 0 } = $props<{
		submenu?: MenuItem[] | null;
		offsetX?: number;
		offsetY?: number;
	}>();

	let session = $derived(appState.session);
	let graphState = $derived(session?.graph.state ?? null);
	let contextNodeId = $derived(nodeContextMenuState.nodeId);
	let contextPosition = $derived(nodeContextMenuState.position);
	let menuDiv: HTMLDivElement | null = $state(null);
	let submenuDiv: HTMLDivElement | null = $state(null);
	let colorInputElem: HTMLInputElement | null = $state(null);

	let activeSubMenu = $state({
		items: null as MenuItem[] | null,
		offsetX: 0,
		offsetY: 0
	});

	const clearSubMenu = (): void => {
		activeSubMenu.items = null;
		activeSubMenu.offsetX = 0;
		activeSubMenu.offsetY = 0;
	};

	const closeMenu = (): void => {
		clearSubMenu();
		closeNodeContextMenu();
	};

	const resolveNodeTarget = (target: EventTarget | null): ResolvedNodeTarget | null => {
		if (!(target instanceof Element)) {
			return null;
		}
		const host = target.closest<HTMLElement>('[data-node-id]');
		if (!host) {
			return null;
		}
		const rawNodeId = host.dataset.nodeId;
		if (!rawNodeId) {
			return null;
		}
		const parsed = Number(rawNodeId);
		if (!Number.isFinite(parsed)) {
			return null;
		}
		return {
			nodeId: parsed,
			host
		};
	};

	const normalizeMenuItems = (items: MenuItem[]): MenuItem[] => {
		const visible = items.filter((item) => item.visible !== false);
		const normalized: MenuItem[] = [];
		let previousWasSeparator = true;

		for (const item of visible) {
			if (item.separator) {
				if (previousWasSeparator) {
					continue;
				}
				normalized.push(item);
				previousWasSeparator = true;
				continue;
			}

			normalized.push(item);
			previousWasSeparator = false;
		}

		while (normalized.length > 0 && normalized[normalized.length - 1]?.separator) {
			normalized.pop();
		}

		return normalized;
	};

	const clampPosition = (
		node: HTMLElement,
		desiredLeft: number,
		desiredTop: number
	): { left: number; top: number } => {
		const bounds = getMainViewportBounds();
		const paddingPx = remToPx(0.45);
		const rect = node.getBoundingClientRect();

		const minLeft = bounds.left + paddingPx;
		const maxLeft = Math.max(minLeft, bounds.right - rect.width - paddingPx);
		const minTop = bounds.top + paddingPx;
		const maxTop = Math.max(minTop, bounds.bottom - rect.height - paddingPx);

		const left = Math.min(Math.max(minLeft, desiredLeft), maxLeft);
		const top = Math.min(Math.max(minTop, desiredTop), maxTop);
		return { left, top };
	};

	const applyMenuPosition = (node: HTMLDivElement, desiredLeft: number, desiredTop: number): void => {
		const clamped = clampPosition(node, desiredLeft, desiredTop);
		node.style.left = `${clamped.left}px`;
		node.style.top = `${clamped.top}px`;
	};

	const positionMenu = (x: number, y: number) => {
		return (node: HTMLDivElement) => {
			menuDiv = node;
			node.tabIndex = -1;
			queueMicrotask(() => {
				node.focus();
			});

			let raf = 0;
			raf = requestAnimationFrame(() => {
				applyMenuPosition(node, x, y);
			});

			return () => {
				cancelAnimationFrame(raf);
				if (menuDiv === node) {
					menuDiv = null;
				}
			};
		};
	};

	const captureSubmenuContainer = () => {
		return (node: HTMLDivElement) => {
			submenuDiv = node;
			return () => {
				if (submenuDiv === node) {
					submenuDiv = null;
				}
			};
		};
	};

	const updateRootMenuPosition = (): void => {
		if (submenu !== null || contextNodeId === null || !menuDiv) {
			return;
		}
		applyMenuPosition(menuDiv, contextPosition.x + offsetX, contextPosition.y + offsetY);
	};

	const openSubMenu = (event: Event, item: MenuItem): void => {
		if (!item.submenu) {
			clearSubMenu();
			return;
		}
		const nextItems = normalizeMenuItems(item.submenu());
		if (nextItems.length === 0 || !menuDiv) {
			clearSubMenu();
			return;
		}

		const currentTarget = event.currentTarget as HTMLElement | null;
		if (!currentTarget) {
			clearSubMenu();
			return;
		}

		const menuRect = menuDiv.getBoundingClientRect();
		const rowRect = currentTarget.getBoundingClientRect();
		activeSubMenu.items = nextItems;
		activeSubMenu.offsetX = offsetX + menuDiv.offsetWidth;
		activeSubMenu.offsetY = offsetY + (rowRect.top - menuRect.top);
	};

	const handleItemClick = (event: MouseEvent, item: MenuItem): void => {
		event.stopPropagation();
		if (item.disabled || item.separator) {
			return;
		}
		if (item.submenu) {
			openSubMenu(event, item);
			return;
		}
		item.action?.();
		closeMenu();
	};

	const handleItemFocus = (event: Event, item: MenuItem): void => {
		if (item.disabled) {
			clearSubMenu();
			return;
		}
		openSubMenu(event, item);
	};

	const handleMenuContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	const isInsideCurrentMenuTree = (target: EventTarget | null): boolean => {
		if (!(target instanceof Node)) {
			return false;
		}
		return menuDiv?.contains(target) === true || submenuDiv?.contains(target) === true;
	};

	const handleWindowContextMenu = (event: MouseEvent): void => {
		if (submenu !== null) {
			return;
		}
		if (isInsideCurrentMenuTree(event.target)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		const target = resolveNodeTarget(event.target);
		if (!target || !graphState?.nodesById.has(target.nodeId)) {
			closeMenu();
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		let nextX = event.clientX;
		let nextY = event.clientY;
		if (nextX === 0 && nextY === 0) {
			const rect = target.host.getBoundingClientRect();
			nextX = rect.left + rect.width / 2;
			nextY = rect.top + rect.height / 2;
		}

		openNodeContextMenu(target.nodeId, nextX, nextY);
		clearSubMenu();
	};

	const handleDocumentPointerDown = (event: PointerEvent): void => {
		if (submenu !== null || contextNodeId === null) {
			return;
		}
		if (isInsideCurrentMenuTree(event.target)) {
			return;
		}
		closeMenu();
	};

	const handleDocumentKeydown = (event: KeyboardEvent): void => {
		if (submenu !== null || contextNodeId === null) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
		}
	};

	const handleWindowViewportChange = (): void => {
		updateRootMenuPosition();
	};

	onMount(() => {
		if (submenu !== null) {
			return;
		}

		window.addEventListener('contextmenu', handleWindowContextMenu, true);
		document.addEventListener('pointerdown', handleDocumentPointerDown, true);
		document.addEventListener('keydown', handleDocumentKeydown);
		window.addEventListener('resize', handleWindowViewportChange);
		window.addEventListener('scroll', handleWindowViewportChange, true);

		return () => {
			window.removeEventListener('contextmenu', handleWindowContextMenu, true);
			document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
			document.removeEventListener('keydown', handleDocumentKeydown);
			window.removeEventListener('resize', handleWindowViewportChange);
			window.removeEventListener('scroll', handleWindowViewportChange, true);
		};
	});

	let activeNode = $derived.by((): UiNodeDto | null => {
		if (contextNodeId === null || !graphState) {
			return null;
		}
		return graphState.nodesById.get(contextNodeId) ?? null;
	});

	$effect(() => {
		if (submenu !== null || contextNodeId === null) {
			return;
		}
		if (activeNode !== null) {
			return;
		}
		closeMenu();
	});

	let parentNode = $derived.by((): UiNodeDto | null => {
		if (!activeNode || !graphState) {
			return null;
		}
		const parentId = graphState.parentById.get(activeNode.node_id);
		if (parentId === undefined) {
			return null;
		}
		return graphState.nodesById.get(parentId) ?? null;
	});

	let isRoot = $derived(Boolean(activeNode && graphState?.rootId === activeNode.node_id));
	let canDelete = $derived(
		Boolean(activeNode && activeNode.meta.user_permissions.can_remove_and_duplicate && !isRoot)
	);
	let canDuplicate = $derived.by((): boolean => {
		if (!activeNode || !parentNode || isRoot) {
			return false;
		}
		if (!activeNode.meta.user_permissions.can_remove_and_duplicate) {
			return false;
		}
		return parentNode.creatable_user_items.some(
			(candidate) => candidate.node_type === activeNode.node_type
		);
	});
	let canSetColor = $derived(Boolean(activeNode?.meta.user_permissions.can_edit_color));
	let canSetConstraints = $derived(
		Boolean(activeNode?.meta.user_permissions.can_edit_constraints && activeNode.data.kind === 'parameter')
	);

	const clamp01 = (value: number): number => {
		if (!Number.isFinite(value)) {
			return 0;
		}
		return Math.max(0, Math.min(1, value));
	};

	const toHexPair = (value: number): string => {
		const channel = Math.round(clamp01(value) * 255);
		return channel.toString(16).padStart(2, '0');
	};

	let colorInputValue = $derived.by((): string => {
		const color = activeNode?.meta.presentation?.color;
		const red = color?.r ?? 1;
		const green = color?.g ?? 1;
		const blue = color?.b ?? 1;
		return `#${toHexPair(red)}${toHexPair(green)}${toHexPair(blue)}`;
	});

	const relativeDeclPath = (targetNodeId: NodeId): string => {
		if (!graphState || graphState.rootId === null) {
			return '';
		}
		if (targetNodeId === graphState.rootId) {
			return '';
		}

		const reversed: string[] = [];
		let current: NodeId | undefined = targetNodeId;
		while (current !== undefined && current !== graphState.rootId) {
			const currentNode = graphState.nodesById.get(current);
			if (!currentNode) {
				return '';
			}
			reversed.push(currentNode.decl_id);
			current = graphState.parentById.get(current);
		}

		if (current !== graphState.rootId) {
			return '';
		}

		reversed.reverse();
		return reversed.join('/');
	};

	let scriptControlPath = $derived(activeNode ? relativeDeclPath(activeNode.node_id) : '');

	const copyTextToClipboard = async (text: string): Promise<void> => {
		const trimmed = String(text ?? '');
		if (trimmed.length === 0) {
			return;
		}

		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(trimmed);
				return;
			}
		} catch (error) {
			console.warn('[ui] navigator clipboard write failed', error);
		}

		if (typeof document === 'undefined') {
			return;
		}

		const textarea = document.createElement('textarea');
		textarea.value = trimmed;
		textarea.setAttribute('readonly', 'readonly');
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		try {
			document.execCommand('copy');
		} finally {
			document.body.removeChild(textarea);
		}
	};

	const copyScriptControlPath = (): void => {
		const value = scriptControlPath.length > 0 ? scriptControlPath : '.';
		void copyTextToClipboard(value);
	};

	const nextDuplicateLabel = (): string => {
		const baseLabel =
			activeNode && activeNode.meta.label.trim().length > 0
				? activeNode.meta.label.trim()
				: activeNode?.node_type ?? 'Node';
		const firstCandidate = `${baseLabel} Copy`;
		if (!graphState || !parentNode) {
			return firstCandidate;
		}

		const usedLabels = new Set<string>();
		for (const childId of parentNode.children) {
			const sibling = graphState.nodesById.get(childId);
			if (!sibling) {
				continue;
			}
			const label = sibling.meta.label.trim();
			if (label.length > 0) {
				usedLabels.add(label);
			}
		}

		if (!usedLabels.has(firstCandidate)) {
			return firstCandidate;
		}

		let suffix = 2;
		while (usedLabels.has(`${firstCandidate} ${suffix}`)) {
			suffix += 1;
		}
		return `${firstCandidate} ${suffix}`;
	};

	const duplicateNode = (): void => {
		if (!session || !activeNode || !canDuplicate || !parentNode) {
			return;
		}
		void session.sendIntent({
			kind: 'createUserItem',
			parent: parentNode.node_id,
			node_type: activeNode.node_type,
			label: nextDuplicateLabel()
		});
	};

	const deleteNode = (): void => {
		if (!session || !activeNode || !canDelete) {
			return;
		}
		void session.sendIntent({
			kind: 'removeNode',
			node: activeNode.node_id
		});
	};

	const parseHexColor = (hex: string, alpha: number): UiColorDto | null => {
		const normalized = String(hex ?? '').trim();
		const match = /^#?([0-9a-fA-F]{6})$/.exec(normalized);
		if (!match) {
			return null;
		}
		const value = match[1];
		const red = parseInt(value.slice(0, 2), 16) / 255;
		const green = parseInt(value.slice(2, 4), 16) / 255;
		const blue = parseInt(value.slice(4, 6), 16) / 255;
		return {
			r: clamp01(red),
			g: clamp01(green),
			b: clamp01(blue),
			a: clamp01(alpha)
		};
	};

	const setNodeColor = (nextColor: UiColorDto): void => {
		if (!activeNode) {
			return;
		}
		const existingPresentation = activeNode.meta.presentation ?? {};
		void sendPatchMetaIntent(activeNode.node_id, {
			presentation: {
				...existingPresentation,
				color: nextColor
			}
		});
	};

	const openColorPicker = (): void => {
		if (!canSetColor || !colorInputElem) {
			return;
		}
		colorInputElem.value = colorInputValue;
		colorInputElem.click();
	};

	const applyPickedColor = (event: Event): void => {
		if (!activeNode || !canSetColor) {
			return;
		}
		const input = event.currentTarget as HTMLInputElement | null;
		if (!input) {
			return;
		}
		const alpha = activeNode.meta.presentation?.color?.a ?? 1;
		const parsed = parseHexColor(input.value, alpha);
		if (!parsed) {
			return;
		}
		setNodeColor(parsed);
	};

	const setConstraints = (): void => {
		if (!canSetConstraints || !activeNode || activeNode.data.kind !== 'parameter') {
			return;
		}
		void copyTextToClipboard(JSON.stringify(activeNode.data.param.constraints, null, 2));
		console.warn('[ui] set constraints intent is not available yet; copied current constraints JSON');
	};

	const selectCopyScriptControlPath = (): void => {
		copyScriptControlPath();
	};

	const selectSetColor = (): void => {
		openColorPicker();
	};

	const selectSetConstraints = (): void => {
		setConstraints();
	};

	const selectDuplicateNode = (): void => {
		duplicateNode();
	};

	const selectDeleteNode = (): void => {
		deleteNode();
	};

	let rootMenuItems = $derived.by((): MenuItem[] => {
		if (!activeNode) {
			return [];
		}

		return normalizeMenuItems([
			{
				id: 'copy-script-control-path',
				label: 'Copy Script Control Path',
				action: selectCopyScriptControlPath
			},
			{ separator: canSetColor || canSetConstraints },
			{
				id: 'set-color',
				label: 'Set Color',
				visible: canSetColor,
				action: selectSetColor
			},
			{
				id: 'set-constraints',
				label: 'Set Constraints',
				visible: canSetConstraints,
				action: selectSetConstraints
			},
			{ separator: canDuplicate || canDelete },
			{
				id: 'duplicate',
				label: 'Duplicate',
				visible: canDuplicate,
				action: selectDuplicateNode
			},
			{
				id: 'delete',
				label: 'Delete',
				tone: 'danger',
				visible: canDelete,
				action: selectDeleteNode
			}
		]);
	});

	let menuItems = $derived.by((): MenuItem[] => {
		if (submenu) {
			return normalizeMenuItems(submenu);
		}
		return rootMenuItems;
	});

	let showMenu = $derived.by((): boolean => {
		if (submenu) {
			return menuItems.length > 0;
		}
		return contextNodeId !== null && activeNode !== null && menuItems.length > 0;
	});

	$effect(() => {
		if (submenu !== null || contextNodeId === null) {
			return;
		}
		if (menuItems.length > 0) {
			return;
		}
		closeMenu();
	});
</script>

{#if showMenu}
	<div
		class="gc-node-context-menu"
		role="menu"
		tabindex="-1"
		{@attach positionMenu(contextPosition.x + offsetX, contextPosition.y + offsetY)}
		transition:fly={{ x: -5, duration: 100 }}
		oncontextmenu={handleMenuContextMenu}>
		{#each menuItems as item, i (item.id ?? `menu-item-${i}`)}
			{#if item.separator}
				<hr class="gc-node-context-separator" />
			{:else}
				<button
					type="button"
					role="menuitem"
					class={`gc-node-context-item${item.disabled ? ' gc-node-context-item-disabled' : ''}${item.tone === 'danger' ? ' gc-node-context-item-danger' : ''}`}
					onclick={(event) => handleItemClick(event, item)}
					onmouseover={(event) => handleItemFocus(event, item)}
					onfocus={(event) => handleItemFocus(event, item)}>
					<span class="gc-node-context-item-label">{item.label}</span>
					{#if item.submenu}
						<span class="gc-node-context-item-chevron">></span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

{#if showMenu && activeSubMenu.items && activeSubMenu.items.length > 0}
	<div class="gc-node-context-submenu-container" {@attach captureSubmenuContainer()}>
		<Self submenu={activeSubMenu.items} offsetX={activeSubMenu.offsetX} offsetY={activeSubMenu.offsetY} />
	</div>
{/if}

{#if submenu === null}
	<input
		bind:this={colorInputElem}
		class="hidden-color-input"
		type="color"
		value={colorInputValue}
		oninput={applyPickedColor} />
{/if}

<style>
	.gc-node-context-menu {
		position: fixed;
		min-inline-size: 12rem;
		display: flex;
		flex-direction: column;
		padding: 0.25rem;
		border-radius: 0.45rem;
		border: 0.0625rem solid color-mix(in srgb, var(--gc-color-panel-outline) 75%, transparent);
		background: color-mix(in srgb, var(--gc-color-panel) 94%, black 6%);
		box-shadow: 0 0.5rem 1.25rem color-mix(in srgb, black 36%, transparent);
		z-index: 1300;
	}

	.gc-node-context-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		inline-size: 100%;
		min-block-size: 1.75rem;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--gc-color-text);
		font-size: 0.78rem;
		line-height: 1.2;
		text-align: start;
		cursor: pointer;
	}

	.gc-node-context-item:hover,
	.gc-node-context-item:focus-visible {
		background: color-mix(in srgb, var(--gc-color-selection) 24%, transparent);
		outline: none;
	}

	.gc-node-context-item-disabled {
		opacity: 0.45;
		pointer-events: none;
	}

	.gc-node-context-item-danger {
		color: color-mix(in srgb, #ffb3b3 80%, var(--gc-color-text) 20%);
	}

	.gc-node-context-item-danger:hover,
	.gc-node-context-item-danger:focus-visible {
		background: color-mix(in srgb, #ff6b6b 28%, transparent);
		color: color-mix(in srgb, white 90%, #ffb3b3 10%);
	}

	.gc-node-context-item-label {
		flex: 1 1 auto;
	}

	.gc-node-context-item-chevron {
		opacity: 0.75;
		font-size: 0.72rem;
	}

	.gc-node-context-separator {
		block-size: 0.0625rem;
		margin: 0.125rem 0;
		border: none;
		background: color-mix(in srgb, var(--gc-color-panel-outline) 45%, transparent);
	}

	.gc-node-context-submenu-container {
		position: fixed;
	}

	.hidden-color-input {
		position: fixed;
		inline-size: 0;
		block-size: 0;
		opacity: 0;
		pointer-events: none;
	}
</style>
