import { appState } from './workbench.svelte';

export const projectFileState = $state({
	currentPath: null as string | null,
	lastOpenedPath: null as string | null,
	busy: false
});

const invokeAppCommand = async <T = unknown>(
	command: string,
	args?: Record<string, unknown>
): Promise<T | undefined> => {
	const invoke = window.__TAURI_INTERNALS__?.invoke;
	if (!invoke) {
		return undefined;
	}

	try {
		return (await invoke(command, args)) as T;
	} catch (error) {
		console.error(`[project-files] ${command} failed.`, error);
		return undefined;
	}
};

const normalizePath = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
};

const chooseOpenPath = async (): Promise<string | null> => {
	const selected = await invokeAppCommand<string | null>('open_file_dialog', {
		allowed_extensions: ['json']
	});
	return normalizePath(selected);
};

const chooseSavePath = async (suggestedPath: string | null): Promise<string | null> => {
	const selected = await invokeAppCommand<string | null>('save_file_dialog', {
		suggested_path: suggestedPath ?? undefined,
		allowed_extensions: ['json']
	});
	return normalizePath(selected);
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
