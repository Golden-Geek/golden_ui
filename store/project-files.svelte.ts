import { appState } from './workbench.svelte';
import type { WorkbenchSession } from './workbench.svelte';
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
const PROJECT_FILE_LOG_TAG = 'project-file';

export interface ProjectFileActionResult {
	ok: boolean;
	cancelled: boolean;
	message: string | null;
}

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

const projectFileActionSucceeded = (): ProjectFileActionResult => ({
	ok: true,
	cancelled: false,
	message: null
});

const projectFileActionCancelled = (): ProjectFileActionResult => ({
	ok: false,
	cancelled: true,
	message: null
});

const toProjectFileErrorMessage = (fallback: string, error: unknown): string => {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return `${fallback}: ${message}`;
		}
	}

	return fallback;
};

const appendProjectFileLog = (
	session: WorkbenchSession | null,
	level: 'warning' | 'error',
	message: string
): void => {
	session?.appendUiLogRecord(level, PROJECT_FILE_LOG_TAG, message);
};

const projectFileActionFailed = (
	session: WorkbenchSession | null,
	message: string,
	context: Record<string, unknown> = {},
	error?: unknown
): ProjectFileActionResult => {
	if (error === undefined) {
		console.warn('[project-files]', message, context);
	} else {
		console.error('[project-files]', message, context, error);
	}
	appendProjectFileLog(session, 'error', message);
	return {
		ok: false,
		cancelled: false,
		message
	};
};

type ProjectFileOperationStart =
	| { ok: true; session: WorkbenchSession }
	| { ok: false; message: string };

const startProjectFileOperation = (operationName: string): ProjectFileOperationStart => {
	const session = appState.session;
	if (!session) {
		const message = `${operationName} is unavailable because the project session is not ready.`;
		console.warn('[project-files]', message);
		return { ok: false, message };
	}

	if (projectFileState.busy) {
		const message = `${operationName} is already in progress.`;
		console.warn('[project-files]', message);
		appendProjectFileLog(session, 'warning', message);
		return { ok: false, message };
	}

	projectFileState.busy = true;
	return { ok: true, session };
};

const finishProjectFileOperation = (): void => {
	projectFileState.busy = false;
};

const saveProjectAtPath = async (
	session: WorkbenchSession,
	path: string
): Promise<ProjectFileActionResult> => {
	const normalizedPath = normalizeProjectFilePath(path);
	try {
		await session.client.projectSave(normalizedPath);
		setCurrentProjectPath(normalizedPath);
		rememberLastOpenedPath(normalizedPath);
		markProjectStateClean(session.currentHistoryStateId);
		return projectFileActionSucceeded();
	} catch (error) {
		return projectFileActionFailed(
			session,
			toProjectFileErrorMessage(`Failed to save project to "${normalizedPath}"`, error),
			{ path: normalizedPath },
			error
		);
	}
};

const loadProjectAtPath = async (session: WorkbenchSession, path: string): Promise<boolean> => {
	try {
		await session.client.projectLoad(path);
		await session.refreshSnapshot();
		setCurrentProjectPath(path);
		rememberLastOpenedPath(path);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		const message = toProjectFileErrorMessage(`Failed to open project "${path}"`, error);
		console.error('[project-files]', message, { path }, error);
		appendProjectFileLog(session, 'error', message);
		return false;
	}
};

export const createNewProjectFile = async (): Promise<boolean> => {
	const operation = startProjectFileOperation('Create new project');
	if (!operation.ok) {
		return false;
	}

	try {
		const { session } = operation;
		await session.client.projectNew();
		await session.refreshSnapshot();
		setCurrentProjectPath(null);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		const message = toProjectFileErrorMessage('Failed to create a new project', error);
		console.error('[project-files]', message, error);
		appendProjectFileLog(operation.session, 'error', message);
		return false;
	} finally {
		finishProjectFileOperation();
	}
};

const attemptSaveProjectFileAs = async (): Promise<ProjectFileActionResult> => {
	if (!hasDesktopHost()) {
		const message = 'Save As is only available in the desktop app right now.';
		console.info('[project-files]', message);
		appendProjectFileLog(appState.session, 'warning', message);
		return {
			ok: false,
			cancelled: false,
			message
		};
	}

	const operation = startProjectFileOperation('Save project');
	if (!operation.ok) {
		return {
			ok: false,
			cancelled: false,
			message: operation.message
		};
	}

	try {
		let path: string | null = null;
		try {
			path = await chooseSavePath(projectFileState.currentPath);
		} catch (error) {
			return projectFileActionFailed(
				operation.session,
				toProjectFileErrorMessage('Failed to open Save As', error),
				{},
				error
			);
		}

		if (!path) {
			return projectFileActionCancelled();
		}

		return saveProjectAtPath(operation.session, path);
	} finally {
		finishProjectFileOperation();
	}
};

export const attemptSaveProjectFile = async (): Promise<ProjectFileActionResult> => {
	const currentPath = projectFileState.currentPath;
	if (!currentPath) {
		return attemptSaveProjectFileAs();
	}

	const operation = startProjectFileOperation('Save project');
	if (!operation.ok) {
		return {
			ok: false,
			cancelled: false,
			message: operation.message
		};
	}

	try {
		return saveProjectAtPath(operation.session, currentPath);
	} finally {
		finishProjectFileOperation();
	}
};

export const saveProjectFile = async (): Promise<boolean> => (await attemptSaveProjectFile()).ok;

export const saveProjectFileAs = async (): Promise<boolean> =>
	(await attemptSaveProjectFileAs()).ok;

export const openProjectFile = async (): Promise<boolean> => {
	if (!hasDesktopHost()) {
		console.info('[project-files] browser open uses the File menu upload flow.');
		return false;
	}

	const operation = startProjectFileOperation('Open project');
	if (!operation.ok) {
		return false;
	}

	try {
		const path = await chooseOpenPath();
		if (!path) {
			return false;
		}
		return loadProjectAtPath(operation.session, path);
	} finally {
		finishProjectFileOperation();
	}
};

export const reopenLastProjectFile = async (): Promise<boolean> => {
	const preferredPath = projectFileState.currentPath ?? projectFileState.lastOpenedPath;
	if (!preferredPath) {
		return false;
	}

	const operation = startProjectFileOperation('Open project');
	if (!operation.ok) {
		return false;
	}

	try {
		return loadProjectAtPath(operation.session, preferredPath);
	} finally {
		finishProjectFileOperation();
	}
};

export const uploadProjectFileAndLoad = async (file: File): Promise<boolean> => {
	const operation = startProjectFileOperation('Open project');
	if (!operation.ok) {
		return false;
	}

	try {
		const { session } = operation;
		const contents = await file.text();
		const path = await session.client.projectUploadLoad(file.name, contents);
		await session.refreshSnapshot();
		setCurrentProjectPath(path);
		rememberLastOpenedPath(path);
		markProjectStateClean(0);
		return true;
	} catch (error) {
		const message = toProjectFileErrorMessage(
			`Failed to load uploaded project "${file.name}"`,
			error
		);
		console.error('[project-files]', message, { fileName: file.name }, error);
		appendProjectFileLog(operation.session, 'error', message);
		return false;
	} finally {
		finishProjectFileOperation();
	}
};
