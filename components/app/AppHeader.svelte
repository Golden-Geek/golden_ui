<script lang="ts">
	import type { WorkbenchSession } from '$lib/golden_ui/store/workbench.svelte';
	import { hasDesktopHost, invokeDesktopCommand } from '$lib/golden_ui/host/desktop';
	import { onMount } from 'svelte';
	import { clearPersistedUiState } from '../../store/ui-persistence';
	import { platform } from '../../store/platform.svelte';

	let isWindowMaximized = $state(false);
	let hasTauriWindowApi = $state(false);

	const { session } = $props<{
		session?: WorkbenchSession | null;
	}>();

	const refreshMaximizeState = async (): Promise<void> => {
		const maximized = await invokeDesktopCommand(
			'window_is_maximized',
			undefined,
			'window-controls'
		);
		isWindowMaximized = Boolean(maximized);
	};

	const minimizeWindow = async (): Promise<void> => {
		const result = await invokeDesktopCommand('window_minimize', undefined, 'window-controls');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (minimize).');
		}
	};

	const toggleWindowMaximize = async (): Promise<void> => {
		const result = await invokeDesktopCommand(
			'window_toggle_maximize',
			undefined,
			'window-controls'
		);
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (toggle maximize).');
			return;
		}
		await refreshMaximizeState();
	};

	const closeWindow = async (): Promise<void> => {
		const result = await invokeDesktopCommand('window_close', undefined, 'window-controls');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (close).');
		}
	};

	const startDrag = async (): Promise<void> => {
		if (platform.isWindows) return; //handle natively
		const result = await invokeDesktopCommand('start_drag', undefined, 'window-controls');
		if (result === undefined) {
			console.error('[window-controls] Tauri window API unavailable (start drag)');
		}
	};

	const clearUiStorage = (): void => {
		clearPersistedUiState();
		if (typeof window !== 'undefined') {
			window.location.reload();
		}
	};

	onMount(() => {
		hasTauriWindowApi = hasDesktopHost();
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

<div class="gc-header {hasTauriWindowApi ? 'tauri' : ''}">
	<div class="app-title">Chataigne 2.0.0</div>
	<div
		class="spacer"
		data-tauri-drag-region
		role="button"
		tabindex="-1"
		onmousedown={startDrag}
		onkeydown={() => {}}>
	</div>
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
	<div
		class="spacer"
		data-tauri-drag-region
		role="button"
		tabindex="-1"
		onmousedown={startDrag}
		onkeydown={() => {}}>
	</div>
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
	{:else}
		<div class="footer-status">
			<span class="status-badge {session.status}">
				<span class="status-dot" aria-hidden="true"></span>
				<span class="status-label">{session.status}</span>
			</span>
		</div>
	{/if}
</div>

<style>
	.history-actions {
		display: flex;
		gap: 0.25rem;
	}

	.history-actions button {
		transition:
			filter 0.2s ease,
			opacity 0.2s ease;
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

	.app-buttons {
		width: 20%;
		text-align: right;
	}

	.footer-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		align-self: center;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.65rem;
		border-radius: 999rem;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		background-color: rgb(from var(--gc-color-text) r g b / 8%);
		border: 0.05rem solid rgb(from var(--gc-color-text) r g b / 14%);
	}

	.status-badge.disconnected {
		color: var(--gc-color-error);
		background-color: rgb(from var(--gc-color-error) r g b / 12%);
		border-color: rgb(from var(--gc-color-error) r g b / 24%);
	}

	.status-badge.connecting {
		color: var(--gc-color-warning);
		background-color: rgb(from var(--gc-color-warning) r g b / 12%);
		border-color: rgb(from var(--gc-color-warning) r g b / 24%);
	}

	.status-badge.connected {
		color: var(--gc-color-success);
		background-color: rgb(from var(--gc-color-success) r g b / 12%);
		border-color: rgb(from var(--gc-color-success) r g b / 24%);
	}

	.status-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background-color: currentColor;
		box-shadow: 0 0 0.45rem currentColor;
	}

	.status-label {
		line-height: 1;
	}
</style>
