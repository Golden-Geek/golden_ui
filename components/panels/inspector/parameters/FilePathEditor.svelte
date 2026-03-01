<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiFileTypeGroup, UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	const GROUP_EXTENSIONS: Record<UiFileTypeGroup, string[]> = {
		audio: ['wav', 'wave', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'opus', 'm4a', 'aac', 'wma'],
		video: ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'ts', 'm2ts', 'flv'],
		script: ['js', 'mjs', 'cjs']
	};

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let fileConstraints = $derived(param?.constraints.file);
	let value = $derived(param?.value.kind === 'file' ? param.value.value : '');
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let hasDesktopDialog = $derived(
		typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke)
	);

	let draftValue = $state('');
	let isPicking = $state(false);

	const normalizeExtension = (value: string): string | null => {
		const normalized = value.trim().replace(/^\.+/, '').toLowerCase();
		return normalized.length > 0 ? normalized : null;
	};

	const collectAllowedExtensions = (): string[] => {
		const explicit = new Set<string>();
		const fromTypes = new Set<string>();

		for (const value of fileConstraints?.allowed_extensions ?? []) {
			const normalized = normalizeExtension(value);
			if (normalized) {
				explicit.add(normalized);
			}
		}

		for (const group of fileConstraints?.allowed_types ?? []) {
			for (const extension of GROUP_EXTENSIONS[group] ?? []) {
				const normalized = normalizeExtension(extension);
				if (normalized) {
					fromTypes.add(normalized);
				}
			}
		}

		if (explicit.size > 0 && fromTypes.size > 0) {
			return [...explicit].filter((value) => fromTypes.has(value));
		}
		if (explicit.size > 0) {
			return [...explicit];
		}
		if (fromTypes.size > 0) {
			return [...fromTypes];
		}
		return [];
	};

	let allowedExtensions = $derived.by(collectAllowedExtensions);
	let hasConstraintHints = $derived(
		(fileConstraints?.allowed_types.length ?? 0) > 0 ||
			(fileConstraints?.allowed_extensions.length ?? 0) > 0
	);
	let allowedExtensionsLabel = $derived.by(() => {
		if (allowedExtensions.length === 0) {
			return 'Allowed: any extension';
		}
		return `Allowed: ${allowedExtensions.map((value) => `.${value}`).join(', ')}`;
	});

	$effect(() => {
		draftValue = value;
	});

	const invokeAppCommand = async (
		command: string,
		args?: Record<string, unknown>
	): Promise<unknown | undefined> => {
		const invoke = window.__TAURI_INTERNALS__?.invoke;
		if (!invoke) {
			return undefined;
		}
		try {
			return await invoke(command, args);
		} catch (error) {
			console.error(`[file-editor] ${command} failed.`, error);
			return undefined;
		}
	};

	const commitValue = (nextValue: string): void => {
		if (!param || param.value.kind !== 'file' || readOnly || !enabled) {
			return;
		}
		const normalized = nextValue.trim();
		if (normalized === value) {
			draftValue = normalized;
			return;
		}
		draftValue = normalized;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'file', value: normalized },
			param.event_behaviour
		);
	};

	const browseForFile = async (): Promise<void> => {
		if (!enabled || readOnly || !hasDesktopDialog || isPicking) {
			return;
		}
		isPicking = true;
		try {
			const selected = await invokeAppCommand('open_file_dialog', {
				allowed_extensions: allowedExtensions
			});
			if (typeof selected === 'string' && selected.length > 0) {
				commitValue(selected);
			}
		} finally {
			isPicking = false;
		}
	};

	const clearValue = (): void => {
		commitValue('');
	};
</script>

<div class="file-editor">
	<div class="file-input-row">
		<input
			type="text"
			class="path-input"
			value={draftValue}
			disabled={!enabled}
			class:readonly={readOnly}
			placeholder="Select a file path"
			onchange={(event) => {
				commitValue((event.target as HTMLInputElement).value);
			}}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					const target = event.target as HTMLInputElement;
					commitValue(target.value);
					target.blur();
				}
				if (event.key === 'Escape') {
					draftValue = value;
					(event.target as HTMLInputElement).blur();
				}
			}} />

		<button
			type="button"
			class="browse"
			disabled={!enabled || readOnly || !hasDesktopDialog || isPicking}
			onclick={() => {
				void browseForFile();
			}}>
			{isPicking ? '...' : 'Browse'}
		</button>

		<button
			type="button"
			class="clear"
			disabled={!enabled || readOnly || draftValue.length === 0}
			onclick={clearValue}>
			Clear
		</button>
	</div>

	{#if hasConstraintHints}
		<div class="constraints">{allowedExtensionsLabel}</div>
	{/if}
	{#if !hasDesktopDialog}
		<div class="desktop-hint">Desktop file browser unavailable in this client. Enter a path manually.</div>
	{/if}
</div>

<style>
	.file-editor {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 100%;
	}

	.file-input-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
	}

	.path-input {
		flex: 1 1 auto;
		min-width: 0;
		height: 1.3rem;
		padding-inline: 0.4rem;
		font-size: 0.72rem;
		box-sizing: border-box;
	}

	.browse,
	.clear {
		flex: 0 0 auto;
		height: 1.3rem;
		padding: 0 0.45rem;
		border-radius: 0.25rem;
		font-size: 0.68rem;
		background-color: rgb(from var(--gc-color-text) r g b / 9%);
		color: var(--gc-color-text);
		border: solid 0.05rem rgb(from var(--gc-color-text) r g b / 18%);
	}

	.browse:disabled,
	.clear:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.constraints,
	.desktop-hint {
		font-size: 0.62rem;
		opacity: 0.7;
		line-height: 1.2;
	}

	.desktop-hint {
		opacity: 0.55;
	}
</style>
