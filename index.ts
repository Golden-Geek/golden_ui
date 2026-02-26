export { createGraphStore } from './store/graph.svelte';
export type { GraphState, GraphStore } from './store/graph.svelte';
export { createWorkbenchSession } from './store/workbench.svelte';
export type {
	WorkbenchSession,
	WorkbenchSessionOptions,
	NodeWarningRecord
} from './store/workbench.svelte';
export type { NodeIconSet } from './store/node-types';

export { createHttpUiClient } from './transport/http';
export { createWebSocketUiClient } from './transport/ws';

export { default as MainWindow } from './components/app/MainWindow.svelte';
export { default as MainComponent } from './components/app/MainComponent.svelte';
export { default as AppHeader } from './components/app/AppHeader.svelte';
export { default as WorkbenchOverlayHost } from './components/app/WorkbenchOverlayHost.svelte';
export { default as Watcher } from './components/common/Watcher.svelte';

export { default as MainViewPanel } from './components/panels/MainViewPanel.svelte';
export { default as UnknownPanel } from './components/panels/UnknownPanel.svelte';
export { default as Outliner } from './components/panels/outliner/OutlinerPanel.svelte';
export { default as Inspector } from './components/panels/inspector/InspectorPanel.svelte';
export { default as LoggerPanel } from './components/panels/logger/LoggerPanel.svelte';
export { default as WarningsPanel } from './components/panels/warnings/WarningsPanel.svelte';
export {
	registerNodeInspector,
	registerNodeInspectors,
	unregisterNodeInspector,
	clearCustomNodeInspectors
} from './components/panels/inspector/node-inspector-registry';
export type {
	NodeInspectorComponentProps,
	NodeInspectorEntry,
	NodeInspectorOrder,
	NodeInspectorRegistry
} from './components/panels/inspector/node-inspector-registry';

export { goldenDockviewTheme } from './dockview/goldenDockviewTheme';
export { createGoldenTabRenderer } from './dockview/createGoldenTabRenderer';
export type {
	DockPanelComponent,
	DockPanelExports,
	DockPanelParams,
	DockPanelProps,
	DockPanelState,
	PanelApi,
	PanelController,
	PanelComponent,
	PanelDefinition,
	PanelDockDirection,
	PanelExports,
	PanelHandle,
	PanelParams,
	PanelProps,
	PanelQuery,
	PanelRenderPolicy,
	PanelSpawnPosition,
	PanelSpawnRequest,
	PanelState,
	UserPanelDefinition,
	UserPanelDefinitionMap
} from './dockview/panel-types';

export * from './store/ui-warnings';
export * from './store/ui-panels';
export * from './types';
