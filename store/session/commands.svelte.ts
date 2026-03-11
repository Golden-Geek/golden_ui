import type { NodeId, UiEditIntent, UiNodeDto } from '../../types';
import type { GraphStore } from '../graph.svelte';
import { registerCommandHandler, type CommandId } from '../commands.svelte';
import {
	createNewProjectFile,
	openProjectFile,
	reopenLastProjectFile,
	saveProjectFile,
	saveProjectFileAs
} from '../project-files.svelte';
import type { SelectionMode } from './types';

interface NodeClipboardEntry {
	node_type: string;
	label: string;
}

interface WorkbenchCommandSuiteOptions {
	graph: GraphStore;
	sendIntent(intent: UiEditIntent): Promise<void>;
	getSelectedNodes(): UiNodeDto[];
	getFirstSelectedNode(): UiNodeDto | null;
	getSelectedNodeIds(): NodeId[];
	selectNodes(nodeIds: NodeId[], selectionMode?: SelectionMode): void;
	undo(): Promise<void>;
	redo(): Promise<void>;
}

export interface WorkbenchCommandSuite {
	registerCommandHandlers(): () => void;
	reset(): void;
}

export const createWorkbenchCommandSuite = (
	options: WorkbenchCommandSuiteOptions
): WorkbenchCommandSuite => {
	let nodeClipboard = $state<NodeClipboardEntry[]>([]);

	const getNodeDepth = (nodeId: NodeId): number => {
		let depth = 0;
		let current = options.graph.state.parentById.get(nodeId);
		while (current !== undefined) {
			depth += 1;
			current = options.graph.state.parentById.get(current);
		}
		return depth;
	};

	const isNodeRemovable = (node: UiNodeDto): boolean => {
		if (options.graph.state.rootId === node.node_id) {
			return false;
		}
		return node.meta.user_permissions.can_remove_and_duplicate;
	};

	const isFolderNode = (node: UiNodeDto): boolean => node.node_type === 'folder';

	const canParentCreateNodeType = (parentId: NodeId, nodeType: string): boolean => {
		const parent = options.graph.state.nodesById.get(parentId);
		if (!parent) {
			return false;
		}
		return parent.creatable_user_items.some((item) => item.node_type === nodeType);
	};

	const nextLabelInParent = (parentId: NodeId, baseLabel: string): string => {
		const parent = options.graph.state.nodesById.get(parentId);
		if (!parent) {
			return baseLabel;
		}
		const usedLabels = new Set<string>();
		for (const childId of parent.children) {
			const sibling = options.graph.state.nodesById.get(childId);
			if (!sibling) {
				continue;
			}
			const label = sibling.meta.label.trim();
			if (label.length > 0) {
				usedLabels.add(label);
			}
		}

		if (!usedLabels.has(baseLabel)) {
			return baseLabel;
		}

		let suffix = 2;
		while (usedLabels.has(`${baseLabel} ${suffix}`)) {
			suffix += 1;
		}
		return `${baseLabel} ${suffix}`;
	};

	const waitForCreatedChild = async (
		parentId: NodeId,
		knownChildren: Set<NodeId>,
		expectedNodeType: string
	): Promise<NodeId | null> => {
		const deadline = Date.now() + 450;
		while (Date.now() <= deadline) {
			const parent = options.graph.state.nodesById.get(parentId);
			if (parent) {
				for (const childId of parent.children) {
					if (knownChildren.has(childId)) {
						continue;
					}
					const child = options.graph.state.nodesById.get(childId);
					if (!child) {
						continue;
					}
					if (child.node_type === expectedNodeType) {
						return childId;
					}
				}
			}
			await new Promise((resolve) => {
				setTimeout(resolve, 16);
			});
		}
		return null;
	};

	const waitForCreatedChildLabel = async (
		parentId: NodeId,
		knownChildren: Set<NodeId>,
		expectedLabel: string
	): Promise<NodeId | null> => {
		const deadline = Date.now() + 450;
		while (Date.now() <= deadline) {
			const parent = options.graph.state.nodesById.get(parentId);
			if (parent) {
				for (const childId of parent.children) {
					if (knownChildren.has(childId)) {
						continue;
					}
					const child = options.graph.state.nodesById.get(childId);
					if (!child) {
						continue;
					}
					if (child.meta.label.trim() === expectedLabel.trim()) {
						return childId;
					}
				}
			}
			await new Promise((resolve) => {
				setTimeout(resolve, 16);
			});
		}
		return null;
	};

	const createNodeUnderParent = async (
		parentId: NodeId,
		nodeType: string,
		label: string,
		insertAfterNodeId: NodeId | null
	): Promise<NodeId | null> => {
		const parentBefore = options.graph.state.nodesById.get(parentId);
		if (!parentBefore) {
			return null;
		}
		const knownChildren = new Set(parentBefore.children);
		await options.sendIntent({
			kind: 'createUserItem',
			parent: parentId,
			node_type: nodeType,
			label
		});
		const createdNodeId = await waitForCreatedChild(parentId, knownChildren, nodeType);
		if (createdNodeId === null || insertAfterNodeId === null) {
			return createdNodeId;
		}
		await options.sendIntent({
			kind: 'moveNode',
			node: createdNodeId,
			new_parent: parentId,
			new_prev_sibling: insertAfterNodeId
		});
		return createdNodeId;
	};

	const removeSelectedNodesCommand = async (): Promise<boolean> => {
		const selected = options.getSelectedNodes();
		if (selected.length === 0) {
			return false;
		}

		const removable = selected.filter((node) => isNodeRemovable(node));
		if (removable.length === 0) {
			return false;
		}

		removable.sort((left, right) => getNodeDepth(right.node_id) - getNodeDepth(left.node_id));
		await options.sendIntent({
			kind: 'removeNodes',
			nodes: removable.map((node) => node.node_id)
		});
		return true;
	};

	const selectSiblingNodesCommand = (): boolean => {
		const anchorNode = options.getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}
		const parentId = options.graph.state.parentById.get(anchorNode.node_id);
		if (parentId === undefined) {
			return false;
		}
		const parent = options.graph.state.nodesById.get(parentId);
		if (!parent || parent.children.length === 0) {
			return false;
		}
		options.selectNodes([...parent.children], 'REPLACE');
		return true;
	};

	const copySelectedNodesCommand = (): boolean => {
		const selected = options.getSelectedNodes();
		if (selected.length === 0) {
			return false;
		}
		nodeClipboard = selected.map((node) => ({
			node_type: node.node_type,
			label: node.meta.label.trim().length > 0 ? node.meta.label.trim() : node.node_type
		}));
		return true;
	};

	const cutSelectedNodesCommand = async (): Promise<boolean> => {
		if (!copySelectedNodesCommand()) {
			return false;
		}
		return removeSelectedNodesCommand();
	};

	const duplicateSelectedNodesCommand = async (): Promise<boolean> => {
		const selectedSet = new Set(options.getSelectedNodeIds());
		const anchorNode = options.getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}
		const parentId = options.graph.state.parentById.get(anchorNode.node_id);
		if (parentId === undefined) {
			return false;
		}
		const parent = options.graph.state.nodesById.get(parentId);
		if (!parent) {
			return false;
		}

		const selectedSiblingIds = parent.children.filter((childId) => selectedSet.has(childId));
		if (selectedSiblingIds.length === 0) {
			return false;
		}

		let insertAfterNodeId: NodeId | null =
			selectedSiblingIds[selectedSiblingIds.length - 1] ?? null;
		const createdNodeIds: NodeId[] = [];
		for (const sourceId of selectedSiblingIds) {
			const source = options.graph.state.nodesById.get(sourceId);
			if (!source) {
				continue;
			}
			if (!source.meta.user_permissions.can_remove_and_duplicate) {
				continue;
			}
			if (!canParentCreateNodeType(parentId, source.node_type)) {
				continue;
			}

			const baseLabel =
				source.meta.label.trim().length > 0
					? `${source.meta.label.trim()} Copy`
					: `${source.node_type} Copy`;
			const label = nextLabelInParent(parentId, baseLabel);
			const parentBefore = options.graph.state.nodesById.get(parentId);
			if (!parentBefore) {
				continue;
			}
			const knownChildren = new Set(parentBefore.children);
			await options.sendIntent({
				kind: 'duplicateNode',
				source: sourceId,
				new_parent: parentId,
				new_prev_sibling: insertAfterNodeId,
				label
			});
			const createdNodeId = await waitForCreatedChildLabel(parentId, knownChildren, label);
			if (createdNodeId === null) {
				continue;
			}
			createdNodeIds.push(createdNodeId);
			insertAfterNodeId = createdNodeId;
		}

		if (createdNodeIds.length === 0) {
			return false;
		}
		options.selectNodes(createdNodeIds, 'REPLACE');
		return true;
	};

	const pasteNodesCommand = async (): Promise<boolean> => {
		if (nodeClipboard.length === 0) {
			return false;
		}

		const anchorNode = options.getFirstSelectedNode();
		if (!anchorNode) {
			return false;
		}

		let targetParentId: NodeId | undefined;
		let insertAfterNodeId: NodeId | null = null;
		if (isFolderNode(anchorNode)) {
			targetParentId = anchorNode.node_id;
		} else {
			targetParentId = options.graph.state.parentById.get(anchorNode.node_id);
			insertAfterNodeId = anchorNode.node_id;
		}
		if (targetParentId === undefined) {
			return false;
		}

		const createdNodeIds: NodeId[] = [];
		for (const entry of nodeClipboard) {
			if (!canParentCreateNodeType(targetParentId, entry.node_type)) {
				continue;
			}
			const label = nextLabelInParent(targetParentId, entry.label);
			const createdNodeId = await createNodeUnderParent(
				targetParentId,
				entry.node_type,
				label,
				insertAfterNodeId
			);
			if (createdNodeId === null) {
				continue;
			}
			createdNodeIds.push(createdNodeId);
			if (insertAfterNodeId !== null) {
				insertAfterNodeId = createdNodeId;
			}
		}

		if (createdNodeIds.length === 0) {
			return false;
		}
		options.selectNodes(createdNodeIds, 'REPLACE');
		return true;
	};

	const registerCommandHandlers = (): (() => void) => {
		type CommandHandlerResult = boolean | void | Promise<boolean | void>;
		const cleanups: Array<() => void> = [];
		const bind = (
			commandId: CommandId,
			handler: () => CommandHandlerResult,
			priority = 10
		): void => {
			cleanups.push(registerCommandHandler(commandId, () => handler(), { priority }));
		};

		bind(
			'edit.undo',
			() => {
				void options.undo();
				return true;
			},
			20
		);
		bind(
			'edit.redo',
			() => {
				void options.redo();
				return true;
			},
			20
		);
		bind('edit.deleteSelection', () => removeSelectedNodesCommand(), 10);
		bind('select.all', () => selectSiblingNodesCommand(), 10);
		bind('edit.copy', () => copySelectedNodesCommand(), 10);
		bind('edit.cut', () => cutSelectedNodesCommand(), 10);
		bind('edit.duplicate', () => duplicateSelectedNodesCommand(), 10);
		bind('edit.paste', () => pasteNodesCommand(), 10);
		bind('file.new', () => createNewProjectFile(), 15);
		bind('file.save', () => saveProjectFile(), 15);
		bind('file.saveAs', () => saveProjectFileAs(), 15);
		bind('file.open', () => openProjectFile(), 15);
		bind('file.reopenLast', () => reopenLastProjectFile(), 15);

		return (): void => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		};
	};

	const reset = (): void => {
		nodeClipboard = [];
	};

	return {
		registerCommandHandlers,
		reset
	};
};
