<script lang="ts">
	import type { WorkbenchSession } from '$lib/golden_ui/store/workbench.svelte';
	import { onMount } from 'svelte';
	import { clearPersistedUiState } from '../../store/ui-persistence';

	let isWindowMaximized = $state(false);
	let hasTauriWindowApi = $state(false);

	const { session } = $props<{
		session?: WorkbenchSession | null;
	}>();

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
			console.error(`[window-controls] ${command} failed.`, error);
			return undefined;
		}
	};

	const refreshMaximizeState = async (): Promise<void> => {
		const maximized = await invokeAppCommand('window_is_maximized');
		isWindowMaximized = Boolean(maximized);
	};

	const minimizeWindow = async (): Promise<void> => {
		const result = await invokeAppCommand('window_minimize');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (minimize).');
		}
	};

	const toggleWindowMaximize = async (): Promise<void> => {
		const result = await invokeAppCommand('window_toggle_maximize');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (toggle maximize).');
			return;
		}
		await refreshMaximizeState();
	};

	const closeWindow = async (): Promise<void> => {
		const result = await invokeAppCommand('window_close');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (close).');
		}
	};

	const clearUiStorage = (): void => {
		clearPersistedUiState();
		if (typeof window !== 'undefined') {
			window.location.reload();
		}
	};

	onMount(() => {
		hasTauriWindowApi = Boolean(window.__TAURI_INTERNALS__?.invoke);
		if (!hasTauriWindowApi) {
			return;
		}

		void refreshMaximizeState();

		const onResize = () => {
			void refreshMaximizeState();
		};
		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
		};
	});
</script>

<div class="gc-header {hasTauriWindowApi ? 'tauri' : ''}" data-tauri-drag-region>
	<div class="app-title">Chataigne 2.0.0</div>
	<div class="spacer"></div>
	<div class="controls">
		<div class="history-actions">
			<button
				type="button"
				class="history-button clear-ui"
				title="Clear persisted UI state and reload"
				onclick={clearUiStorage}>
				Clear UI
			</button>
			<button
				type="button"
				class="history-button undo"
				title="Ctrl/Cmd+Z"
				disabled={session.historyBusy || !session.canUndo}
				onclick={() => void session.undo()}>
			</button>
			<button
				type="button"
				class="history-button redo"
				title="Ctrl/Cmd+Shift+Z or Ctrl+Y"
				disabled={session.historyBusy || !session.canRedo}
				onclick={() => void session.redo()}>
			</button>
		</div>
	</div>
	<div class="spacer"></div>
	{#if hasTauriWindowApi}
		<div class="app-buttons">
			<button
				type="button"
				class="minimize-app"
				aria-label="Minimize app"
				onclick={() => minimizeWindow()}>➖</button>
			<button
				type="button"
				class="maximize-app"
				aria-label="Maximize app"
				onclick={() => toggleWindowMaximize()}>🟩</button>
			<button type="button" class="close-app" aria-label="Close app" onclick={() => closeWindow()}
				>🔴</button>
		</div>
	{:else if session.status}
		<p class="status">{session.status}</p>
	{/if}
</div>

<style>
    .app-header
    {
    cursor: grab;
    }

	.history-actions {
		display: flex;
		gap: 0.25rem;
	}


    .history-actions button{
        transition: filter 0.2s ease, opacity 0.2s ease;
    }

    .history-actions button:hover:not(:disabled) {
        filter: brightness(1.2);
    }

	.clear-ui {
		background-color: rgb(200 200 200 / 20%);
		border: 1px solid rgb(from var(--gc-color-text) r g b / 20%);
		border-radius: 0.25rem;
		padding: 0.25rem 0.5rem;
		transition: opacity 0.2s;
		font-size: 0.6rem;
	}

	.undo,
	.redo {
		background-repeat: no-repeat;
		background-position: center;
		background-size: contain;
		box-sizing: border-box;
		width: 1.5rem;
		height: 1.5rem;
	}

	.undo {
		background-image: url('../../style/icons/undo.svg');
	}

	.redo {
		background-image: url('../../style/icons/redo.svg');
	}

	.undo:disabled,
	.redo:disabled {
		opacity: 0.5;
		cursor: default;
		pointer-events: none;
		touch-action: none;
	}

	.status,
	.app-buttons {
		width: 20%;
		text-align: right;
	}
</style>
