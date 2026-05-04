export { createGraphStore } from './store/graph.svelte';
export type { GraphState, GraphStore } from './store/graph.svelte';
export { createWorkbenchSession } from './store/workbench.svelte';
export type {
	WorkbenchSession,
	WorkbenchSessionOptions,
	NodeWarningRecord
} from './store/workbench.svelte';
export type { NodeIconSet } from './store/node-types';

export {
	createDefaultUiClient,
	type UiTransportConnectionState,
	type UiTransportFactory,
	type UiTransportOptions
} from './transport';
export { createHttpUiClient } from './transport/http';
export { createWebSocketUiClient } from './transport/ws';

export { default as MainWindow } from './components/app/MainWindow.svelte';
export { default as MainComponent } from './components/app/MainComponent.svelte';
export { default as AppHeader } from './components/app/AppHeader.svelte';
export { default as WorkbenchSessionRoot } from './components/app/WorkbenchSessionRoot.svelte';
export { default as WorkbenchOverlayHost } from './components/app/WorkbenchOverlayHost.svelte';
export { default as DashboardRouteLayout } from './components/routes/DashboardRouteLayout.svelte';
export { default as DashboardRoute } from './components/routes/DashboardRoute.svelte';
export { default as DashboardPageRoute } from './components/routes/DashboardPageRoute.svelte';
export { default as Watcher } from './components/common/Watcher.svelte';

export { default as UnknownPanel } from './components/panels/UnknownPanel.svelte';
export { default as Outliner } from './components/panels/outliner/OutlinerPanel.svelte';
export {
	registerOutlinerRowSupplement,
	registerOutlinerRowSupplements,
	unregisterOutlinerRowSupplement,
	clearCustomOutlinerRowSupplements,
	resolveOutlinerRowSupplement,
	type OutlinerRowSupplementEntry,
	type OutlinerRowSupplementRegistry
} from './components/panels/outliner/outliner-row-registry';
export { default as Inspector } from './components/panels/inspector/InspectorPanel.svelte';
export { default as LoggerPanel } from './components/panels/logger/LoggerPanel.svelte';
export { default as WarningsPanel } from './components/panels/warnings/WarningsPanel.svelte';
export { default as DashboardPanel } from './components/panels/dashboard/DashboardPanel.svelte';
export { default as DashboardViewer } from './components/panels/dashboard/DashboardViewer.svelte';
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
	NodeInspectorPanelHeaderComponentProps,
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
