import { appState } from './workbench.svelte';
import { openDesktopFileDialog, saveDesktopFileDialog } from '../host/desktop';

export const projectFileState = $state({
	currentPath: null as string | null,
	lastOpenedPath: null as string | null,
	busy: false
});

const chooseOpenPath = async (): Promise<string | null> => {
	return openDesktopFileDialog({
		allowedExtensions: ['json'],
		logTag: 'project-files'
	});
};

const chooseSavePath = async (suggestedPath: string | null): Promise<string | null> => {
	return saveDesktopFileDialog({
		suggestedPath,
		allowedExtensions: ['json'],
		logTag: 'project-files'
	});
};

const saveProjectAtPath = async (path: string): Promise<boolean> => {
	const session = appState.session;
	if (!session || projectFileState.busy) {
		return false;
	}
	projectFileState.busy = true;
	try {
		await session.client.projectSave(path);
		projectFileState.currentPath = path;
		projectFileState.lastOpenedPath = path;
		return true;
	} catch (error) {
		console.error('[project-files] save failed', { path }, error);
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
		projectFileState.currentPath = path;
		projectFileState.lastOpenedPath = path;
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
		projectFileState.currentPath = null;
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
	return saveProjectFileAs();
};

export const saveProjectFileAs = async (): Promise<boolean> => {
	const path = await chooseSavePath(projectFileState.currentPath);
	if (!path) {
		return false;
	}
	return saveProjectAtPath(path);
};

export const openProjectFile = async (): Promise<boolean> => {
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
