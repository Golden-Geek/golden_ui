<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import ColorPicker from './ColorPicker.svelte';
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
		keepMenuOpen?: boolean;
		showsChevron?: boolean;
		action?: (event: MouseEvent) => void;
	};

	interface ResolvedNodeTarget {
		nodeId: NodeId;
		host: HTMLElement;
	}

	let session = $derived(appState.session);
	let graphState = $derived(session?.graph.state ?? null);
	let contextNodeId = $derived(nodeContextMenuState.nodeId);
	let contextPosition = $derived(nodeContextMenuState.position);
	let menuDiv: HTMLDivElement | null = $state(null);
	let colorSubMenuDiv: HTMLDivElement | null = $state(null);

	let colorSubMenu = $state({
		open: false,
		rowOffsetY: 0
	});
	let isColorEditing = $state(false);

	const closeColorSubMenu = (): void => {
		colorSubMenu.open = false;
		colorSubMenu.rowOffsetY = 0;
		isColorEditing = false;
	};

	const closeMenu = (): void => {
		closeColorSubMenu();
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

			if (!item.label || item.label.trim().length === 0) {
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

	const applyPanelPosition = (node: HTMLElement, desiredLeft: number, desiredTop: number): void => {
		const clamped = clampPosition(node, desiredLeft, desiredTop);
		node.style.left = `${clamped.left}px`;
		node.style.top = `${clamped.top}px`;
	};

	const updateColorSubMenuPosition = (): void => {
		if (!menuDiv || !colorSubMenuDiv || !colorSubMenu.open) {
			return;
		}
		const menuRect = menuDiv.getBoundingClientRect();
		const desiredLeft = menuRect.right + remToPx(0.35);
		const desiredTop = menuRect.top + colorSubMenu.rowOffsetY;
		applyPanelPosition(colorSubMenuDiv, desiredLeft, desiredTop);
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
				applyPanelPosition(node, x, y);
				updateColorSubMenuPosition();
			});

			return () => {
				cancelAnimationFrame(raf);
				if (menuDiv === node) {
					menuDiv = null;
				}
			};
		};
	};

	const captureColorSubMenuContainer = () => {
		return (node: HTMLDivElement) => {
			colorSubMenuDiv = node;
			let raf = requestAnimationFrame(() => {
				updateColorSubMenuPosition();
			});
			return () => {
				cancelAnimationFrame(raf);
				if (colorSubMenuDiv === node) {
					colorSubMenuDiv = null;
				}
			};
		};
	};

	const updateRootMenuPosition = (): void => {
		if (contextNodeId === null || !menuDiv) {
			return;
		}
		applyPanelPosition(menuDiv, contextPosition.x, contextPosition.y);
		updateColorSubMenuPosition();
	};

	const handleItemClick = (event: MouseEvent, item: MenuItem): void => {
		event.stopPropagation();
		if (item.disabled || item.separator) {
			return;
		}
		item.action?.(event);
		if (!item.keepMenuOpen) {
			closeMenu();
		}
	};

	const handleMenuContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	const isInsideCurrentMenuTree = (target: EventTarget | null): boolean => {
		if (!(target instanceof Node)) {
			return false;
		}
		return menuDiv?.contains(target) === true || colorSubMenuDiv?.contains(target) === true;
	};

	const handleWindowContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();

		if (isInsideCurrentMenuTree(event.target)) {
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
		closeColorSubMenu();
	};

	const handleDocumentPointerDown = (event: PointerEvent): void => {
		if (contextNodeId === null) {
			return;
		}
		if (isInsideCurrentMenuTree(event.target)) {
			return;
		}
		closeMenu();
	};

	const handleDocumentKeydown = (event: KeyboardEvent): void => {
		if (contextNodeId === null) {
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
		if (contextNodeId === null) {
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
		Boolean(
			activeNode?.meta.user_permissions.can_edit_constraints && activeNode.data.kind === 'parameter'
		)
	);

	const clamp01 = (value: number): number => {
		if (!Number.isFinite(value)) {
			return 0;
		}
		return Math.max(0, Math.min(1, value));
	};

	const normalizeColor = (candidate: unknown): UiColorDto => {
		if (Array.isArray(candidate)) {
			return {
				r: clamp01(Number(candidate[0] ?? 0)),
				g: clamp01(Number(candidate[1] ?? 0)),
				b: clamp01(Number(candidate[2] ?? 0)),
				a: clamp01(Number(candidate[3] ?? 1))
			};
		}
		if (candidate && typeof candidate === 'object') {
			const value = candidate as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
			return {
				r: clamp01(Number(value.r ?? 0)),
				g: clamp01(Number(value.g ?? 0)),
				b: clamp01(Number(value.b ?? 0)),
				a: clamp01(Number(value.a ?? 1))
			};
		}
		return { r: 1, g: 1, b: 1, a: 1 };
	};

	const currentNodeColor = (node: UiNodeDto | null): UiColorDto => {
		const color = node?.meta.presentation?.color;
		return {
			r: clamp01(color?.r ?? 1),
			g: clamp01(color?.g ?? 1),
			b: clamp01(color?.b ?? 1),
			a: clamp01(color?.a ?? 1)
		};
	};

	let activeNodeColor = $derived.by((): UiColorDto => {
		return currentNodeColor(activeNode);
	});
	let colorDraft = $state<UiColorDto>({ r: 1, g: 1, b: 1, a: 1 });

	$effect(() => {
		if (isColorEditing) {
			return;
		}
		colorDraft = activeNodeColor;
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
				: (activeNode?.node_type ?? 'Node');
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

	const openColorSubMenu = (event: MouseEvent): void => {
		if (!canSetColor || !menuDiv) {
			return;
		}
		const currentTarget = event.currentTarget as HTMLElement | null;
		if (!currentTarget) {
			return;
		}

		const menuRect = menuDiv.getBoundingClientRect();
		const rowRect = currentTarget.getBoundingClientRect();
		colorSubMenu.rowOffsetY = rowRect.top - menuRect.top;
		colorSubMenu.open = true;

		queueMicrotask(() => {
			updateColorSubMenuPosition();
		});
	};

	const applyPickedColor = (nextColor: unknown): void => {
		if (!activeNode || !canSetColor) {
			return;
		}
		const normalized = normalizeColor(nextColor);
		colorDraft = normalized;
		setNodeColor(normalized);
	};

	const startColorEdit = (): void => {
		isColorEditing = true;
	};

	const endColorEdit = (): void => {
		isColorEditing = false;
	};

	const setConstraints = (): void => {
		if (!canSetConstraints || !activeNode || activeNode.data.kind !== 'parameter') {
			return;
		}
		void copyTextToClipboard(JSON.stringify(activeNode.data.param.constraints, null, 2));
		console.warn(
			'[ui] set constraints intent is not available yet; copied current constraints JSON'
		);
	};

	const selectCopyScriptControlPath = (_event: MouseEvent): void => {
		copyScriptControlPath();
	};

	const selectSetColor = (event: MouseEvent): void => {
		if (colorSubMenu.open) {
			closeColorSubMenu();
			return;
		}
		openColorSubMenu(event);
	};

	const selectSetConstraints = (_event: MouseEvent): void => {
		setConstraints();
	};

	const selectDuplicateNode = (_event: MouseEvent): void => {
		duplicateNode();
	};

	const selectDeleteNode = (_event: MouseEvent): void => {
		deleteNode();
	};

	let rootMenuItems = $derived.by((): MenuItem[] => {
		if (!activeNode) {
			return [];
		}

		const items: MenuItem[] = [
			{
				id: 'copy-script-control-path',
				label: 'Copy Script Control Path',
				action: selectCopyScriptControlPath
			}
		];

		if (canSetColor || canSetConstraints) {
			items.push({ separator: true });
		}
		if (canSetColor) {
			items.push({
				id: 'set-color',
				label: 'Set Color',
				keepMenuOpen: true,
				// showsChevron: true,
				action: selectSetColor
			});
		}
		if (canSetConstraints) {
			items.push({
				id: 'set-constraints',
				label: 'Set Constraints',
				action: selectSetConstraints
			});
		}

		if (canDuplicate || canDelete) {
			items.push({ separator: true });
		}
		if (canDuplicate) {
			items.push({
				id: 'duplicate',
				label: 'Duplicate',
				action: selectDuplicateNode
			});
		}
		if (canDelete) {
			items.push({
				id: 'delete',
				label: 'Delete',
				tone: 'danger',
				action: selectDeleteNode
			});
		}

		return normalizeMenuItems(items);
	});

	let menuItems = $derived(rootMenuItems);
	let showMenu = $derived(contextNodeId !== null && activeNode !== null && menuItems.length > 0);
	let showColorSubMenu = $derived(showMenu && colorSubMenu.open && canSetColor);

	$effect(() => {
		if (contextNodeId === null) {
			return;
		}
		if (menuItems.length > 0) {
			return;
		}
		closeMenu();
	});

	$effect(() => {
		if (canSetColor || !colorSubMenu.open) {
			return;
		}
		closeColorSubMenu();
	});

	$effect(() => {
		if (!showColorSubMenu) {
			return;
		}
		queueMicrotask(() => {
			updateColorSubMenuPosition();
		});
	});
</script>

{#if showMenu}
	<div
		class="gc-node-context-menu"
		role="menu"
		tabindex="-1"
		{@attach positionMenu(contextPosition.x, contextPosition.y)}
		transition:fly={{x:-10, duration: 100 }}
		oncontextmenu={handleMenuContextMenu}>
		{#each menuItems as item, i (item.id ?? `menu-item-${i}`)}
			{#if item.separator}
				<hr class="gc-node-context-separator" />
			{:else}
				<button
					type="button"
					role="menuitem"
					class={`gc-node-context-item${item.disabled ? ' gc-node-context-item-disabled' : ''}${item.tone === 'danger' ? ' gc-node-context-item-danger' : ''}${item.id === 'set-color' && showColorSubMenu ? ' gc-node-context-item-open' : ''}`}
					onclick={(event) => handleItemClick(event, item)}>
					<span class="gc-node-context-item-label">{item.label}</span>
					{#if item.showsChevron}
						<span class="arrow gc-node-context-item-chevron"></span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

{#if showColorSubMenu}
	<div
		class="gc-node-context-color-submenu"
		{@attach captureColorSubMenuContainer()}
		transition:slide={{ axis: 'x', duration: 150 }}>
		<ColorPicker
			forceExpanded={true}
			color={colorDraft}
			onchange={(nextColor: unknown) => {
				applyPickedColor(nextColor);
			}}
			onStartEdit={startColorEdit}
			onEndEdit={endColorEdit} />
	</div>
{/if}

<style>
	.gc-node-context-menu {
		position: fixed;
		min-inline-size: 12rem;
		display: flex;
		flex-direction: column;
		padding: 0.25rem;
		border-radius: 0.45rem;
		border: solid 1px rgba(255, 255, 255, 0.05);
		background: var(--gc-color-panel);
		color: var(--gc-color-text);
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
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}

	.gc-node-context-item:hover,
	.gc-node-context-item:focus-visible,
	.gc-node-context-item-open {
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

	.gc-node-context-color-submenu {
		position: fixed;
		min-inline-size: 16rem;
		max-inline-size: min(24rem, 42vw);
		z-index: 1301;
	}
</style>
