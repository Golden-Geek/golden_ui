export interface DesktopCommandArgs {
	[key: string]: unknown;
}

export interface DesktopFileDialogOptions {
	allowedExtensions?: string[];
	suggestedPath?: string | null;
	logTag?: string;
}

const normalizeDialogPath = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
};

export const hasDesktopHost = (): boolean =>
	typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke);

export const invokeDesktopCommand = async <T = unknown>(
	command: string,
	args?: DesktopCommandArgs,
	logTag = 'desktop-host'
): Promise<T | undefined> => {
	const invoke = window.__TAURI_INTERNALS__?.invoke;
	if (!invoke) {
		return undefined;
	}

	try {
		return (await invoke(command, args)) as T;
	} catch (error) {
		console.error(`[${logTag}] ${command} failed.`, error);
		return undefined;
	}
};

export const openDesktopFileDialog = async (
	options: DesktopFileDialogOptions = {}
): Promise<string | null> => {
	const selected = await invokeDesktopCommand<string | null>(
		'open_file_dialog',
		{
			allowed_extensions: options.allowedExtensions
		},
		options.logTag ?? 'desktop-host'
	);

	return normalizeDialogPath(selected);
};

export const saveDesktopFileDialog = async (
	options: DesktopFileDialogOptions = {}
): Promise<string | null> => {
	const selected = await invokeDesktopCommand<string | null>(
		'save_file_dialog',
		{
			suggested_path: options.suggestedPath ?? undefined,
			allowed_extensions: options.allowedExtensions
		},
		options.logTag ?? 'desktop-host'
	);

	return normalizeDialogPath(selected);
};
