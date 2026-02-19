<script lang="ts">
    import type { WorkbenchSession } from "$lib/golden_ui/store/workbench.svelte";
    import { onMount } from "svelte";

    let isWindowMaximized = $state(false);
    let hasTauriWindowApi = $state(false);

    const { session } = $props<{
        session?: WorkbenchSession | null;
    }>();

    const invokeAppCommand = async (
        command: string,
        args?: Record<string, unknown>,
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
        const maximized = await invokeAppCommand("window_is_maximized");
        isWindowMaximized = Boolean(maximized);
    };

    const minimizeWindow = async (): Promise<void> => {
        const result = await invokeAppCommand("window_minimize");
        if (result === undefined) {
            console.error(
                "[window-controls] Tauri window API unavailable (minimize).",
            );
        }
    };

    const toggleWindowMaximize = async (): Promise<void> => {
        const result = await invokeAppCommand("window_toggle_maximize");
        if (result === undefined) {
            console.error(
                "[window-controls] Tauri window API unavailable (toggle maximize).",
            );
            return;
        }
        await refreshMaximizeState();
    };

    const closeWindow = async (): Promise<void> => {
        const result = await invokeAppCommand("window_close");
        if (result === undefined) {
            console.error(
                "[window-controls] Tauri window API unavailable (close).",
            );
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
        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("resize", onResize);
        };
    });
</script>

<div class="gc-header">
    <div class="app-title">Chataigne 2.0.0</div>
    <div class="spacer"></div>
    <div class="controls">
        <div class="history-actions">
            <button
                type="button"
                class="history-button"
                title="Ctrl/Cmd+Z"
                disabled={session.historyBusy || !session.canUndo}
                onclick={() => void session.undo()}
            >
                Undo
            </button>
            <button
                type="button"
                class="history-button"
                title="Ctrl/Cmd+Shift+Z or Ctrl+Y"
                disabled={session.historyBusy || !session.canRedo}
                onclick={() => void session.redo()}
            >
                Redo
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
                onclick={() => minimizeWindow()}>➖</button
            >
            <button
                type="button"
                class="maximize-app"
                aria-label="Maximize app"
                onclick={() => toggleWindowMaximize()}>🟩</button
            >
            <button
                type="button"
                class="close-app"
                aria-label="Close app"
                onclick={() => closeWindow()}>🔴</button
            >
        </div>
    {:else if session.status}
        <p class="status">{session.status}</p>
    {/if}
</div>
