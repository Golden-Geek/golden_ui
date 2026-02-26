<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { sendReloadScript, sendSetScriptConfig } from '$lib/golden_ui/store/ui-intents';
	import type { NodeInspectorComponentProps } from '../node-inspector-registry';
	import type { UiScriptConfig, UiScriptRuntimeKind, UiScriptState } from '$lib/golden_ui/types';
	import SelectNodeButton from '../../../common/SelectNodeButton.svelte';

	let { node, defaultHeader, defaultChildren } = $props<NodeInspectorComponentProps>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let hasDesktopDialog = $derived(
		typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke)
	);

	let loading = $state(false);
	let applying = $state(false);
	let reloading = $state(false);
	let browsing = $state(false);
	let errorMessage = $state('');
	let scriptState = $state<UiScriptState | null>(null);
	let draftConfig = $state<UiScriptConfig | null>(null);
	let inlineCache = $state('');
	let fileCache = $state('');
	let loadVersion = 0;

	const cloneConfig = (config: UiScriptConfig): UiScriptConfig => ({
		...config,
		source:
			config.source.kind === 'inline'
				? { kind: 'inline', text: config.source.text }
				: { kind: 'projectFile', path: config.source.path }
	});

	const configsEqual = (left: UiScriptConfig, right: UiScriptConfig): boolean => {
		if (
			left.runtime_hint !== right.runtime_hint ||
			(left.project_root ?? '') !== (right.project_root ?? '')
		) {
			return false;
		}

		if (left.source.kind !== right.source.kind) {
			return false;
		}

		if (left.source.kind === 'inline' && right.source.kind === 'inline') {
			return left.source.text === right.source.text;
		}

		if (left.source.kind === 'projectFile' && right.source.kind === 'projectFile') {
			return left.source.path === right.source.path;
		}

		return false;
	};

	let isDirty = $derived(
		Boolean(scriptState && draftConfig && !configsEqual(scriptState.config, draftConfig))
	);
	let exportNames = $derived.by(() => {
		if (!scriptState) {
			return [] as string[];
		}

		const names = new Set<string>();
		for (const name of scriptState.export_names) {
			if (typeof name === 'string' && name.length > 0) {
				names.add(name);
			}
		}
		for (const entry of scriptState.manifest?.exports ?? []) {
			if (entry.name.length > 0) {
				names.add(entry.name);
			}
		}
		return [...names];
	});

	const toErrorMessage = (error: unknown): string =>
		error instanceof Error ? error.message : 'Unknown error';

	const loadScriptState = async (): Promise<void> => {
		if (!session || liveNode.node_type !== 'script') {
			return;
		}

		const currentVersion = ++loadVersion;
		loading = true;
		errorMessage = '';

		try {
			const nextState = await session.client.scriptState(liveNode.node_id);
			if (currentVersion !== loadVersion) {
				return;
			}

			scriptState = nextState;
			draftConfig = cloneConfig(nextState.config);
			if (nextState.config.source.kind === 'inline') {
				inlineCache = nextState.config.source.text;
			} else {
				fileCache = nextState.config.source.path;
			}
		} catch (error) {
			if (currentVersion !== loadVersion) {
				return;
			}
			scriptState = null;
			draftConfig = null;
			errorMessage = `Failed to fetch script state: ${toErrorMessage(error)}`;
		} finally {
			if (currentVersion === loadVersion) {
				loading = false;
			}
		}
	};

	$effect(() => {
		const currentSession = session;
		const currentNodeType = liveNode.node_type;
		const currentNodeId = liveNode.node_id;
		void currentNodeId;

		if (!currentSession || currentNodeType !== 'script') {
			scriptState = null;
			draftConfig = null;
			errorMessage = '';
			loading = false;
			return;
		}

		void loadScriptState();
	});

	const patchDraft = (apply: (config: UiScriptConfig) => UiScriptConfig): void => {
		if (!draftConfig) {
			return;
		}
		draftConfig = apply(draftConfig);
	};

	const setSourceKind = (kind: 'inline' | 'projectFile'): void => {
		if (!draftConfig || draftConfig.source.kind === kind) {
			return;
		}

		if (draftConfig.source.kind === 'inline') {
			inlineCache = draftConfig.source.text;
		} else {
			fileCache = draftConfig.source.path;
		}

		if (kind === 'inline') {
			patchDraft((config) => ({
				...config,
				source: { kind: 'inline', text: inlineCache }
			}));
			return;
		}

		patchDraft((config) => ({
			...config,
			source: { kind: 'projectFile', path: fileCache }
		}));
	};

	const setRuntimeHint = (value: string): void => {
		patchDraft((config) => ({
			...config,
			runtime_hint:
				value === 'luau' || value === 'quickJs' ? (value as UiScriptRuntimeKind) : undefined
		}));
	};

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
			console.error(`[script-node] ${command} failed`, error);
			return undefined;
		}
	};

	const browseFile = async (): Promise<void> => {
		if (
			!draftConfig ||
			draftConfig.source.kind !== 'projectFile' ||
			!hasDesktopDialog ||
			browsing
		) {
			return;
		}

		browsing = true;
		try {
			const selected = await invokeAppCommand('open_file_dialog', {
				allowed_extensions: ['lua', 'luau', 'js', 'mjs', 'cjs']
			});
			if (typeof selected === 'string' && selected.length > 0) {
				fileCache = selected;
				patchDraft((config) => ({
					...config,
					source: { kind: 'projectFile', path: selected }
				}));
			}
		} finally {
			browsing = false;
		}
	};

	const applyConfig = async (forceReload: boolean): Promise<void> => {
		if (!draftConfig || applying) {
			return;
		}
		applying = true;
		errorMessage = '';
		const ok = await sendSetScriptConfig(liveNode.node_id, draftConfig, forceReload);
		applying = false;

		if (!ok) {
			errorMessage = 'Failed to apply script configuration.';
			return;
		}

		await loadScriptState();
	};

	const reloadRuntime = async (): Promise<void> => {
		if (reloading) {
			return;
		}
		reloading = true;
		errorMessage = '';
		const ok = await sendReloadScript(liveNode.node_id);
		reloading = false;
		if (!ok) {
			errorMessage = 'Failed to request script runtime reload.';
			return;
		}
		await loadScriptState();
	};
</script>

{#snippet scriptHeaderExtra()}
	<SelectNodeButton {node} />
{/snippet}

{#if liveNode.node_type === 'script'}
	{@render defaultHeader?.(scriptHeaderExtra)}
	<div class="node-inspector-content script-node-inspector">
		<div class="toolbar">
			<button type="button" class="ghost" disabled={loading} onclick={() => void loadScriptState()}>
				Refresh
			</button>
			<button
				type="button"
				class="primary"
				disabled={!draftConfig || applying || !isDirty}
				onclick={() => {
					void applyConfig(false);
				}}>
				{applying ? 'Applying...' : 'Apply'}
			</button>
			<button
				type="button"
				class="ghost"
				disabled={!draftConfig || applying || reloading}
				onclick={() => {
					void reloadRuntime();
				}}>
				{reloading ? 'Reloading...' : 'Reload Runtime'}
			</button>
		</div>

		{#if loading}
			<div class="status">Loading script state...</div>
		{:else if !draftConfig || !scriptState}
			<div class="status error">
				{errorMessage || 'Script state unavailable for this node.'}
			</div>
		{:else}
			<div class="config-grid">
				<label>
					<span>Source</span>
					<select
						value={draftConfig.source.kind}
						onchange={(event) => {
							setSourceKind((event.target as HTMLSelectElement).value as 'inline' | 'projectFile');
						}}>
						<option value="inline">Inline</option>
						<option value="projectFile">Project File</option>
					</select>
				</label>

				<label>
					<span>Runtime Hint</span>
					<select
						value={draftConfig.runtime_hint ?? ''}
						onchange={(event) => {
							setRuntimeHint((event.target as HTMLSelectElement).value);
						}}>
						<option value="">Auto</option>
						<option value="luau">Luau</option>
						<option value="quickJs">QuickJS</option>
					</select>
				</label>
			</div>

			{#if draftConfig.source.kind === 'inline'}
				<label class="source-label">
					<span>Inline Script</span>
					<textarea
						value={draftConfig.source.text}
						oninput={(event) => {
							const value = (event.target as HTMLTextAreaElement).value;
							inlineCache = value;
							patchDraft((config) => ({
								...config,
								source: { kind: 'inline', text: value }
							}));
						}}></textarea>
				</label>
			{:else}
				<div class="file-source-row">
					<input
						type="text"
						value={draftConfig.source.path}
						placeholder="Select script file"
						onchange={(event) => {
							const value = (event.target as HTMLInputElement).value;
							fileCache = value;
							patchDraft((config) => ({
								...config,
								source: { kind: 'projectFile', path: value }
							}));
						}} />
					<button
						type="button"
						disabled={!hasDesktopDialog || browsing}
						onclick={() => {
							void browseFile();
						}}>
						{browsing ? '...' : 'Browse'}
					</button>
				</div>
				<label class="project-root-field">
					<span>Project Root (optional)</span>
					<input
						type="text"
						value={draftConfig.project_root ?? ''}
						placeholder="Project root path"
						onchange={(event) => {
							const value = (event.target as HTMLInputElement).value.trim();
							patchDraft((config) => ({
								...config,
								project_root: value.length > 0 ? value : undefined
							}));
						}} />
				</label>
				{#if !hasDesktopDialog}
					<div class="status subtle">Desktop file picker unavailable. Enter the path manually.</div>
				{/if}
			{/if}

			<div class="runtime-summary">
				<div><strong>Runtime:</strong> {scriptState.runtime_kind ?? 'not loaded'}</div>
				<div>
					<strong>Effective Update Rate:</strong>
					{scriptState.effective_update_rate_hz
						? `${scriptState.effective_update_rate_hz} Hz`
						: 'passive'}
				</div>
				<div>
					<strong>Manifest API:</strong>
					{scriptState.manifest ? scriptState.manifest.api_version : 'not loaded'}
				</div>
			</div>

			{#if exportNames.length > 0}
				<div class="exports">
					<strong>Exports</strong>
					<div class="export-list">
						{#each exportNames as name}
							<span class="export-chip">{name}</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if errorMessage}
				<div class="status error">{errorMessage}</div>
			{/if}
		{/if}
	</div>

	{@render defaultChildren?.()}
{/if}

<style>
	.script-node-inspector {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.35rem;
		border-radius: 0.45rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		font-size: 0.72rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.toolbar button {
		height: 1.5rem;
		padding: 0 0.55rem;
		border-radius: 0.3rem;
		font-size: 0.68rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-color);
	}

	.toolbar button.primary {
		background: rgb(from var(--gc-color-primary) r g b / 30%);
		border-color: rgb(from var(--gc-color-primary) r g b / 60%);
	}

	.toolbar button:disabled {
		opacity: 0.5;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem 0.5rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		flex: 1;
	}

	label > span {
		font-size: 0.64rem;
		opacity: 0.8;
	}

	input,
	select,
	textarea {
		border: solid 0.06rem rgba(255, 255, 255, 0.16);
		border-radius: 0.25rem;
		color: var(--text-color);
		font-size: 0.7rem;
		padding: 0.25rem 0.35rem;
		box-sizing: border-box;
	}

	input,
	textarea {
		background-color: var(--bg-color);
		line-height: 1.3;
	}

	textarea {
		min-height: 12rem;
		resize: vertical;
		font-family: 'Cascadia Code', 'Consolas', monospace;
		line-height: 1.3;
		flex: 1;
	}

	.source-label,
	.project-root-field {
		margin-top: 0.2rem;
	}

	.file-source-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.file-source-row input {
		flex: 1 1 auto;
		min-width: 0;
	}

	.file-source-row button {
		height: 1.5rem;
		padding: 0 0.5rem;
		border-radius: 0.3rem;
		font-size: 0.68rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-color);
	}

	.runtime-summary {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		font-size: 0.66rem;
		opacity: 0.88;
	}

	.exports {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.export-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.export-chip {
		display: inline-flex;
		align-items: center;
		height: 1.25rem;
		padding: 0 0.4rem;
		border-radius: 999rem;
		font-size: 0.62rem;
		border: solid 0.06rem rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.04);
	}

	.status {
		font-size: 0.66rem;
		opacity: 0.86;
	}

	.status.subtle {
		opacity: 0.65;
	}

	.status.error {
		color: var(--gc-color-warning);
		opacity: 1;
	}

	@media (max-width: 50rem) {
		.config-grid,
		.runtime-summary {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
