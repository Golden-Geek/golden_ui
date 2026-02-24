import type { NodeId } from '$lib/golden_ui/types';

export const nodeContextMenuState = $state({
	nodeId: null as NodeId | null,
	position: { x: 0, y: 0 }
});

export const openNodeContextMenu = (nodeId: NodeId, x: number, y: number): void => {
	nodeContextMenuState.nodeId = nodeId;
	nodeContextMenuState.position = { x, y };
};

export const closeNodeContextMenu = (): void => {
	nodeContextMenuState.nodeId = null;
	nodeContextMenuState.position = { x: 0, y: 0 };
};
