import type { UiCreatableUserItem } from '../../types';
import { getIconURLForNodeType, getIconURLForCategory } from '../../store/node-types';
import type { ContextMenuItem } from './context-menu';

type CreateItemHandler = (item: UiCreatableUserItem) => void | Promise<void>;

type MenuEntry = MenuBranchEntry | MenuLeafEntry;

interface MenuBranchEntry {
	kind: 'branch';
	label: string;
	path: string[];
	children: MenuEntry[];
}

interface MenuLeafEntry {
	kind: 'leaf';
	item: UiCreatableUserItem;
}

const normalizeMenuPath = (path: readonly string[] | undefined): string[] => {
	return (path ?? []).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
};

const findOrCreateBranch = (
	entries: MenuEntry[],
	label: string,
	parentPath: readonly string[]
): MenuBranchEntry => {
	const existing = entries.find(
		(entry): entry is MenuBranchEntry => entry.kind === 'branch' && entry.label === label
	);
	if (existing) {
		return existing;
	}

	const branch = {
		kind: 'branch',
		label,
		path: [...parentPath, label],
		children: []
	} satisfies MenuBranchEntry;
	entries.push(branch);
	return branch;
};

const createLeafItem = (
	item: UiCreatableUserItem,
	onCreateItem: CreateItemHandler
): ContextMenuItem => ({
	id: `create:${[...normalizeMenuPath(item.menu_path), item.node_type, item.item_kind].join('/')}`,
	label: item.label,
	icon: getIconURLForNodeType(item.node_type, item.item_kind) ?? undefined,
	action: () => {
		void onCreateItem(item);
	}
});

const createBranchItem = (
	branch: MenuBranchEntry,
	onCreateItem: CreateItemHandler
): ContextMenuItem => ({
	id: `create-path:${branch.path.join('/')}`,
	label: branch.label,
	icon: getIconURLForCategory(branch.label) ?? undefined,
	submenu: finalizeEntries(branch.children, onCreateItem)
});

const finalizeEntries = (
	entries: readonly MenuEntry[],
	onCreateItem: CreateItemHandler
): ContextMenuItem[] => {
	const branches = entries.filter((entry): entry is MenuBranchEntry => entry.kind === 'branch');
	const leaves = entries.filter((entry): entry is MenuLeafEntry => entry.kind === 'leaf');

	const items = branches.map((branch) => createBranchItem(branch, onCreateItem));
	if (branches.length > 0 && leaves.length > 0) {
		items.push({ separator: true });
	}
	items.push(...leaves.map((leaf) => createLeafItem(leaf.item, onCreateItem)));
	return items;
};

export const buildCreatableItemMenu = (
	items: readonly UiCreatableUserItem[],
	onCreateItem: CreateItemHandler
): ContextMenuItem[] => {
	const rootEntries: MenuEntry[] = [];

	for (const item of items) {
		const path = normalizeMenuPath(item.menu_path);
		let entries = rootEntries;
		const parentPath: string[] = [];

		for (const segment of path) {
			const branch = findOrCreateBranch(entries, segment, parentPath);
			entries = branch.children;
			parentPath.push(segment);
		}

		entries.push({ kind: 'leaf', item });
	}

	return finalizeEntries(rootEntries, onCreateItem);
};
