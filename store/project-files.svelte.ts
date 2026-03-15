import { appState } from './workbench.svelte';
import { hasDesktopHost, openDesktopFileDialog, saveDesktopFileDialog } from '../host/desktop';
import { loadPersistedLastProjectPath, savePersistedLastProjectPath } from './ui-persistence';
import {
	normalizeProjectFilePath,
	projectFileDialogExtensions,
	projectFileDialogTitle,
	projectFileFilterLabel
} from './project-file-format.svelte';

export const BROWSER_PROJECT_DIRECTORY_LABEL = '~/Documents/Chataigne';
export const UNTITLED_PROJECT_LABEL = 'Untitled';

const normalizeProjectPath = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
};

export const projectFileDisplayName = (path: string | null | undefined): string => {
	const normalized = normalizeProjectPath(path);
	if (!normalized) {
		return UNTITLED_PROJECT_LABEL;
	}

	const segments = normalized.split(/[\\/]/);
	const lastSegment = segments[segments.length - 1]?.trim();
	return lastSegment && lastSegment.length > 0 ? lastSegment : normalized;
};

export const hasPendingProjectChanges = (historyStateId: number | null | undefined): boolean =>
	(historyStateId ?? 0) !== projectFileState.savedHistoryStateId;

const persistedLastProjectPath = loadPersistedLastProjectPath();

export const projectFileState = $state({
	currentPath: null as string | null,
	lastOpenedPath: normalizeProjectPath(persistedLastProjectPath),
	busy: false,
	savedHistoryStateId: 0
});

const setCurrentProjectPath = (path: string | null): void => {
	projectFileState.currentPath = normalizeProjectPath(path);
};

const rememberLastOpenedPath = (path: string | null): void => {
	const normalized = normalizeProjectPath(path);
	projectFileState.lastOpenedPath = normalized;
	savePersistedLastProjectPath(normalized);
};

const chooseOpenPath = async (): Promise<string | null> => {
	return openDesktopFileDialog({
		allowedExtensions: projectFileDialogExtensions(),
		filterLabel: projectFileFilterLabel(),
		title: projectFileDialogTitle('open'),
		logTag: 'project-files'
	});
};

const chooseSavePath = async (suggestedPath: string | null): Promise<string | null> => {
	return saveDesktopFileDialog({
		suggestedPath: normalizeProjectFilePath(suggestedPath ?? UNTITLED_PROJECT_LABEL),
		allowedExtensions: projectFileDialogExtensions(),
		filterLabel: projectFileFilterLabel(),
		title: projectFileDialogTitle('save'),
		logTag: 'project-files'
	});
};

const markProjectStateClean = (historyStateId = 0): void => {
	projectFileState.savedHistoryStateId = historyStateId;
};

const saveProjectAtPath = async (path: string): Promise<boolean> => {
	const session = appState.session;
	if (!session || projectFileState.busy) {
		return false;
	}
	const normalizedPath = normalizeProjectFilePath(path);
	projectFileState.busy = true;
	try {
		await session.client.projectSave(normalizedPath);
		setCurrentProjectPath(normalizedPath);
		rememberLastOpenedPath(normalizedPath);
		markProjectStateClean(session.currentHistoryStateId);
		return true;
	} catch (error) {
		console.error('[project-files] save failed', { path: normalizedPath }, error);
		return false;
	} finally {
		projectFileState.busy = false;
	}
};

const loadProjectAtPath = async (path: string): Promise<boolean> => {
	const session = appState.session;
	if (!session || projectFileState.busy) {
		return false;
	}
	projectFileState.busy = true;
	try {
		await session.client.projectLoad(path);
		await session.refreshSnapshot();
		setCurrentProjectPath(path);
		rememberLastOpenedPath(path);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		console.error('[project-files] load failed', { path }, error);
		return false;
	} finally {
		projectFileState.busy = false;
	}
};

export const createNewProjectFile = async (): Promise<boolean> => {
	const session = appState.session;
	if (!session || projectFileState.busy) {
		return false;
	}
	projectFileState.busy = true;
	try {
		await session.client.projectNew();
		await session.refreshSnapshot();
		setCurrentProjectPath(null);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		console.error('[project-files] new project failed', error);
		return false;
	} finally {
		projectFileState.busy = false;
	}
};

export const saveProjectFile = async (): Promise<boolean> => {
	if (projectFileState.currentPath) {
		return saveProjectAtPath(projectFileState.currentPath);
	}
	if (!hasDesktopHost()) {
		console.info('[project-files] browser save requires an existing project path.');
		return false;
	}
	return saveProjectFileAs();
};

export const saveProjectFileAs = async (): Promise<boolean> => {
	if (!hasDesktopHost()) {
		console.info('[project-files] browser save-as will be wired later.');
		return false;
	}
	const path = await chooseSavePath(projectFileState.currentPath);
	if (!path) {
		return false;
	}
	return saveProjectAtPath(path);
};

export const openProjectFile = async (): Promise<boolean> => {
	if (!hasDesktopHost()) {
		console.info('[project-files] browser open uses the File menu upload flow.');
		return false;
	}
	const path = await chooseOpenPath();
	if (!path) {
		return false;
	}
	return loadProjectAtPath(path);
};

export const reopenLastProjectFile = async (): Promise<boolean> => {
	const preferredPath = projectFileState.currentPath ?? projectFileState.lastOpenedPath;
	if (!preferredPath) {
		return false;
	}
	return loadProjectAtPath(preferredPath);
};

export const uploadProjectFileAndLoad = async (file: File): Promise<boolean> => {
	const session = appState.session;
	if (!session || projectFileState.busy) {
		return false;
	}

	projectFileState.busy = true;
	try {
		const contents = await file.text();
		const path = await session.client.projectUploadLoad(file.name, contents);
		await session.refreshSnapshot();
		setCurrentProjectPath(path);
		rememberLastOpenedPath(path);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		console.error('[project-files] browser upload load failed', { fileName: file.name }, error);
		return false;
	} finally {
		projectFileState.busy = false;
	}
};
