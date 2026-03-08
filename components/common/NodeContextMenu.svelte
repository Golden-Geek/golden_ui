<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ContextMenu from './ContextMenu.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendPatchMetaIntent } from '$lib/golden_ui/store/ui-intents';
	import type { ContextMenuAnchor, ContextMenuItem } from './context-menu';
	import {
		closeNodeContextMenu,
		nodeContextMenuState,
		openNodeContextMenu
	} from '$lib/golden_ui/store/node-context-menu.svelte';
	import type { NodeId, UiColorDto, UiNodeDto } from '$lib/golden_ui/types';
	import { getMainViewportBounds, remToPx } from '$lib/golden_ui/components/common/floating-panel';
	import { getPanelByType, showPanel } from '$lib/golden_ui/store/ui-panels';
	import { PERSISTED_PANEL_STATE_KEY } from '$lib/golden_ui/dockview/panel-persistence';
	import copyPathIcon from '../../style/icons/copy.svg';
	import colorIcon from '../../style/icons/parameter/color.svg';
	import settingsIcon from '../../style/icons/settings.svg';
	import duplicateIcon from '../../style/icons/duplicate.svg';
	import deleteIcon from '../../style/icons/delete.svg';
	import watchIcon from '../../style/icons/watch.svg';

	interface ResolvedNodeTarget {
		nodeId: NodeId;
		host: HTMLElement;
	}

	interface InspectorPanelPersistedState {
		inspectorLocked: boolean;
		inspectorLockedNodeId: NodeId;
	}

	let session = $derived(appState.session);
	let graphState = $derived(session?.graph.state ?? null);
	let contextNodeId = $derived(nodeContextMenuState.nodeId);
	let contextPosition = $derived(nodeContextMenuState.position);
	let menuTreeDiv: HTMLDivElement | null = $state(null);
	let colorSubMenuDiv: HTMLDivElement | null = $state(null);
	let colorAnchorElement: HTMLElement | null = $state(null);

	let colorSubMenu = $state({
		open: false
	});
	let isColorEditing = $state(false);

	const closeColorSubMenu = (): void => {
		colorSubMenu.open = false;
		colorAnchorElement = null;
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
		if (!colorSubMenuDiv || !colorSubMenu.open || !colorAnchorElement) {
			return;
		}
		const anchorRect = colorAnchorElement.getBoundingClientRect();
		const desiredLeft = anchorRect.right + remToPx(0.35);
		const desiredTop = anchorRect.top;
		applyPanelPosition(colorSubMenuDiv, desiredLeft, desiredTop);
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

	const captureMenuTree = (node: HTMLDivElement | null): void => {
		menuTreeDiv = node;
	};

	const isInsideCurrentMenuTree = (target: EventTarget | null): boolean => {
		if (!(target instanceof Node)) {
			return false;
		}
		return menuTreeDiv?.contains(target) === true || colorSubMenuDiv?.contains(target) === true;
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
		updateColorSubMenuPosition();
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
			kind: 'duplicateNode',
			source: activeNode.node_id,
			new_parent: parentNode.node_id,
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
		if (!canSetColor) {
			return;
		}
		const currentTarget = event.currentTarget as HTMLElement | null;
		if (!currentTarget) {
			return;
		}
		colorAnchorElement = currentTarget;
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
		closeMenu();
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
		closeMenu();
	};

	const selectDuplicateNode = (_event: MouseEvent): void => {
		duplicateNode();
		closeMenu();
	};

	const selectDeleteNode = (_event: MouseEvent): void => {
		deleteNode();
		closeMenu();
	};

	const spawnLockedInspector = (targetNode: UiNodeDto): void => {
		const firstInspectorPanel = getPanelByType('inspector');
		const panelId = `inspector-watch-${targetNode.node_id}-${Date.now().toString(36)}-${Math.floor(
			Math.random() * 0x100000
		).toString(36)}`;

		showPanel({
			panelType: 'inspector',
			panelId,
			title: `Inspector: ${targetNode.meta.label}`,
			params: {
				[PERSISTED_PANEL_STATE_KEY]: {
					inspectorLocked: true,
					inspectorLockedNodeId: targetNode.node_id
				} satisfies InspectorPanelPersistedState
			},
			position: firstInspectorPanel
				? {
						referencePanelId: firstInspectorPanel.panelId,
						direction: 'within'
					}
				: undefined
		});
	};

	let rootMenuItems = $derived.by((): ContextMenuItem[] => {
		if (!activeNode) {
			return [];
		}

		const items: ContextMenuItem[] = [
			{
				id: 'copy-script-control-path',
				label: 'Copy Script Control Path',
				icon: copyPathIcon,
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
				icon: colorIcon,
				className: colorSubMenu.open ? 'gc-node-context-item-open' : '',
				action: selectSetColor
			});
		}
		if (canSetConstraints) {
			items.push({
				id: 'set-constraints',
				label: 'Set Constraints',
				icon: settingsIcon,
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
				commandId: 'edit.duplicate',
				icon: duplicateIcon,
				action: selectDuplicateNode
			});
		}
		if (canDelete) {
			items.push({
				id: 'delete',
				label: 'Delete',
				commandId: 'edit.deleteSelection',
				color: 'color-mix(in srgb, #ff8b8b 82%, white 18%)',
				hoverColor: 'color-mix(in srgb, #ff5c5c 23%, transparent)',
				icon: deleteIcon,
				action: selectDeleteNode
			});
		}
		items.push({ separator: true });
		items.push({
			id: 'watch',
			label: 'Watch in Inspector',
			icon: watchIcon,
			action: () => {
				if (!activeNode) {
					return;
				}
				session?.selectNode(activeNode.node_id);
				closeMenu();
			}
		});
		items.push({
			id: 'watch-locked-inspector',
			label: 'Watch in New Locked Inspector',
			icon: watchIcon,
			action: () => {
				if (!activeNode) {
					return;
				}
				spawnLockedInspector(activeNode);
				closeMenu();
			}
		});

		return items;
	});

	let menuAnchor = $derived.by((): ContextMenuAnchor | null => {
		if (contextNodeId === null) {
			return null;
		}
		return {
			kind: 'point',
			x: contextPosition.x,
			y: contextPosition.y
		};
	});
	let menuItems = $derived(rootMenuItems);
	let showMenu = $derived(contextNodeId !== null && activeNode !== null && menuItems.length > 0);
	let showColorSubMenu = $derived(
		showMenu && colorSubMenu.open && canSetColor && colorAnchorElement !== null
	);

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
		if (showMenu || !colorSubMenu.open) {
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

<ContextMenu
	open={showMenu}
	items={menuItems}
	anchor={menuAnchor}
	closeOnOutsidePointerDown={false}
	closeOnEscape={false}
	closeOnContextMenuOutside={false}
	closeOnSelect={false}
	minWidthRem={12}
	zIndex={1300}
	menuClassName="gc-node-context-menu"
	onMenuTreeMount={captureMenuTree} />

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
	:global(.gc-node-context-menu) {
		min-inline-size: 12rem;
	}

	:global(.gc-node-context-menu .gc-context-item) {
		font-size: 0.78rem;
	}

	:global(.gc-node-context-menu .gc-context-item.gc-node-context-item-open) {
		background: color-mix(in srgb, var(--gc-color-selection) 24%, transparent);
	}

	.gc-node-context-color-submenu {
		position: fixed;
		min-inline-size: 16rem;
		max-inline-size: min(24rem, 42vw);
		z-index: 1301;
	}
</style>
