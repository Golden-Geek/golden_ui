<script lang="ts">
    import type { PanelProps, PanelState } from "../../../dockview/panel-types";
    import { appState } from "$lib/golden_ui/store/workbench.svelte";
    import OutlinerItem from "./OutlinerItem.svelte";

    const initialProps: PanelProps = $props();
    let panel = $state<PanelState>({
        panelId: initialProps.panelId,
        panelType: initialProps.panelType,
        title: initialProps.title,
        params: initialProps.params,
    });

    export const setPanelState = (next: PanelState): void => {
        panel = next;
    };

    let mainGraphState = $derived(appState.session?.graph.state);

    let rootNode = $derived(
        mainGraphState?.nodesById.get(mainGraphState?.rootId ?? 0) ?? null,
    );
</script>

{#if rootNode}
    <div class="outliner-panel">
        <div class="outliner-header">
            <input
                type="text"
                placeholder="Search..."
                class="outliner-search"
            />
        </div>
        <div class="outliner-content">
            <div class="outliner-tree">
                <OutlinerItem node={rootNode} />
            </div>
        </div>
    </div>
{/if}

<style>
    .outliner-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .outliner-header {
        padding: 0.5rem;
    }
    .outliner-search {
        width: 100%;
        padding: 0.25rem;
    }
    .outliner-content {
        flex: 1;
        overflow: auto;
        scrollbar-gutter: stable;
        padding: 0.5rem;
    }
</style>
