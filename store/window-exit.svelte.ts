import {
	forceCloseDesktopWindow,
	hasDesktopHost,
	requestDesktopWindowClose,
	subscribeDesktopWindowCloseRequested
} from '../host/desktop';
import {
	hasPendingProjectChanges,
	projectFileDisplayName,
	projectFileState,
	saveProjectFile
} from './project-files.svelte';
import { appState } from './workbench.svelte';

export const windowExitState = $state({
	open: false,
	busy: false
});

const closeWindowImmediately = async (): Promise<boolean> => {
	if (hasDesktopHost()) {
		const result = await forceCloseDesktopWindow();
		if (result === undefined) {
			console.error('[window-exit] force close failed.');
			return false;
		}
		return true;
	}

	if (typeof window !== 'undefined') {
		window.close();
		return true;
	}

	return false;
};

const handleWindowCloseRequested = async (): Promise<void> => {
	if (windowExitState.busy) {
		return;
	}

	const currentHistoryStateId = appState.session?.currentHistoryStateId;
	if (hasPendingProjectChanges(currentHistoryStateId)) {
		windowExitState.open = true;
		return;
	}

	windowExitState.open = false;
	void closeWindowImmediately();
};

export const requestWindowExit = async (): Promise<void> => {
	if (windowExitState.busy) {
		return;
	}

	if (hasDesktopHost()) {
		const result = await requestDesktopWindowClose();
		if (result !== undefined) {
			return;
		}
	}

	await handleWindowCloseRequested();
};

export const cancelWindowExit = (): void => {
	if (windowExitState.busy) {
		return;
	}

	windowExitState.open = false;
};

export const confirmWindowExitDiscard = async (): Promise<boolean> => {
	if (windowExitState.busy) {
		return false;
	}

	windowExitState.open = false;
	const closed = await closeWindowImmediately();
	if (!closed) {
		windowExitState.open = true;
	}
	return closed;
};

export const confirmWindowExitSave = async (): Promise<boolean> => {
	if (windowExitState.busy) {
		return false;
	}

	windowExitState.busy = true;
	try {
		const saved = await saveProjectFile();
		if (!saved) {
			return false;
		}

		windowExitState.open = false;
		const closed = await closeWindowImmediately();
		if (!closed) {
			windowExitState.open = true;
		}
		return closed;
	} finally {
		windowExitState.busy = false;
	}
};

export const getWindowExitProjectName = (): string =>
	projectFileDisplayName(projectFileState.currentPath);

export const mountWindowExitHandling = (): (() => void) => {
	windowExitState.open = false;
	windowExitState.busy = false;

	return subscribeDesktopWindowCloseRequested(() => {
		void handleWindowCloseRequested();
	});
};
